import {
  canAddProduct,
  entitlementsForPlan,
  hasEntitlement,
  isOverLimit,
  isUpgrade,
  planFromSubscription,
  remainingProductSlots,
} from '../entitlements';

/**
 * Entitlement rules. The tests that matter most here are the *downgrade* ones: a
 * user whose subscription lapses must keep full access to everything they already
 * saved. Getting that wrong means holding someone's receipts hostage.
 */

describe('plan → entitlements', () => {
  it('gives Free a 3-product limit and no intelligence features', () => {
    const free = entitlementsForPlan('free');
    expect(free.product_limit).toBe(3);
    expect(free.ai_coverage).toBe(false);
    expect(free.smart_scan).toBe(false);
  });

  it('gives Plus 20 products plus coverage and scanning', () => {
    const plus = entitlementsForPlan('plus');
    expect(plus.product_limit).toBe(20);
    expect(plus.ai_coverage).toBe(true);
    expect(plus.smart_scan).toBe(true);
    expect(plus.priority_analysis).toBe(false);
  });

  it('gives Pro unlimited products', () => {
    const pro = entitlementsForPlan('pro');
    expect(pro.product_limit).toBeNull();
    expect(pro.unlimited_products).toBe(true);
    expect(pro.priority_analysis).toBe(true);
  });
});

describe('subscription status → effective plan', () => {
  it.each(['active', 'in_trial', 'in_grace_period', 'in_billing_retry'] as const)(
    'keeps paid access while status is %s',
    (status) => {
      // Grace period and billing retry still entitle: a failed card is not a
      // cancellation, and locking the user out over one is hostile.
      expect(planFromSubscription('plus', status)).toBe('plus');
    },
  );

  it.each(['expired', 'revoked', 'none'] as const)(
    'drops to free when status is %s',
    (status) => {
      expect(planFromSubscription('pro', status)).toBe('free');
    },
  );
});

describe('canAddProduct', () => {
  it('allows a Free user under the limit', () => {
    expect(canAddProduct(entitlementsForPlan('free'), 2, 'free')).toEqual({
      allowed: true,
    });
  });

  it('blocks the fourth product on Free and suggests Plus', () => {
    const result = canAddProduct(entitlementsForPlan('free'), 3, 'free');
    expect(result).toEqual({
      allowed: false,
      reason: 'product_limit_reached',
      limit: 3,
      current: 3,
      suggestedPlan: 'plus',
    });
  });

  it('suggests Pro when a Plus user hits 20', () => {
    const result = canAddProduct(entitlementsForPlan('plus'), 20, 'plus');
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.suggestedPlan).toBe('pro');
  });

  it('never blocks a Pro user', () => {
    expect(canAddProduct(entitlementsForPlan('pro'), 5000, 'pro').allowed).toBe(true);
  });

  it('blocks new products after a downgrade without touching existing ones', () => {
    // 15 products, subscription lapsed. Adding is blocked; nothing is deleted, and
    // isOverLimit lets the UI explain the state honestly.
    const free = entitlementsForPlan('free');
    expect(canAddProduct(free, 15, 'free').allowed).toBe(false);
    expect(isOverLimit(free, 15)).toBe(true);
    expect(remainingProductSlots(free, 15)).toBe(0);
  });
});

describe('slot accounting', () => {
  it('reports remaining slots, floored at zero', () => {
    expect(remainingProductSlots(entitlementsForPlan('free'), 1)).toBe(2);
    expect(remainingProductSlots(entitlementsForPlan('free'), 3)).toBe(0);
    expect(remainingProductSlots(entitlementsForPlan('free'), 9)).toBe(0);
  });

  it('reports null rather than a meaningless number for unlimited plans', () => {
    expect(remainingProductSlots(entitlementsForPlan('pro'), 400)).toBeNull();
    expect(isOverLimit(entitlementsForPlan('pro'), 400)).toBe(false);
  });
});

describe('feature gates and plan ordering', () => {
  it('gates coverage analysis behind a paid plan', () => {
    expect(hasEntitlement(entitlementsForPlan('free'), 'ai_coverage')).toBe(false);
    expect(hasEntitlement(entitlementsForPlan('plus'), 'ai_coverage')).toBe(true);
  });

  it('offers data export on paid plans', () => {
    expect(hasEntitlement(entitlementsForPlan('plus'), 'document_export')).toBe(true);
  });

  it('orders plans for upgrade/downgrade decisions', () => {
    expect(isUpgrade('free', 'plus')).toBe(true);
    expect(isUpgrade('plus', 'pro')).toBe(true);
    expect(isUpgrade('pro', 'plus')).toBe(false);
    expect(isUpgrade('plus', 'plus')).toBe(false);
  });
});
