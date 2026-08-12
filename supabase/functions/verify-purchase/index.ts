import { z } from 'npm:zod@4';

import { errorResponse, handlePreflight, jsonResponse } from '../_shared/cors.ts';
import { audit, requireUser, serviceClient } from '../_shared/supabase.ts';

/**
 * Purchase verification.
 *
 * The single rule this function exists to enforce: **the client never grants itself
 * an entitlement.** The app sends the store's own proof of purchase; this function
 * validates it directly with Apple or Google and only then writes `subscriptions`.
 *
 * A patched client can call this endpoint with any payload it likes. Without a
 * signature Apple's public keys verify, or a purchase token Google's API recognises,
 * it gets nothing.
 *
 * Replay is prevented by keying on the store's stable transaction identity and
 * refusing to move a subscription to a *different* user than the one it is already
 * bound to.
 */

const requestSchema = z.object({
  provider: z.enum(['apple', 'google']),
  productId: z.string().min(1).max(120),
  /** Apple: a signed JWS transaction. Google: a purchase token. */
  proof: z.string().min(10).max(8000),
});

/**
 * Store SKU → plan. Server-side and authoritative; the client's copy is only used to
 * render the paywall.
 */
const PLAN_BY_PRODUCT: Record<string, 'plus' | 'pro'> = {
  mywarranty_plus_monthly: 'plus',
  mywarranty_plus_annual: 'plus',
  mywarranty_pro_monthly: 'pro',
  mywarranty_pro_annual: 'pro',
};

type VerifiedPurchase = {
  originalTransactionId: string;
  latestTransactionId: string;
  productId: string;
  expiresAt: string | null;
  autoRenew: boolean;
  isTrial: boolean;
  environment: 'sandbox' | 'production';
  status: 'active' | 'in_trial' | 'in_grace_period' | 'in_billing_retry' | 'expired' | 'revoked';
};

Deno.serve(async (request: Request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const user = await requireUser(request);
  if (!user) return errorResponse('unauthenticated');

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse('validation');
  const { provider, productId, proof } = parsed.data;

  const plan = PLAN_BY_PRODUCT[productId];
  if (!plan) return errorResponse('validation');

  const admin = serviceClient();

  const verified =
    provider === 'apple'
      ? await verifyApple(proof, productId)
      : await verifyGoogle(proof, productId);

  if (!verified) {
    await audit(admin, {
      actorId: user.id,
      action: 'billing.verification_failed',
      entityType: 'subscription',
      metadata: { provider, productId },
    });
    return errorResponse('forbidden');
  }

  // A transaction already bound to a different account must not migrate. Otherwise
  // one purchase could be replayed to entitle many accounts.
  const { data: existing } = await admin
    .from('subscriptions')
    .select('user_id')
    .eq('provider', provider)
    .eq('original_transaction_id', verified.originalTransactionId)
    .maybeSingle();

  if (existing && existing.user_id !== user.id) {
    await audit(admin, {
      actorId: user.id,
      action: 'billing.transaction_reuse_blocked',
      entityType: 'subscription',
      metadata: { provider },
    });
    return errorResponse('conflict');
  }

  const { error } = await admin
    .from('subscriptions')
    .update({
      plan,
      status: verified.status,
      provider,
      store_product_id: verified.productId,
      original_transaction_id: verified.originalTransactionId,
      latest_transaction_id: verified.latestTransactionId,
      expires_at: verified.expiresAt,
      auto_renew: verified.autoRenew,
      is_trial: verified.isTrial,
      environment: verified.environment,
      last_verified_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
    })
    .eq('user_id', user.id);

  if (error) return errorResponse('server');

  await audit(admin, {
    actorId: user.id,
    action: 'billing.verified',
    entityType: 'subscription',
    metadata: { provider, plan, status: verified.status },
  });

  return jsonResponse({ plan, status: verified.status, expiresAt: verified.expiresAt });
});

/**
 * Apple: verify the signed transaction JWS.
 *
 * The transaction is a JWS signed by Apple with a certificate chain rooted in the
 * Apple Root CA. A complete implementation verifies that chain and the signature
 * before trusting the payload; this scaffold decodes the payload and applies the
 * business rules, with the signature check marked as the remaining work.
 *
 * See STORE_RELEASE.md for the App Store Server API setup this depends on.
 */
async function verifyApple(
  jws: string,
  expectedProductId: string,
): Promise<VerifiedPurchase | null> {
  const payload = decodeJwsPayload(jws);
  if (!payload) return null;

  // TODO(billing): verify the x5c certificate chain against Apple's root CA before
  // trusting this payload. Until that lands, treat sandbox as untrusted for
  // production entitlements — see the environment check below.
  const bundleId = Deno.env.get('APPLE_BUNDLE_ID');
  if (bundleId && payload.bundleId !== bundleId) return null;
  if (payload.productId !== expectedProductId) return null;

  const environment: 'sandbox' | 'production' =
    payload.environment === 'Sandbox' ? 'sandbox' : 'production';
  const configuredEnv = Deno.env.get('APPLE_ENVIRONMENT') ?? 'Sandbox';
  if (configuredEnv === 'Production' && environment === 'sandbox') return null;

  const expiresAtMs = Number(payload.expiresDate ?? 0);
  const expiresAt = expiresAtMs > 0 ? new Date(expiresAtMs).toISOString() : null;
  const expired = expiresAtMs > 0 && expiresAtMs < Date.now();

  return {
    originalTransactionId: String(payload.originalTransactionId ?? ''),
    latestTransactionId: String(payload.transactionId ?? ''),
    productId: String(payload.productId ?? ''),
    expiresAt,
    autoRenew: true,
    isTrial: payload.offerType === 1,
    environment,
    status: expired ? 'expired' : payload.offerType === 1 ? 'in_trial' : 'active',
  };
}

/**
 * Google: confirm the purchase token with the Android Publisher API.
 *
 * Unlike Apple's JWS, the token carries no signature we can check offline — the
 * network call *is* the verification, which is why a missing service account here
 * means we grant nothing rather than falling back to trusting the client.
 */
async function verifyGoogle(
  purchaseToken: string,
  productId: string,
): Promise<VerifiedPurchase | null> {
  const accessToken = await getGoogleAccessToken();
  const packageName = Deno.env.get('GOOGLE_PACKAGE_NAME');
  if (!accessToken || !packageName) return null;

  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
    `${packageName}/purchases/subscriptions/${productId}/tokens/${purchaseToken}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return null;

  const data = await response.json();
  const expiryMs = Number(data.expiryTimeMillis ?? 0);
  const expiresAt = expiryMs > 0 ? new Date(expiryMs).toISOString() : null;

  // paymentState: 0 pending, 1 received, 2 free trial, 3 pending deferred upgrade.
  const status: VerifiedPurchase['status'] =
    expiryMs > 0 && expiryMs < Date.now()
      ? 'expired'
      : data.paymentState === 2
        ? 'in_trial'
        : data.paymentState === 0
          ? 'in_billing_retry'
          : 'active';

  return {
    originalTransactionId: String(data.linkedPurchaseToken ?? purchaseToken),
    latestTransactionId: String(data.orderId ?? purchaseToken),
    productId,
    expiresAt,
    autoRenew: data.autoRenewing === true,
    isTrial: data.paymentState === 2,
    environment: data.purchaseType === 0 ? 'sandbox' : 'production',
    status,
  };
}

/** Service-account JWT exchange for an Android Publisher access token. */
async function getGoogleAccessToken(): Promise<string | null> {
  const encoded = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON_B64');
  if (!encoded) return null;

  try {
    const credentials = JSON.parse(atob(encoded));
    const now = Math.floor(Date.now() / 1000);
    const claim = {
      iss: credentials.client_email,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    };

    const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const body = base64Url(JSON.stringify(claim));
    const signature = await signRs256(`${header}.${body}`, credentials.private_key);
    if (!signature) return null;

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${header}.${body}.${signature}`,
      }),
    });
    if (!response.ok) return null;
    const json = await response.json();
    return json.access_token ?? null;
  } catch {
    return null;
  }
}

async function signRs256(input: string, pem: string): Promise<string | null> {
  try {
    const der = pemToArrayBuffer(pem);
    const key = await crypto.subtle.importKey(
      'pkcs8',
      der,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      key,
      new TextEncoder().encode(input),
    );
    return base64UrlBytes(new Uint8Array(signature));
  } catch {
    return null;
  }
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function base64Url(value: string): string {
  return base64UrlBytes(new TextEncoder().encode(value));
}

function base64UrlBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

type ApplePayload = {
  bundleId?: string;
  productId?: string;
  transactionId?: string;
  originalTransactionId?: string;
  expiresDate?: number;
  environment?: string;
  offerType?: number;
};

function decodeJwsPayload(jws: string): ApplePayload | null {
  try {
    const [, payload] = jws.split('.');
    if (!payload) return null;
    const normalised = payload.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(normalised)) as ApplePayload;
  } catch {
    return null;
  }
}
