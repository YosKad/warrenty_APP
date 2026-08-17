import type { CalendarDate } from './date';
import type { ConfidenceLevel, WarrantySource } from './warranty';
import type { MatchSignals, MatchState, VerificationState, WarrantyConflict } from '@mw/domain';

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
 *
 * The scoring and trust model themselves live in `@mw/domain`, shared with the
 * data operations console: a reviewer approving a policy there is predicting
 * what this app will show, and two copies of the weights is how that prediction
 * stops being true. They are re-exported here so the app's own modules keep
 * importing from one place.
 */

export {
  SOURCE_PRIORITY,
  outranksSource,
  MATCH_SIGNALS,
  MATCH_TOTAL_WEIGHT,
  MATCH_STRONG_THRESHOLD,
  MATCH_CONFIRM_THRESHOLD,
  MATCH_VERIFIED_THRESHOLD,
  MATCH_STALE_AFTER_DAYS,
  CONFLICT_SCORE_MARGIN,
  scoreMatch,
  matchState,
  rankCandidates,
  detectConflicts,
  isMatchStale,
} from '@mw/domain';

export type {
  VerificationState,
  MatchSignalKey,
  MatchSignals,
  MatchState,
  WarrantyConflict,
} from '@mw/domain';


/**
 * A policy in the running, with the signals that fired for it.
 *
 * Stated here rather than taken from the package because the app's own
 * `CalendarDate` and `ConfidenceLevel` carry the app's date invariants; the
 * shared version is deliberately looser so the console can hand it rows
 * straight out of PostgreSQL.
 */
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

/** True when there is enough to show the "Your warranty" section at all. */
export function hasIdentifiedWarranty(intel: WarrantyIntelligence): boolean {
  return intel.policy !== null && intel.matchState !== 'unknown';
}
