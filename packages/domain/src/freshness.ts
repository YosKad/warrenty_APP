/**
 * Freshness, per class of fact.
 *
 * A single global interval is wrong in both directions at once: a service
 * phone number that has not been checked in a year is probably dead, while a
 * warranty policy that has not been checked in a year is almost certainly still
 * accurate. The intervals live in `freshness_policies` so they can be tuned
 * without a deploy; the defaults below mirror the seeded rows and are what the
 * console falls back to if a class has no row yet.
 */

export type DataClass =
  | 'provider_contact'
  | 'service_location'
  | 'opening_hours'
  | 'service_capability'
  | 'importer_relationship'
  | 'warranty_policy';

export type FreshnessPolicy = {
  dataClass: DataClass;
  recheckAfterDays: number;
  staleAfterDays: number;
};

export const DEFAULT_FRESHNESS: Record<DataClass, FreshnessPolicy> = {
  provider_contact: {
    dataClass: 'provider_contact',
    recheckAfterDays: 180,
    staleAfterDays: 365,
  },
  service_location: {
    dataClass: 'service_location',
    recheckAfterDays: 270,
    staleAfterDays: 540,
  },
  opening_hours: { dataClass: 'opening_hours', recheckAfterDays: 180, staleAfterDays: 365 },
  service_capability: {
    dataClass: 'service_capability',
    recheckAfterDays: 365,
    staleAfterDays: 730,
  },
  importer_relationship: {
    dataClass: 'importer_relationship',
    recheckAfterDays: 365,
    staleAfterDays: 730,
  },
  warranty_policy: {
    dataClass: 'warranty_policy',
    recheckAfterDays: 540,
    staleAfterDays: 1095,
  },
};

/**
 * `unknown` is its own state, not a synonym for stale.
 *
 * A record nobody ever verified and a record verified two years ago are
 * different problems: the first needs a first look, the second needs a second
 * one. The queues in the console treat them separately, so the type does too.
 */
export type FreshnessState = 'fresh' | 'due' | 'stale' | 'unknown';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function freshnessOf(
  verifiedAt: string | Date | null | undefined,
  dataClass: DataClass,
  options: { now?: Date; policy?: FreshnessPolicy } = {},
): FreshnessState {
  if (!verifiedAt) return 'unknown';

  const policy = options.policy ?? DEFAULT_FRESHNESS[dataClass];
  const now = options.now ?? new Date();
  const verified = verifiedAt instanceof Date ? verifiedAt : new Date(verifiedAt);
  if (Number.isNaN(verified.getTime())) return 'unknown';

  const ageDays = (now.getTime() - verified.getTime()) / MS_PER_DAY;
  if (ageDays >= policy.staleAfterDays) return 'stale';
  if (ageDays >= policy.recheckAfterDays) return 'due';
  return 'fresh';
}

/** Age in whole days, or null when nothing was ever verified. */
export function ageInDays(
  verifiedAt: string | Date | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!verifiedAt) return null;
  const verified = verifiedAt instanceof Date ? verifiedAt : new Date(verifiedAt);
  if (Number.isNaN(verified.getTime())) return null;
  return Math.floor((now.getTime() - verified.getTime()) / MS_PER_DAY);
}

/**
 * Orders a re-verification queue.
 *
 * Sorted by how overdue a record is relative to *its own* interval rather than
 * by absolute age, so a phone number 30 days past its recheck date outranks a
 * warranty policy 200 days past nothing. Never-verified records come first:
 * they are the only ones where we have no evidence at all.
 */
export function overdueRatio(
  verifiedAt: string | Date | null | undefined,
  dataClass: DataClass,
  options: { now?: Date; policy?: FreshnessPolicy } = {},
): number {
  const age = ageInDays(verifiedAt, options.now ?? new Date());
  if (age === null) return Number.POSITIVE_INFINITY;
  const policy = options.policy ?? DEFAULT_FRESHNESS[dataClass];
  return age / policy.recheckAfterDays;
}
