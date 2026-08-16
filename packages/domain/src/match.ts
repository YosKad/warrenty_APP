import {
  SOURCE_PRIORITY,
  VERIFICATION_RANK,
  type CalendarDate,
  type ConfidenceLevel,
  type VerificationState,
  type WarrantySource,
} from './sources';

/**
 * Warranty match scoring.
 *
 * Which policy applies to a product is a question with a determinate answer, so
 * it is answered determinately. No model is involved in deciding which policy is
 * yours; a model may later summarise a clause, but it may never decide that a
 * clause is yours.
 *
 * This file is the single source of truth for the weights. The mobile app
 * re-exports it, the console imports it, and the Deno transcription in
 * `supabase/functions/warranty-resolve` is pinned against it by a test — three
 * runtimes, one table of numbers.
 */

/**
 * The signals that can fire when matching a policy to a product. Weights total
 * exactly 100, guarded by a test — a score out of an unstated maximum is not a
 * score.
 *
 * Model carries most because it is the signal least likely to be coincidental.
 * Brand, country and importer are weighted equally: an imported product with the
 * wrong country's terms is precisely the failure this model exists to prevent.
 */
export const MATCH_SIGNALS = [
  { key: 'model', weight: 22 },
  { key: 'brand', weight: 14 },
  { key: 'country', weight: 14 },
  { key: 'importer', weight: 14 },
  { key: 'serial', weight: 10 },
  { key: 'validity', weight: 10 },
  { key: 'category', weight: 8 },
  { key: 'officialSource', weight: 8 },
] as const;

export type MatchSignalKey = (typeof MATCH_SIGNALS)[number]['key'];

export const MATCH_TOTAL_WEIGHT = MATCH_SIGNALS.reduce((sum, s) => sum + s.weight, 0);

export type MatchSignals = Partial<Record<MatchSignalKey, boolean>>;

/**
 * User-facing match states.
 *
 * Deliberately four words rather than a percentage. "83% confident" invites a
 * user to reason about a number whose meaning they cannot check; "needs
 * confirmation" tells them what to do.
 */
export type MatchState = 'verified' | 'strong' | 'needs_confirmation' | 'unknown';

export const MATCH_STRONG_THRESHOLD = 60;
export const MATCH_CONFIRM_THRESHOLD = 30;
/** Above this *and* verified by a person or an official document. */
export const MATCH_VERIFIED_THRESHOLD = 75;

export type PolicyCandidate = {
  warrantyId: string;
  durationMonths: number | null;
  providerId: string | null;
  providerName: string | null;
  policyVersion: string | null;
  source: WarrantySource;
  verification: VerificationState;
  confidence: ConfidenceLevel;
  validFrom: CalendarDate | null;
  validTo: CalendarDate | null;
  signals: MatchSignals;
};

export function scoreMatch(signals: MatchSignals): number {
  let earned = 0;
  for (const signal of MATCH_SIGNALS) {
    if (signals[signal.key]) earned += signal.weight;
  }
  return earned;
}

export function matchState(score: number, verification: VerificationState): MatchState {
  const officiallyVerified = verification === 'official' || verification === 'verified';
  if (officiallyVerified && score >= MATCH_VERIFIED_THRESHOLD) return 'verified';
  if (score >= MATCH_STRONG_THRESHOLD) return 'strong';
  if (score >= MATCH_CONFIRM_THRESHOLD) return 'needs_confirmation';
  return 'unknown';
}

/** Ranks candidates by score, breaking ties on source trust then verification. */
export function rankCandidates(candidates: PolicyCandidate[]): PolicyCandidate[] {
  return [...candidates].sort((a, b) => {
    const byScore = scoreMatch(b.signals) - scoreMatch(a.signals);
    if (byScore !== 0) return byScore;
    const bySource = SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source];
    if (bySource !== 0) return bySource;
    return VERIFICATION_RANK[a.verification] - VERIFICATION_RANK[b.verification];
  });
}

// ---------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------

/**
 * How close two candidates must be before disagreeing counts as a conflict.
 *
 * A policy matching on model, country and importer beating one that matches only
 * the brand is not a conflict — it is specificity doing its job. A conflict is
 * two comparably good answers that differ, which is the case where picking one
 * silently would be arbitrary.
 */
export const CONFLICT_SCORE_MARGIN = 15;

/**
 * Whether the leader is trustworthy enough that a disagreement from `other` is
 * not worth troubling the user with.
 *
 * Narrower than `outranksSource` on purpose. Source *tier* alone must not
 * silence a conflict, or the state becomes unreachable: an importer's booklet
 * and a retailer's booklet are different tiers and disagreeing between them is
 * exactly the case a user should get to arbitrate. Only two things silence it —
 * an inferred guess arguing with a document, and an unchecked record arguing
 * with one a person actually verified.
 */
function dominatesForConflict(
  leader: { source: WarrantySource; verification: VerificationState },
  other: { source: WarrantySource; verification: VerificationState },
): boolean {
  if (other.source === 'ai_inferred' && leader.source !== 'ai_inferred') return true;

  const leaderChecked =
    leader.verification === 'official' || leader.verification === 'verified';
  const otherUnchecked =
    other.verification === 'unverified' || other.verification === 'ai_extracted';
  return leaderChecked && otherUnchecked;
}

export type WarrantyConflict = {
  field: 'duration_months' | 'warranty_provider';
  /** The value from the leading candidate. */
  chosen: string;
  /** The value from the comparable candidate that disagrees. */
  alternative: string;
  chosenWarrantyId: string;
  alternativeWarrantyId: string;
};

export function detectConflicts(candidates: PolicyCandidate[]): WarrantyConflict[] {
  const ranked = rankCandidates(candidates);
  const leader = ranked[0];
  if (!leader) return [];

  const leaderScore = scoreMatch(leader.signals);
  const conflicts: WarrantyConflict[] = [];

  for (const other of ranked.slice(1)) {
    if (leaderScore - scoreMatch(other.signals) > CONFLICT_SCORE_MARGIN) continue;
    if (dominatesForConflict(leader, other)) continue;

    if (
      leader.durationMonths !== null &&
      other.durationMonths !== null &&
      leader.durationMonths !== other.durationMonths &&
      !conflicts.some((c) => c.field === 'duration_months')
    ) {
      conflicts.push({
        field: 'duration_months',
        chosen: String(leader.durationMonths),
        alternative: String(other.durationMonths),
        chosenWarrantyId: leader.warrantyId,
        alternativeWarrantyId: other.warrantyId,
      });
    }

    if (
      leader.providerId &&
      other.providerId &&
      leader.providerId !== other.providerId &&
      !conflicts.some((c) => c.field === 'warranty_provider')
    ) {
      conflicts.push({
        field: 'warranty_provider',
        chosen: leader.providerName ?? leader.providerId,
        alternative: other.providerName ?? other.providerId,
        chosenWarrantyId: leader.warrantyId,
        alternativeWarrantyId: other.warrantyId,
      });
    }
  }

  return conflicts;
}

/**
 * How old a resolved match may be before the UI calls it stale.
 *
 * A match is only as good as when it was worked out: a policy the manufacturer
 * reissued last month against a match resolved last year is exactly the case
 * where the app should say "last checked" rather than state a duration as though
 * it were current.
 */
export const MATCH_STALE_AFTER_DAYS = 30;

export function isMatchStale(resolvedAt: string | null, now = new Date()): boolean {
  // Not knowing when we last checked is the same as not having checked.
  if (!resolvedAt) return true;
  const age = now.getTime() - new Date(resolvedAt).getTime();
  return age > MATCH_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}
