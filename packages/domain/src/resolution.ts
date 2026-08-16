import {
  detectConflicts,
  matchState,
  rankCandidates,
  scoreMatch,
  type MatchState,
  type PolicyCandidate,
} from './match';
import { freshnessOf, type FreshnessState } from './freshness';

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
  | 'insufficient_receipt_data';

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
  if (!input.model || !input.modelRecognised) {
    failures.add('model_unknown');
  }
  // Brand and model alone are enough to identify a product; the category is
  // usually derivable from the model and is not worth failing a case over.
  const productIdentified =
    !!input.brandName && input.brandResolvedToOrganisation && input.modelRecognised;

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

  if (!leader) failures.add('policy_missing');
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

  // ---- 3. Provider resolved -----------------------------------------------
  if (!input.warrantyProviderKnown) failures.add('provider_unknown');
  // Only worth reporting where it actually blocks the chain: an imported
  // product whose importer is unknown cannot be routed in-country.
  if (!input.importerKnown && !input.warrantyProviderKnown) {
    failures.add('importer_unknown');
  }
  const providerResolved = warrantyResolved && input.warrantyProviderKnown;

  // ---- 4. Service route resolved ------------------------------------------
  const serviceRouteResolved =
    providerResolved && input.serviceProviderKnown && input.serviceOptionKnown;

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

  return {
    stages,
    fullyResolved: RESOLUTION_STAGES.every((stage) => stages[stage]),
    // Sorted so two runs of the same case produce comparable rows.
    failureReasons: [...failures].sort(),
    matchedWarrantyId: leader?.warrantyId ?? null,
    matchScore: score,
    matchState: state,
    contactFreshness,
  };
}

export type ResolutionRates = {
  total: number;
  productIdentificationRate: number;
  warrantyResolutionRate: number;
  providerResolutionRate: number;
  serviceRouteResolutionRate: number;
  fullResolutionRate: number;
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
  product_unknown: 0,
  model_unknown: 0,
  insufficient_receipt_data: 1,
  policy_missing: 1,
  conflicting_policy: 1,
  country_mismatch: 1,
  importer_unknown: 2,
  provider_unknown: 2,
  contact_missing: 3,
  stale_data: 3,
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
