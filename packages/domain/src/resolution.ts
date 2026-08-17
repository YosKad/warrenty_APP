import {
  detectConflicts,
  matchState,
  rankCandidates,
  scoreMatch,
  type MatchState,
  type PolicyCandidate,
} from './match';
import { freshnessOf, type FreshnessState } from './freshness';
import type { ModelResolution } from './modelMatch';

/**
 * The Full Resolution Rate.
 *
 * The only KPI that describes what the product promises. A warranty resolved
 * against a provider nobody can reach is not a resolved warranty, so the metric
 * is deliberately conjunctive: five stages, all of which must hold, and the
 * headline number is the share of test cases that clear every one.
 *
 * Partial rates are reported alongside it because they are what tells an
 * operator *which* table to go and fill in. They are never reported instead of
 * it.
 */

export type ResolutionStage =
  | 'product_identified'
  | 'warranty_resolved'
  | 'provider_resolved'
  | 'service_route_resolved'
  | 'contact_actionable';

export const RESOLUTION_STAGES: ResolutionStage[] = [
  'product_identified',
  'warranty_resolved',
  'provider_resolved',
  'service_route_resolved',
  'contact_actionable',
];

/** Mirrors the `resolution_failure` enum. */
export type ResolutionFailure =
  | 'product_unknown'
  | 'model_unknown'
  | 'policy_missing'
  | 'importer_unknown'
  | 'provider_unknown'
  | 'contact_missing'
  | 'conflicting_policy'
  | 'country_mismatch'
  | 'stale_data'
  | 'insufficient_receipt_data'
  // Added in Phase I.5. Each one names a fix rather than a symptom: an operator
  // reading "model_alias_missing" knows to add an alias, and a reviewer reading
  // "model_pattern_too_broad" knows to narrow a pattern before it mismatches
  // something.
  | 'model_alias_missing'
  | 'model_ambiguous'
  | 'model_pattern_too_broad'
  | 'model_pattern_no_match'
  | 'importer_conflict'
  | 'policy_date_conflict'
  | 'service_capability_missing'
  | 'location_missing';

export type ResolutionInput = {
  /** What the case supplies, exactly as a scanned receipt would. */
  brandName: string | null;
  model: string | null;
  categoryKnown: boolean;
  countryCode: string | null;
  purchaseDate: string | null;

  /** What the database answered with. */
  brandResolvedToOrganisation: boolean;
  modelRecognised: boolean;
  candidates: PolicyCandidate[];
  /** The country the winning policy is scoped to, if it is scoped at all. */
  policyCountryCode: string | null;

  importerKnown: boolean;
  warrantyProviderKnown: boolean;
  serviceProviderKnown: boolean;
  /** A capability or a location that actually covers this brand and category. */
  serviceOptionKnown: boolean;
  /** Contacts that can be acted on directly — a dialable number, a form, a mail address. */
  actionableContactCount: number;

  /** When the provider contact route was last verified. Drives `stale_data`. */
  contactVerifiedAt: string | null;

  /**
   * What the staged matcher concluded about the model, when it ran.
   *
   * Optional so every existing caller keeps working. When present it replaces
   * `modelRecognised` as the source of truth, and it is what turns "the model
   * did not match" into a reason somebody can act on.
   */
  modelResolution?: ModelResolution | null;

  /** A receipt naming an importer the resolved policy does not. */
  receiptImporterId?: string | null;
  policyImporterId?: string | null;

  /** Split out of `serviceOptionKnown` so the fix is identifiable. */
  serviceCapabilityKnown?: boolean;
  serviceLocationKnown?: boolean;

  now?: Date;
};

export type ResolutionOutcome = {
  stages: Record<ResolutionStage, boolean>;
  fullyResolved: boolean;
  failureReasons: ResolutionFailure[];
  matchedWarrantyId: string | null;
  matchScore: number | null;
  matchState: MatchState | null;
  contactFreshness: FreshnessState;

  /** Resolved with nothing asked of the user. The Auto Resolution Rate. */
  autoResolved: boolean;
  /** Several credible answers, so the app asks instead of choosing. */
  ambiguous: boolean;
  /** What would settle it, when it is ambiguous. */
  distinguishers: string[];
  modelState: 'resolved' | 'ambiguous' | 'unresolved' | 'not_attempted';
  modelStage: string | null;
  modelId: string | null;
};

/**
 * Runs one case through the five stages.
 *
 * Every stage defaults to false. Nothing here has a fallback that assumes a
 * twelve-month term, an official importer or a support line — the whole purpose
 * of the metric is to count how often we genuinely know, and a metric with a
 * default in it counts something else.
 */
export function evaluateResolution(input: ResolutionInput): ResolutionOutcome {
  const now = input.now ?? new Date();
  const failures = new Set<ResolutionFailure>();

  // ---- 1. Product identified ----------------------------------------------
  if (!input.brandName || !input.brandResolvedToOrganisation) {
    failures.add('product_unknown');
  }
  // The staged matcher, when it ran, is more informative than a boolean: it
  // knows *why* the model did not resolve, and the difference between "we have
  // never heard of this" and "two products match and we will not guess" is the
  // difference between a data task and a product decision.
  const model = input.modelResolution ?? null;
  const modelRecognised = model ? model.state === 'resolved' : input.modelRecognised;

  if (model) {
    if (model.state === 'ambiguous') failures.add('model_ambiguous');
    if (model.state === 'unresolved') {
      const best = model.candidates[0];
      if (!best) {
        failures.add('model_unknown');
      } else if (best.stage === 'fuzzy' || best.stage === 'family') {
        // Near enough to see, not near enough to trust. An alias is the fix.
        failures.add('model_alias_missing');
      } else if (best.stage === 'pattern') {
        failures.add('model_pattern_too_broad');
      }
    }
    if (
      model.state !== 'resolved' &&
      model.candidates.length === 0 &&
      (input.model ?? '') !== ''
    ) {
      failures.add('model_pattern_no_match');
    }
  } else if (!input.model || !input.modelRecognised) {
    failures.add('model_unknown');
  }

  // Brand and model alone are enough to identify a product; the category is
  // usually derivable from the model and is not worth failing a case over.
  const productIdentified =
    !!input.brandName && input.brandResolvedToOrganisation && modelRecognised;

  if (!input.purchaseDate) {
    // Not fatal on its own — a policy still applies — but without it the app
    // cannot say whether cover is still running, which is the question asked.
    failures.add('insufficient_receipt_data');
  }

  // ---- 2. Warranty resolved -----------------------------------------------
  const ranked = rankCandidates(input.candidates);
  const leader = ranked[0] ?? null;
  const score = leader ? scoreMatch(leader.signals) : null;
  const state = leader ? matchState(score ?? 0, leader.verification) : null;
  const conflicts = detectConflicts(input.candidates);

  // No policy at all, and a policy too weak to state, are the same outcome for
  // the person asking: we have nothing we are willing to tell them. Reporting
  // only the first would leave a stage failing with no reason attached, which
  // is the one thing a failure-reason list must never do.
  if (!leader || state === 'unknown') failures.add('policy_missing');
  if (conflicts.length > 0) failures.add('conflicting_policy');

  if (
    input.countryCode &&
    input.policyCountryCode &&
    input.countryCode.toUpperCase() !== input.policyCountryCode.toUpperCase()
  ) {
    failures.add('country_mismatch');
  }

  // A policy the resolver itself calls unknown has not resolved anything, and a
  // policy contradicted by a comparable one has resolved to a question.
  const warrantyResolved =
    productIdentified &&
    leader !== null &&
    state !== null &&
    state !== 'unknown' &&
    conflicts.length === 0 &&
    !failures.has('country_mismatch');

  // A policy whose validity window excludes the purchase is not a near miss —
  // it is the terms of a different year, and the pilot found this exact case.
  if (
    input.purchaseDate &&
    leader &&
    ((leader.validFrom !== null && leader.validFrom > input.purchaseDate) ||
      (leader.validTo !== null && leader.validTo < input.purchaseDate))
  ) {
    failures.add('policy_date_conflict');
  }

  // ---- 3. Provider resolved -----------------------------------------------
  if (!input.warrantyProviderKnown) failures.add('provider_unknown');

  // A receipt naming one importer while the policy names another usually means
  // the product came in outside the official channel — which is precisely when
  // the official importer's terms do not apply. Not a tie to be broken.
  if (
    input.receiptImporterId &&
    input.policyImporterId &&
    input.receiptImporterId !== input.policyImporterId
  ) {
    failures.add('importer_conflict');
  }
  // Only worth reporting where it actually blocks the chain: an imported
  // product whose importer is unknown cannot be routed in-country.
  if (!input.importerKnown && !input.warrantyProviderKnown) {
    failures.add('importer_unknown');
  }
  const providerResolved = warrantyResolved && input.warrantyProviderKnown;

  // ---- 4. Service route resolved ------------------------------------------
  // Split when the caller knows the difference: "they have no branches" and
  // "we do not know what they can do" are different tasks for the data team.
  if (!input.serviceOptionKnown) {
    if (input.serviceCapabilityKnown === false) failures.add('service_capability_missing');
    if (input.serviceLocationKnown === false) failures.add('location_missing');
  }

  const serviceRouteResolved =
    providerResolved &&
    input.serviceProviderKnown &&
    input.serviceOptionKnown &&
    !failures.has('importer_conflict');

  // ---- 5. Contact actionable ----------------------------------------------
  const contactFreshness = freshnessOf(input.contactVerifiedAt, 'provider_contact', { now });
  if (input.actionableContactCount === 0) failures.add('contact_missing');
  if (contactFreshness === 'stale') failures.add('stale_data');

  const contactActionable =
    serviceRouteResolved && input.actionableContactCount > 0 && contactFreshness !== 'stale';

  const stages: Record<ResolutionStage, boolean> = {
    product_identified: productIdentified,
    warranty_resolved: warrantyResolved,
    provider_resolved: providerResolved,
    service_route_resolved: serviceRouteResolved,
    contact_actionable: contactActionable,
  };

  const fullyResolved = RESOLUTION_STAGES.every((stage) => stages[stage]);
  const ambiguous = model?.state === 'ambiguous';

  return {
    stages,
    fullyResolved,
    // Sorted so two runs of the same case produce comparable rows.
    failureReasons: [...failures].sort(),
    matchedWarrantyId: leader?.warrantyId ?? null,
    matchScore: score,
    matchState: state,
    contactFreshness,

    // Resolved *and* nothing was asked of the user. A case that only worked
    // because the app stopped to ask which television this is has not been
    // resolved automatically, and counting it as though it had would hide the
    // cost the user actually paid.
    autoResolved: fullyResolved && !ambiguous,
    ambiguous: Boolean(ambiguous),
    distinguishers: ambiguous ? [...(model?.distinguishers ?? [])] : [],
    modelState: model ? model.state : 'not_attempted',
    modelStage: model?.resolved?.stage ?? model?.candidates[0]?.stage ?? null,
    modelId: model?.resolved?.model?.id ?? null,
  };
}

export type ResolutionRates = {
  total: number;
  productIdentificationRate: number;
  warrantyResolutionRate: number;
  providerResolutionRate: number;
  serviceRouteResolutionRate: number;
  fullResolutionRate: number;
  /** Resolved without asking the user anything. */
  autoResolutionRate: number;
  /** Several credible candidates, so we asked. */
  ambiguityRate: number;
};

/** Rates over a set of outcomes. Zero cases produce zero rates, never 100%. */
export function resolutionRates(outcomes: ResolutionOutcome[]): ResolutionRates {
  const total = outcomes.length;
  const share = (predicate: (o: ResolutionOutcome) => boolean) =>
    total === 0 ? 0 : outcomes.filter(predicate).length / total;

  return {
    total,
    productIdentificationRate: share((o) => o.stages.product_identified),
    warrantyResolutionRate: share((o) => o.stages.warranty_resolved),
    providerResolutionRate: share((o) => o.stages.provider_resolved),
    serviceRouteResolutionRate: share((o) => o.stages.service_route_resolved),
    fullResolutionRate: share((o) => o.fullyResolved),
    autoResolutionRate: share((o) => o.autoResolved),
    ambiguityRate: share((o) => o.ambiguous),
  };
}

/**
 * The False Resolution Rate.
 *
 * Measured over *reviewed* runs only. Dividing by every run would drive the
 * number towards zero simply by running the suite more often, which is a metric
 * that rewards not looking.
 *
 * This is the number to watch. A case we could not resolve costs a user a
 * search; a case we resolved wrongly costs them a trip to a service centre that
 * was never going to honour their warranty.
 */
export function falseResolutionRate(
  reviewed: { falseResolution: boolean | null }[],
): { reviewed: number; rate: number } {
  const judged = reviewed.filter((run) => run.falseResolution !== null);
  if (judged.length === 0) return { reviewed: 0, rate: 0 };
  return {
    reviewed: judged.length,
    rate: judged.filter((run) => run.falseResolution).length / judged.length,
  };
}

/**
 * Which failure to fix first.
 *
 * Counts reasons across a suite and orders them by how many cases they block,
 * so the operator's next task comes out of the data rather than out of a
 * hunch. Ties break on the stage the reason belongs to — fixing a product
 * identification failure unblocks everything downstream of it.
 */
const REASON_STAGE_ORDER: Record<ResolutionFailure, number> = {
  // Stage 0 — the product was not identified. Everything downstream is blocked.
  product_unknown: 0,
  model_unknown: 0,
  model_alias_missing: 0,
  model_ambiguous: 0,
  model_pattern_no_match: 0,
  model_pattern_too_broad: 0,
  // Stage 1 — the terms.
  insufficient_receipt_data: 1,
  policy_missing: 1,
  conflicting_policy: 1,
  country_mismatch: 1,
  policy_date_conflict: 1,
  // Stage 2 — who is on the hook.
  importer_unknown: 2,
  importer_conflict: 2,
  provider_unknown: 2,
  // Stage 3 — how to reach them.
  contact_missing: 3,
  stale_data: 3,
  service_capability_missing: 3,
  location_missing: 3,
};

export function rankFailureReasons(
  outcomes: ResolutionOutcome[],
): { reason: ResolutionFailure; count: number }[] {
  const counts = new Map<ResolutionFailure, number>();
  for (const outcome of outcomes) {
    for (const reason of outcome.failureReasons) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return REASON_STAGE_ORDER[a.reason] - REASON_STAGE_ORDER[b.reason];
    });
}
