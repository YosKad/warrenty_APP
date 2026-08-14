import type { CalendarDate } from './date';
import type { ConfidenceLevel, WarrantySource } from './warranty';

/**
 * Warranty intelligence.
 *
 * The reasoning layer between "we have some warranty rows" and "here is what
 * your warranty says". Everything in this file is pure and deterministic — no
 * model is involved in deciding which policy applies, how confident we are, or
 * whether two sources disagree. A model may later summarise a clause, but it may
 * never decide that a clause is yours.
 *
 * Three rules run through it:
 *
 *   1. Specificity is evidence, not preference. A policy naming your importer and
 *      your model is a better answer than one naming your brand, and the score
 *      says so numerically rather than by ordering alone.
 *   2. A lower-trust source never silently overrides a higher-trust one, and two
 *      comparable sources that disagree produce a conflict the user is shown —
 *      not a coin toss presented as fact.
 *   3. Unknown is a valid answer. Every function here can return "we don't know",
 *      and none of them has a fallback that invents a duration.
 */

// --------------------------------------------------------------------------
// Source hierarchy
// --------------------------------------------------------------------------

/**
 * Trust order, most trusted first. Lower number wins.
 *
 * `manufacturer` covers importer documentation too: in the schema an importer's
 * own warranty booklet is a `manufacturer`-kind source attached to the importer
 * organisation, because from the owner's point of view it is the document that
 * governs the product, whoever published it.
 */
export const SOURCE_PRIORITY: Record<WarrantySource, number> = {
  manufacturer: 1,
  internal_db: 2,
  retailer: 3,
  document_extraction: 4,
  user_entered: 5,
  ai_inferred: 6,
};

export type VerificationState =
  | 'unverified'
  | 'ai_extracted'
  | 'community_submitted'
  | 'verified'
  | 'official';

const VERIFICATION_RANK: Record<VerificationState, number> = {
  official: 0,
  verified: 1,
  community_submitted: 2,
  ai_extracted: 3,
  unverified: 4,
};

/**
 * Whether `a` strictly outranks `b` as a source of truth. Requires being at
 * least as good on *both* axes and better on one — so a well-verified retailer
 * document does not lose to an unverified manufacturer page purely on kind.
 */
export function outranksSource(
  a: { source: WarrantySource; verification: VerificationState },
  b: { source: WarrantySource; verification: VerificationState },
): boolean {
  const kindA = SOURCE_PRIORITY[a.source];
  const kindB = SOURCE_PRIORITY[b.source];
  const verA = VERIFICATION_RANK[a.verification];
  const verB = VERIFICATION_RANK[b.verification];
  if (kindA <= kindB && verA <= verB) return kindA < kindB || verA < verB;
  return false;
}

// --------------------------------------------------------------------------
// Match confidence
// --------------------------------------------------------------------------

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

export function matchState(
  score: number,
  verification: VerificationState,
): MatchState {
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

// --------------------------------------------------------------------------
// Conflicts
// --------------------------------------------------------------------------

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

// --------------------------------------------------------------------------
// Clauses
// --------------------------------------------------------------------------

export type ClauseType =
  | 'coverage'
  | 'exclusion'
  | 'condition'
  | 'procedure'
  | 'duration'
  | 'service_fee'
  | 'claim_requirement'
  | 'geographic_restriction'
  | 'other';

export type WarrantyClause = {
  id: string;
  clauseType: ClauseType;
  /** Short label. Falls back to the section when extraction produced none. */
  title: string | null;
  /** Plain-language restatement. May be model-written. */
  summary: string | null;
  /** Verbatim from the document. This is what "view source" shows. */
  sourceText: string;
  section: string | null;
  sourceSection: string | null;
  sourcePage: number | null;
  coverageCategories: string[];
  confidence: ConfidenceLevel;
  verification: VerificationState;
};

export type ClauseGroups = {
  covered: WarrantyClause[];
  notCovered: WarrantyClause[];
  /** Durations, service fees and conditional cover — the "read this" group. */
  specialConditions: WarrantyClause[];
  claimRequirements: WarrantyClause[];
  geographic: WarrantyClause[];
};

export function groupClauses(clauses: WarrantyClause[]): ClauseGroups {
  const groups: ClauseGroups = {
    covered: [],
    notCovered: [],
    specialConditions: [],
    claimRequirements: [],
    geographic: [],
  };

  for (const clause of clauses) {
    switch (clause.clauseType) {
      case 'coverage':
        groups.covered.push(clause);
        break;
      case 'exclusion':
        groups.notCovered.push(clause);
        break;
      // Duration, fees and conditions all answer "yes, but" — grouping them
      // together is what stops a 10-year motor term being lost among exclusions.
      case 'duration':
      case 'service_fee':
      case 'condition':
        groups.specialConditions.push(clause);
        break;
      case 'claim_requirement':
      case 'procedure':
        groups.claimRequirements.push(clause);
        break;
      case 'geographic_restriction':
        groups.geographic.push(clause);
        break;
      default:
        break;
    }
  }

  return groups;
}

/** What a clause row should read as. Never invents text when extraction found none. */
export function clauseHeadline(clause: WarrantyClause): string {
  return clause.title ?? clause.summary ?? clause.section ?? clause.sourceText.slice(0, 80);
}

// --------------------------------------------------------------------------
// User overrides
// --------------------------------------------------------------------------

export type OverrideField =
  | 'importer'
  | 'warranty_provider'
  | 'service_provider'
  | 'retailer'
  | 'duration_months'
  | 'warranty_end'
  | 'policy';

export type WarrantyOverride = {
  field: OverrideField;
  value: string | number;
  previousValue: string | number | null;
  createdAt: string;
};

/**
 * A value plus where it came from. Anything a user corrected reads as
 * user-provided from that moment on — an official record they disagreed with is
 * no longer an official record of what they have.
 */
export type SourcedValue<T> = {
  value: T;
  source: WarrantySource;
  verification: VerificationState;
  /** True when this value came from the user overriding a matched one. */
  isOverride: boolean;
};

export function applyOverride<T extends string | number>(
  matched: SourcedValue<T> | null,
  override: WarrantyOverride | undefined,
): SourcedValue<T> | null {
  if (!override) return matched;
  return {
    value: override.value as T,
    // Never inherits the matched value's provenance. That inheritance is exactly
    // how a user's guess ends up displayed as "official".
    source: 'user_entered',
    verification: 'unverified',
    isOverride: true,
  };
}

// --------------------------------------------------------------------------
// The assembled object
// --------------------------------------------------------------------------

export type ProviderRole =
  | 'manufacturer'
  | 'importer'
  | 'retailer'
  | 'warranty_provider'
  | 'service_provider';

export type ProviderLink = {
  role: ProviderRole;
  organisationId: string | null;
  name: string;
  /** Shown in the source line, never as a headline. */
  isUserProvided: boolean;
};

export type WarrantySourceRef = {
  sourceId: string | null;
  kind: WarrantySource;
  documentTitle: string | null;
  documentVersion: string | null;
  sourceUrl: string | null;
  /** Set when the source is a document in the user's own storage. */
  documentId: string | null;
  pageCount: number | null;
  retrievedAt: string | null;
  lastVerifiedAt: string | null;
  effectiveFrom: CalendarDate | null;
  verification: VerificationState;
};

export type WarrantyIntelligence = {
  productId: string;
  /** Null when nothing matched. The UI shows the "not identified yet" state. */
  policy: {
    warrantyId: string;
    durationMonths: number | null;
    policyVersion: string | null;
    coverageSummary: string | null;
    exclusionsSummary: string | null;
    specialConditionsSummary: string | null;
    validFrom: CalendarDate | null;
    validTo: CalendarDate | null;
  } | null;
  /** The five roles, only those actually known. Never collapsed into one. */
  providerChain: ProviderLink[];
  clauses: ClauseGroups;
  source: WarrantySourceRef | null;
  matchState: MatchState;
  matchScore: number;
  signals: MatchSignals;
  conflicts: WarrantyConflict[];
  /** When matching last ran, so a stale answer can be labelled as one. */
  resolvedAt: string | null;
  /** Fraction of the intelligence fields we actually have, 0–1. */
  completeness: number;
};

/**
 * How much of the picture we have. Used to decide whether the section leads with
 * an answer or with a prompt to supply something — not shown as a number.
 */
export function intelligenceCompleteness(intel: {
  policy: WarrantyIntelligence['policy'];
  providerChain: ProviderLink[];
  clauses: ClauseGroups;
  source: WarrantySourceRef | null;
}): number {
  const checks = [
    intel.policy !== null,
    intel.policy?.durationMonths != null,
    intel.providerChain.some((p) => p.role === 'warranty_provider'),
    intel.providerChain.some((p) => p.role === 'service_provider'),
    intel.clauses.covered.length > 0,
    intel.clauses.notCovered.length > 0,
    intel.source !== null,
  ];
  return checks.filter(Boolean).length / checks.length;
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

/** True when there is enough to show the "Your warranty" section at all. */
export function hasIdentifiedWarranty(intel: WarrantyIntelligence): boolean {
  return intel.policy !== null && intel.matchState !== 'unknown';
}
