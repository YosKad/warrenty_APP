/**
 * Entitlements — what a user can do, decoupled from what they pay.
 *
 * Feature checks in the app ask "does this user have `ai_coverage`?", never "is this
 * user on Plus?". That indirection is what lets pricing, plan names and limits change
 * server-side without an app update, and what lets a support agent grant a single
 * capability to one account.
 *
 * The server is authoritative. This module mirrors the server's plan→entitlement map
 * so the UI can render limits and paywalls without a round trip, but every write that
 * depends on an entitlement is re-checked in Postgres (see `enforce_product_limit`
 * in the migrations). A patched client can call the API; it cannot exceed its quota.
 */

export type PlanId = 'free' | 'plus' | 'pro';

export type EntitlementKey =
  | 'product_limit'
  | 'unlimited_products'
  | 'ai_coverage'
  | 'smart_scan'
  | 'advanced_notifications'
  | 'provider_lookup'
  | 'priority_analysis'
  | 'document_export';

/** `null` product_limit means unlimited. */
export type Entitlements = {
  product_limit: number | null;
  unlimited_products: boolean;
  ai_coverage: boolean;
  smart_scan: boolean;
  advanced_notifications: boolean;
  provider_lookup: boolean;
  priority_analysis: boolean;
  document_export: boolean;
};

export const PLAN_ENTITLEMENTS: Record<PlanId, Entitlements> = {
  free: {
    product_limit: 3,
    unlimited_products: false,
    ai_coverage: false,
    smart_scan: false,
    advanced_notifications: false,
    provider_lookup: false,
    priority_analysis: false,
    document_export: false,
  },
  plus: {
    product_limit: 20,
    unlimited_products: false,
    ai_coverage: true,
    smart_scan: true,
    advanced_notifications: true,
    provider_lookup: true,
    priority_analysis: false,
    document_export: true,
  },
  pro: {
    product_limit: null,
    unlimited_products: true,
    ai_coverage: true,
    smart_scan: true,
    advanced_notifications: true,
    provider_lookup: true,
    priority_analysis: true,
    document_export: true,
  },
};

/** Ordering used to decide whether a plan change is an upgrade or a downgrade. */
const PLAN_RANK: Record<PlanId, number> = { free: 0, plus: 1, pro: 2 };

export function isUpgrade(from: PlanId, to: PlanId): boolean {
  return PLAN_RANK[to] > PLAN_RANK[from];
}

export function entitlementsForPlan(plan: PlanId): Entitlements {
  return PLAN_ENTITLEMENTS[plan];
}

export type SubscriptionStatus =
  | 'active'
  | 'in_trial'
  | 'in_grace_period'
  | 'in_billing_retry'
  | 'expired'
  | 'revoked'
  | 'none';

/**
 * Statuses that still grant paid access. Grace period and billing retry deliberately
 * do: the user's card failed, they have not cancelled, and locking them out of their
 * own warranty records over a payment hiccup is hostile and generates churn.
 */
const ENTITLING_STATUSES: ReadonlySet<SubscriptionStatus> = new Set([
  'active',
  'in_trial',
  'in_grace_period',
  'in_billing_retry',
]);

export function planFromSubscription(
  plan: PlanId,
  status: SubscriptionStatus,
): PlanId {
  return ENTITLING_STATUSES.has(status) ? plan : 'free';
}

export type QuotaCheck =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'product_limit_reached';
      limit: number;
      current: number;
      suggestedPlan: PlanId;
    };

/**
 * The rule behind the paywall sheet. Note what this does *not* do: it never blocks
 * reading, editing or exporting existing products. Downgrading restricts creation
 * only — a user's warranty history is theirs whether or not they are paying.
 */
export function canAddProduct(
  entitlements: Entitlements,
  currentProductCount: number,
  plan: PlanId,
): QuotaCheck {
  if (entitlements.unlimited_products || entitlements.product_limit === null) {
    return { allowed: true };
  }
  if (currentProductCount < entitlements.product_limit) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: 'product_limit_reached',
    limit: entitlements.product_limit,
    current: currentProductCount,
    suggestedPlan: plan === 'free' ? 'plus' : 'pro',
  };
}

export function hasEntitlement(
  entitlements: Entitlements,
  key: Exclude<EntitlementKey, 'product_limit'>,
): boolean {
  return entitlements[key] === true;
}

/**
 * How many product slots remain, for the "2 of 3 slots used" line on Home.
 * `null` means unlimited — the UI shows nothing rather than a meaningless number.
 */
export function remainingProductSlots(
  entitlements: Entitlements,
  currentProductCount: number,
): number | null {
  if (entitlements.product_limit === null) return null;
  return Math.max(0, entitlements.product_limit - currentProductCount);
}

/**
 * A user over their limit after a downgrade (15 products, back on Free). They keep
 * everything; they just cannot add more. The UI uses this to explain the state
 * honestly instead of showing "-12 slots left".
 */
export function isOverLimit(
  entitlements: Entitlements,
  currentProductCount: number,
): boolean {
  if (entitlements.product_limit === null) return false;
  return currentProductCount > entitlements.product_limit;
}
