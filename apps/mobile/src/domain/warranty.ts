import {
  addMonths,
  compareCalendarDates,
  daysBetween,
  isCalendarDate,
  maxCalendarDate,
  type CalendarDate,
} from './date';

/**
 * The warranty status engine.
 *
 * This is the single source of truth for "is this covered, and for how much longer".
 * It is pure: no I/O, no clock access, no locale. Every input is passed in, which is
 * what makes it testable and what lets the same logic run in an Edge Function when
 * the server schedules reminders.
 */

/** Where a warranty period ends up in its life. */
export type WarrantyStatus = 'active' | 'ending_soon' | 'expired' | 'unknown';

/**
 * Where the *product* is in its life. Kept separate from warranty status because a
 * product can be under an open claim while its warranty is still active, and can be
 * sold while the warranty still has time left on it.
 */
export type ProductLifecycle =
  | 'active'
  | 'claim_open'
  | 'repair_in_progress'
  | 'replaced'
  | 'sold'
  | 'disposed';

/**
 * How a warranty end date came to exist. Surfaced to the user as a provenance line
 * on the warranty card — see the trust layer in ARCHITECTURE.md.
 */
export type WarrantySource =
  | 'user_entered'
  | 'manufacturer'
  | 'retailer'
  | 'internal_db'
  | 'document_extraction'
  | 'ai_inferred';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export const DEFAULT_ENDING_SOON_WINDOW_DAYS = 30;

export type WarrantyPeriodInput = {
  /** When the user bought it. Anchors the warranty unless a start date overrides. */
  purchaseDate: CalendarDate | null;
  /**
   * Explicit warranty start. Differs from purchase for pre-orders, delivered
   * appliances and installed equipment, where cover starts on delivery/installation.
   */
  warrantyStart?: CalendarDate | null;
  /** Explicit end date. Always wins over a computed one — it is the more specific fact. */
  warrantyEnd?: CalendarDate | null;
  durationMonths?: number | null;
  /** Additional cover purchased separately, added on top of the base period. */
  extensionMonths?: number | null;
};

export type WarrantyPeriod = {
  start: CalendarDate | null;
  end: CalendarDate | null;
  /** True when `end` was derived from a duration rather than stated outright. */
  derived: boolean;
};

/**
 * Resolves the effective warranty window.
 *
 * Precedence, most specific first:
 *   1. an explicit end date (from a document or the user)
 *   2. start + duration + any purchased extension
 *   3. nothing — an unknown warranty, which the UI must show as unknown rather than
 *      quietly defaulting to 12 months. Inventing a warranty period is the single
 *      most damaging thing this app could do.
 */
export function resolveWarrantyPeriod(input: WarrantyPeriodInput): WarrantyPeriod {
  const start = resolveStart(input);

  if (input.warrantyEnd && isCalendarDate(input.warrantyEnd)) {
    return { start, end: input.warrantyEnd, derived: false };
  }

  const base = input.durationMonths ?? null;
  if (start && base !== null && Number.isFinite(base) && base > 0) {
    const totalMonths = base + Math.max(0, input.extensionMonths ?? 0);
    return { start, end: addMonths(start, totalMonths), derived: true };
  }

  return { start, end: null, derived: false };
}

function resolveStart(input: WarrantyPeriodInput): CalendarDate | null {
  if (input.warrantyStart && isCalendarDate(input.warrantyStart)) {
    return input.warrantyStart;
  }
  if (input.purchaseDate && isCalendarDate(input.purchaseDate)) {
    return input.purchaseDate;
  }
  return null;
}

export type WarrantySnapshot = {
  status: WarrantyStatus;
  start: CalendarDate | null;
  end: CalendarDate | null;
  /**
   * Whole days from today until the end date. Negative once expired, `null` when the
   * end date is unknown. The day the warranty ends counts as covered, so an end date
   * of today yields 0 and status `ending_soon`, never `expired`.
   */
  daysRemaining: number | null;
  /** 0–1 through the warranty period; `null` when either endpoint is unknown. */
  progress: number | null;
  derived: boolean;
};

export function getWarrantySnapshot(
  input: WarrantyPeriodInput,
  today: CalendarDate,
  endingSoonWindowDays: number = DEFAULT_ENDING_SOON_WINDOW_DAYS,
): WarrantySnapshot {
  const { start, end, derived } = resolveWarrantyPeriod(input);

  if (!end) {
    return { status: 'unknown', start, end: null, daysRemaining: null, progress: null, derived };
  }

  const daysRemaining = daysBetween(today, end);
  const status: WarrantyStatus =
    daysRemaining < 0
      ? 'expired'
      : daysRemaining <= endingSoonWindowDays
        ? 'ending_soon'
        : 'active';

  return { status, start, end, daysRemaining, progress: computeProgress(start, end, today), derived };
}

function computeProgress(
  start: CalendarDate | null,
  end: CalendarDate | null,
  today: CalendarDate,
): number | null {
  if (!start || !end) return null;
  const total = daysBetween(start, end);
  if (total <= 0) return 1;
  const elapsed = daysBetween(start, today);
  return Math.min(1, Math.max(0, elapsed / total));
}

/**
 * Whether the app should offer "Check coverage" and "Report a problem" for a product.
 * A claim only makes sense while cover is live and the product still belongs to the
 * user — offering it on a sold or expired item wastes their time.
 */
export function canStartClaim(
  status: WarrantyStatus,
  lifecycle: ProductLifecycle,
): boolean {
  if (lifecycle === 'sold' || lifecycle === 'disposed') return false;
  return status === 'active' || status === 'ending_soon';
}

/**
 * Confidence shown to the user, derived from where the data came from.
 * `ai_inferred` never reaches `high`: the app must not present a model's guess with
 * the same authority as a manufacturer's published terms.
 */
export function confidenceForSource(
  source: WarrantySource,
  verifiedAt: string | null,
): ConfidenceLevel {
  switch (source) {
    case 'manufacturer':
      return verifiedAt ? 'high' : 'medium';
    case 'internal_db':
      return verifiedAt ? 'high' : 'medium';
    case 'retailer':
      return 'medium';
    case 'user_entered':
      // The user is authoritative about their own purchase.
      return 'high';
    case 'document_extraction':
      return 'medium';
    case 'ai_inferred':
      return 'low';
    default:
      return 'low';
  }
}

/**
 * True when the UI must ask the user to confirm rather than presenting the value as
 * settled. Drives the "We found a likely warranty of 24 months — please check"
 * treatment.
 */
export function requiresUserVerification(
  source: WarrantySource,
  confidence: ConfidenceLevel,
): boolean {
  if (source === 'user_entered') return false;
  return confidence !== 'high';
}

export type ProductWarrantyLike = {
  purchaseDate: CalendarDate | null;
  warrantyStart: CalendarDate | null;
  warrantyEnd: CalendarDate | null;
  durationMonths: number | null;
  extensionMonths: number | null;
};

/** Sort key for "what needs attention first": soonest live expiry, then the rest. */
export function warrantyUrgencyRank(snapshot: WarrantySnapshot): number {
  switch (snapshot.status) {
    case 'ending_soon':
      return 0;
    case 'active':
      return 1;
    case 'unknown':
      return 2;
    case 'expired':
      return 3;
    default:
      return 4;
  }
}

export function compareByUrgency(a: WarrantySnapshot, b: WarrantySnapshot): number {
  const rank = warrantyUrgencyRank(a) - warrantyUrgencyRank(b);
  if (rank !== 0) return rank;
  if (a.daysRemaining === null) return b.daysRemaining === null ? 0 : 1;
  if (b.daysRemaining === null) return -1;
  return a.daysRemaining - b.daysRemaining;
}

/**
 * A product's warranty window can never start before it was bought. Guards against a
 * bad OCR read putting a warranty start in the wrong year.
 */
export function clampStartToPurchase(
  warrantyStart: CalendarDate | null,
  purchaseDate: CalendarDate | null,
): CalendarDate | null {
  if (!warrantyStart) return purchaseDate;
  if (!purchaseDate) return warrantyStart;
  return maxCalendarDate(warrantyStart, purchaseDate);
}

export function isEndBeforeStart(period: WarrantyPeriod): boolean {
  if (!period.start || !period.end) return false;
  return compareCalendarDates(period.end, period.start) < 0;
}

export type WarrantySummaryCounts = {
  active: number;
  endingSoon: number;
  expired: number;
  unknown: number;
  total: number;
};

export function summarise(snapshots: WarrantySnapshot[]): WarrantySummaryCounts {
  const counts: WarrantySummaryCounts = {
    active: 0,
    endingSoon: 0,
    expired: 0,
    unknown: 0,
    total: snapshots.length,
  };
  for (const snapshot of snapshots) {
    if (snapshot.status === 'active') counts.active += 1;
    else if (snapshot.status === 'ending_soon') counts.endingSoon += 1;
    else if (snapshot.status === 'expired') counts.expired += 1;
    else counts.unknown += 1;
  }
  return counts;
}
