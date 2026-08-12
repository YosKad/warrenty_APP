import { Platform } from 'react-native';

import { toAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import {
  entitlementsForPlan,
  planFromSubscription,
  type Entitlements,
  type PlanId,
  type SubscriptionStatus,
} from '@/domain/entitlements';

/**
 * Subscriptions.
 *
 * Two rules govern this module.
 *
 * 1. Prices and plan copy come from the store, never from our code. `getOfferings`
 *    returns whatever StoreKit / Play Billing reports, already localised and
 *    currency-correct. Hard-coding "$5/month" would be wrong in most of the world
 *    and is grounds for rejection in both stores.
 *
 * 2. Entitlement is server-decided. A purchase is verified by an Edge Function
 *    against Apple's App Store Server API or Google's Android Publisher API before
 *    `subscriptions` is written. The client reports a purchase; it never grants one.
 */

/**
 * Store product identifiers. The only hard-coded commercial values in the app, and
 * they carry no price — they are lookup keys, matching what is configured in App
 * Store Connect and the Play Console.
 */
export const STORE_PRODUCT_IDS = {
  plusMonthly: 'mywarranty_plus_monthly',
  plusAnnual: 'mywarranty_plus_annual',
  proMonthly: 'mywarranty_pro_monthly',
  proAnnual: 'mywarranty_pro_annual',
} as const;

export type StoreProductId = (typeof STORE_PRODUCT_IDS)[keyof typeof STORE_PRODUCT_IDS];

/** Maps a store SKU to the plan it grants. The server holds the authoritative copy. */
export const PLAN_BY_PRODUCT_ID: Record<StoreProductId, PlanId> = {
  [STORE_PRODUCT_IDS.plusMonthly]: 'plus',
  [STORE_PRODUCT_IDS.plusAnnual]: 'plus',
  [STORE_PRODUCT_IDS.proMonthly]: 'pro',
  [STORE_PRODUCT_IDS.proAnnual]: 'pro',
};

export type Offering = {
  productId: StoreProductId;
  plan: PlanId;
  /** Already formatted and localised by the store, e.g. "₪18.90" or "$4.99". */
  displayPrice: string;
  period: 'monthly' | 'annual';
  /** Introductory offer or free trial, when the store reports one for this user. */
  introOffer: { displayPrice: string; periodDays: number } | null;
};

export type SubscriptionState = {
  plan: PlanId;
  status: SubscriptionStatus;
  entitlements: Entitlements;
  expiresAt: string | null;
  autoRenew: boolean;
  provider: 'apple' | 'google' | null;
  storeProductId: string | null;
  isTrial: boolean;
};

export const FREE_STATE: SubscriptionState = {
  plan: 'free',
  status: 'none',
  entitlements: entitlementsForPlan('free'),
  expiresAt: null,
  autoRenew: false,
  provider: null,
  storeProductId: null,
  isTrial: false,
};

/**
 * The user's current entitlement, read from the server.
 *
 * Cached by TanStack Query and refreshed on foreground, after a purchase and after a
 * restore. If this call fails we fall back to Free for *gating new purchases only* —
 * existing content stays readable, because the offline path must never lock someone
 * out of their own records.
 */
export async function getSubscriptionState(): Promise<SubscriptionState> {
  try {
    const { data, error } = await supabase
      .from('subscriptions')
      .select(
        'plan, status, expires_at, auto_renew, provider, store_product_id, is_trial',
      )
      .single();
    if (error) throw error;
    if (!data) return FREE_STATE;

    const effectivePlan = planFromSubscription(data.plan, data.status);
    return {
      plan: effectivePlan,
      status: data.status,
      entitlements: entitlementsForPlan(effectivePlan),
      expiresAt: data.expires_at,
      autoRenew: data.auto_renew,
      provider: data.provider,
      storeProductId: data.store_product_id,
      isTrial: data.is_trial,
    };
  } catch (error) {
    throw toAppError(error);
  }
}

/**
 * Sends a store purchase to the server for verification.
 *
 * The payload is the platform's opaque proof of purchase — an App Store JWS
 * transaction or a Play purchase token. The function validates it directly with the
 * store, so a forged payload from a patched client fails verification and grants
 * nothing.
 */
export async function verifyPurchase(params: {
  productId: string;
  /** iOS: signed transaction JWS. Android: purchaseToken. */
  proof: string;
}): Promise<SubscriptionState> {
  try {
    const { error } = await supabase.functions.invoke('verify-purchase', {
      body: {
        provider: Platform.OS === 'ios' ? 'apple' : 'google',
        productId: params.productId,
        proof: params.proof,
      },
    });
    if (error) throw error;
    return await getSubscriptionState();
  } catch (error) {
    throw toAppError(error);
  }
}

/**
 * Restore purchases.
 *
 * Required by App Store review, and genuinely needed: a user on a new phone signs in
 * and expects their plan back. Because entitlement lives on the server keyed to the
 * account, "restore" mostly means re-verifying whatever the store still knows about
 * and re-reading our own record.
 */
export async function restorePurchases(
  storeTransactions: { productId: string; proof: string }[],
): Promise<SubscriptionState> {
  for (const transaction of storeTransactions) {
    try {
      await verifyPurchase(transaction);
    } catch (error) {
      logger.warn('restore: transaction failed verification', {
        productId: transaction.productId,
      });
    }
  }
  return getSubscriptionState();
}

/**
 * Deep link to the platform's own subscription management. Apple and Google both
 * require that cancellation and plan changes happen in their UI, not ours.
 */
export function getManageSubscriptionUrl(): string {
  return Platform.OS === 'ios'
    ? 'https://apps.apple.com/account/subscriptions'
    : 'https://play.google.com/store/account/subscriptions';
}

/**
 * Sorts offerings for the paywall: Plus before Pro, monthly before annual. Plus is
 * presented as the recommended plan — see PaywallSheet.
 */
export function sortOfferings(offerings: Offering[]): Offering[] {
  const planRank: Record<PlanId, number> = { free: 0, plus: 1, pro: 2 };
  return [...offerings].sort((a, b) => {
    const byPlan = planRank[a.plan] - planRank[b.plan];
    if (byPlan !== 0) return byPlan;
    return a.period === b.period ? 0 : a.period === 'monthly' ? -1 : 1;
  });
}
