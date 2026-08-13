import type { CalendarDate } from './date';
import { getWarrantySnapshot, type ProductLifecycle, type WarrantyStatus } from './warranty';

/**
 * Protection scoring.
 *
 * Deterministic and pure — no model involvement anywhere. A score a user cannot
 * reason about is worse than no score, so every point is traceable to a named
 * factor and every missing point becomes an action they can actually take.
 *
 * The formula is documented in docs/V2_PLAN.md and mirrored by
 * `product_protection_completeness()` in SQL so the server agrees with the app.
 */

/**
 * The eight factors, weighted by what actually matters when filing a claim.
 *
 * Purchase date and warranty end decide *whether* there is a claim; the receipt
 * decides whether it can be *proved*; provider and terms decide whether it can be
 * *acted on*. Serial and model matter but are recoverable from the object itself,
 * so they carry the least weight.
 */
export const PROTECTION_FACTORS = [
  { key: 'purchase_date', weight: 20 },
  { key: 'warranty_end', weight: 20 },
  { key: 'proof_of_purchase', weight: 18 },
  { key: 'warranty_provider', weight: 12 },
  { key: 'warranty_terms', weight: 10 },
  { key: 'serial_number', weight: 8 },
  { key: 'service_provider', weight: 7 },
  { key: 'model', weight: 5 },
] as const;

export type ProtectionFactorKey = (typeof PROTECTION_FACTORS)[number]['key'];

/** Weights must total 100, or "82%" would be meaningless. Guarded by a test. */
export const PROTECTION_TOTAL_WEIGHT = PROTECTION_FACTORS.reduce(
  (sum, f) => sum + f.weight,
  0,
);

export type ProtectionInput = {
  purchaseDate: CalendarDate | null;
  warrantyStart: CalendarDate | null;
  warrantyEnd: CalendarDate | null;
  durationMonths: number | null;
  extensionMonths: number | null;
  serialNumber: string | null;
  model: string | null;
  warrantyProviderId: string | null;
  serviceProviderId: string | null;
  /** Linked warranty policy — implies retrievable terms and clauses. */
  warrantyId: string | null;
  /** Count of attached receipts or invoices. Photos and manuals don't count. */
  proofDocumentCount: number;
  lifecycle: ProductLifecycle;
};

export type ProtectionGap = {
  key: ProtectionFactorKey;
  weight: number;
};

export type ProtectionCompleteness = {
  /** 0–100, rounded. */
  score: number;
  /** Factors not yet satisfied, heaviest first — this is the action list. */
  gaps: ProtectionGap[];
  satisfied: ProtectionFactorKey[];
};

function isSatisfied(key: ProtectionFactorKey, input: ProtectionInput): boolean {
  switch (key) {
    case 'purchase_date':
      return input.purchaseDate !== null;
    case 'warranty_end':
      // Either stated outright or derivable — both mean we know when cover ends.
      return (
        input.warrantyEnd !== null ||
        ((input.warrantyStart !== null || input.purchaseDate !== null) &&
          input.durationMonths !== null &&
          input.durationMonths > 0)
      );
    case 'proof_of_purchase':
      return input.proofDocumentCount > 0;
    case 'warranty_provider':
      return input.warrantyProviderId !== null;
    case 'warranty_terms':
      return input.warrantyId !== null;
    case 'serial_number':
      return nonEmpty(input.serialNumber);
    case 'service_provider':
      return input.serviceProviderId !== null;
    case 'model':
      return nonEmpty(input.model);
    default:
      return false;
  }
}

function nonEmpty(value: string | null): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function getProtectionCompleteness(
  input: ProtectionInput,
): ProtectionCompleteness {
  const gaps: ProtectionGap[] = [];
  const satisfied: ProtectionFactorKey[] = [];
  let earned = 0;

  for (const factor of PROTECTION_FACTORS) {
    if (isSatisfied(factor.key, input)) {
      earned += factor.weight;
      satisfied.push(factor.key);
    } else {
      gaps.push({ key: factor.key, weight: factor.weight });
    }
  }

  // Heaviest gap first, so "Recommended actions" leads with what matters most.
  gaps.sort((a, b) => b.weight - a.weight);

  return {
    score: Math.round((earned / PROTECTION_TOTAL_WEIGHT) * 100),
    gaps,
    satisfied,
  };
}

/**
 * How much a product's completeness counts toward the portfolio score.
 *
 * An expired product still counts — its records retain value as service history —
 * but it cannot drag the number down as hard as something still under cover.
 */
export function protectionWeightForStatus(status: WarrantyStatus): number {
  switch (status) {
    case 'active':
    case 'ending_soon':
      return 1;
    case 'unknown':
      return 0.5;
    case 'expired':
      return 0.25;
    default:
      return 0.5;
  }
}

export type ScoredProduct = {
  id: string;
  completeness: ProtectionCompleteness;
  status: WarrantyStatus;
};

export type PortfolioProtection = {
  /**
   * 0–100, or `null` for an empty portfolio. Null rather than zero: a user who
   * has not added anything yet has not done anything wrong.
   */
  score: number | null;
  band: 'strong' | 'fair' | 'needs_attention' | 'empty';
  productCount: number;
  /** Products with at least one unsatisfied factor. */
  needsAttentionCount: number;
};

export const PROTECTION_BAND_STRONG = 85;
export const PROTECTION_BAND_FAIR = 60;

export function getPortfolioProtection(products: ScoredProduct[]): PortfolioProtection {
  if (products.length === 0) {
    return { score: null, band: 'empty', productCount: 0, needsAttentionCount: 0 };
  }

  let weightedSum = 0;
  let totalWeight = 0;
  let needsAttention = 0;

  for (const product of products) {
    const weight = protectionWeightForStatus(product.status);
    weightedSum += product.completeness.score * weight;
    totalWeight += weight;
    if (product.completeness.gaps.length > 0) needsAttention += 1;
  }

  const score = totalWeight === 0 ? 0 : Math.round(weightedSum / totalWeight);

  return {
    score,
    band:
      score >= PROTECTION_BAND_STRONG
        ? 'strong'
        : score >= PROTECTION_BAND_FAIR
          ? 'fair'
          : 'needs_attention',
    productCount: products.length,
    needsAttentionCount: needsAttention,
  };
}

/**
 * Builds the scored view of a product. Products the user no longer owns are
 * excluded by the caller via `isScorable` rather than being silently zeroed.
 */
export function scoreProduct(
  id: string,
  input: ProtectionInput,
  today: CalendarDate,
): ScoredProduct {
  const snapshot = getWarrantySnapshot(
    {
      purchaseDate: input.purchaseDate,
      warrantyStart: input.warrantyStart,
      warrantyEnd: input.warrantyEnd,
      durationMonths: input.durationMonths,
      extensionMonths: input.extensionMonths,
    },
    today,
  );
  return { id, completeness: getProtectionCompleteness(input), status: snapshot.status };
}

/** Sold and disposed products are out of the portfolio entirely. */
export function isScorable(lifecycle: ProductLifecycle): boolean {
  return lifecycle !== 'sold' && lifecycle !== 'disposed';
}

/**
 * Priority ordering for the Home action list. Combines how much protection the
 * gap is worth with how urgent the product is, so "add a receipt for the TV
 * whose warranty ends in 12 days" outranks "add a model number for a laptop with
 * two years left".
 */
export type SuggestedAction = {
  productId: string;
  key: ProtectionFactorKey;
  weight: number;
  priority: number;
};

export function buildSuggestedActions(
  products: (ScoredProduct & { daysRemaining: number | null })[],
  limit = 4,
): SuggestedAction[] {
  const actions: SuggestedAction[] = [];

  for (const product of products) {
    for (const gap of product.completeness.gaps) {
      actions.push({
        productId: product.id,
        key: gap.key,
        weight: gap.weight,
        priority: gap.weight * urgencyMultiplier(product.status, product.daysRemaining),
      });
    }
  }

  actions.sort((a, b) => b.priority - a.priority);
  return actions.slice(0, limit);
}

function urgencyMultiplier(status: WarrantyStatus, daysRemaining: number | null): number {
  if (status === 'expired') return 0.2;
  if (status === 'unknown') return 1.2;
  if (daysRemaining === null) return 1;
  // Anything inside the reminder window is where missing information actually
  // costs the user something, so it is weighted hardest.
  if (daysRemaining <= 30) return 2.5;
  if (daysRemaining <= 90) return 1.6;
  return 1;
}
