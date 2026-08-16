import { describe, expect, it } from 'vitest';

import type { PolicyCandidate } from '../match';
import {
  evaluateResolution,
  rankFailureReasons,
  resolutionRates,
  type ResolutionInput,
} from '../resolution';

const NOW = new Date('2026-08-16T00:00:00Z');

const candidate = (over: Partial<PolicyCandidate> = {}): PolicyCandidate => ({
  warrantyId: 'w1',
  durationMonths: 24,
  providerId: 'org-importer',
  providerName: 'Samline',
  policyVersion: '2025.1',
  source: 'manufacturer',
  verification: 'official',
  confidence: 'high',
  validFrom: null,
  validTo: null,
  signals: { model: true, brand: true, country: true, importer: true, officialSource: true },
  ...over,
});

const resolvable = (over: Partial<ResolutionInput> = {}): ResolutionInput => ({
  brandName: 'Samsung',
  model: 'QN65S95D',
  categoryKnown: true,
  countryCode: 'IL',
  purchaseDate: '2025-03-01',
  brandResolvedToOrganisation: true,
  modelRecognised: true,
  candidates: [candidate()],
  policyCountryCode: 'IL',
  importerKnown: true,
  warrantyProviderKnown: true,
  serviceProviderKnown: true,
  serviceOptionKnown: true,
  actionableContactCount: 2,
  contactVerifiedAt: '2026-06-01T00:00:00Z',
  now: NOW,
  ...over,
});

describe('evaluateResolution', () => {
  it('clears all five stages when everything is actually known', () => {
    const outcome = evaluateResolution(resolvable());
    expect(outcome.fullyResolved).toBe(true);
    expect(outcome.failureReasons).toEqual([]);
    expect(outcome.matchedWarrantyId).toBe('w1');
  });

  it('stops at the first stage that fails, rather than crediting later ones', () => {
    // A service route "resolved" for a product we could not identify is not a
    // resolved route, and a conjunctive metric is the only honest one.
    const outcome = evaluateResolution(
      resolvable({ brandResolvedToOrganisation: false, modelRecognised: false }),
    );
    expect(outcome.stages.product_identified).toBe(false);
    expect(outcome.stages.warranty_resolved).toBe(false);
    expect(outcome.stages.provider_resolved).toBe(false);
    expect(outcome.stages.service_route_resolved).toBe(false);
    expect(outcome.stages.contact_actionable).toBe(false);
    expect(outcome.failureReasons).toContain('product_unknown');
    expect(outcome.failureReasons).toContain('model_unknown');
  });

  it('counts no policy as unresolved rather than as a default term', () => {
    const outcome = evaluateResolution(resolvable({ candidates: [] }));
    expect(outcome.failureReasons).toContain('policy_missing');
    expect(outcome.stages.warranty_resolved).toBe(false);
    expect(outcome.matchedWarrantyId).toBeNull();
  });

  it('gives a reason when the only policy is too weak to state', () => {
    // A brand-only match on a product bought abroad. There is a candidate, so
    // "no policy" is not the reason — but nothing is stated, so a stage must not
    // fail silently.
    const outcome = evaluateResolution(
      resolvable({
        candidates: [candidate({ signals: { brand: true } })],
        policyCountryCode: null,
      }),
    );
    expect(outcome.matchState).toBe('unknown');
    expect(outcome.stages.warranty_resolved).toBe(false);
    expect(outcome.failureReasons).toContain('policy_missing');
  });

  it('never leaves a failed stage without a reason', () => {
    const cases = [
      resolvable({ candidates: [] }),
      resolvable({ candidates: [candidate({ signals: { brand: true } })] }),
      resolvable({ brandResolvedToOrganisation: false }),
      resolvable({ warrantyProviderKnown: false }),
      resolvable({ actionableContactCount: 0 }),
      resolvable({ contactVerifiedAt: '2020-01-01T00:00:00Z' }),
    ];
    for (const input of cases) {
      const outcome = evaluateResolution(input);
      if (!outcome.fullyResolved) expect(outcome.failureReasons.length).toBeGreaterThan(0);
    }
  });

  it('treats two comparable policies that disagree as a failure, not a coin toss', () => {
    const outcome = evaluateResolution(
      resolvable({
        candidates: [
          candidate({ warrantyId: 'w1', durationMonths: 24 }),
          candidate({
            warrantyId: 'w2',
            durationMonths: 12,
            source: 'retailer',
            verification: 'official',
          }),
        ],
      }),
    );
    expect(outcome.failureReasons).toContain('conflicting_policy');
    expect(outcome.stages.warranty_resolved).toBe(false);
  });

  it('flags a policy scoped to the wrong country', () => {
    const outcome = evaluateResolution(resolvable({ policyCountryCode: 'US' }));
    expect(outcome.failureReasons).toContain('country_mismatch');
    expect(outcome.stages.warranty_resolved).toBe(false);
  });

  it('does not count a route reachable only through a stale number', () => {
    const outcome = evaluateResolution(
      resolvable({ contactVerifiedAt: '2024-01-01T00:00:00Z' }),
    );
    expect(outcome.contactFreshness).toBe('stale');
    expect(outcome.failureReasons).toContain('stale_data');
    expect(outcome.stages.service_route_resolved).toBe(true);
    expect(outcome.stages.contact_actionable).toBe(false);
    expect(outcome.fullyResolved).toBe(false);
  });

  it('reports a missing contact separately from a missing provider', () => {
    const noContact = evaluateResolution(resolvable({ actionableContactCount: 0 }));
    expect(noContact.failureReasons).toContain('contact_missing');
    expect(noContact.failureReasons).not.toContain('provider_unknown');

    const noProvider = evaluateResolution(resolvable({ warrantyProviderKnown: false }));
    expect(noProvider.failureReasons).toContain('provider_unknown');
  });

  it('records a missing purchase date without failing the whole case on it', () => {
    const outcome = evaluateResolution(resolvable({ purchaseDate: null }));
    expect(outcome.failureReasons).toContain('insufficient_receipt_data');
    expect(outcome.stages.warranty_resolved).toBe(true);
  });

  it('produces the same reasons in the same order for the same case', () => {
    const input = resolvable({ candidates: [], warrantyProviderKnown: false });
    expect(evaluateResolution(input).failureReasons).toEqual(
      evaluateResolution(input).failureReasons,
    );
  });
});

describe('resolutionRates', () => {
  it('reports zero for an empty suite rather than a perfect score', () => {
    expect(resolutionRates([])).toMatchObject({ total: 0, fullResolutionRate: 0 });
  });

  it('separates partial progress from the headline number', () => {
    const outcomes = [
      evaluateResolution(resolvable()),
      evaluateResolution(resolvable({ actionableContactCount: 0 })),
    ];
    const rates = resolutionRates(outcomes);
    expect(rates.serviceRouteResolutionRate).toBe(1);
    expect(rates.fullResolutionRate).toBe(0.5);
  });
});

describe('rankFailureReasons', () => {
  it('puts the reason blocking the most cases first', () => {
    const outcomes = [
      evaluateResolution(resolvable({ candidates: [] })),
      evaluateResolution(resolvable({ candidates: [] })),
      evaluateResolution(resolvable({ actionableContactCount: 0 })),
    ];
    const ranked = rankFailureReasons(outcomes);
    expect(ranked[0]).toMatchObject({ reason: 'policy_missing', count: 2 });
  });

  it('breaks ties towards the earliest stage, which unblocks the most work', () => {
    const outcomes = [
      evaluateResolution(resolvable({ brandResolvedToOrganisation: false })),
      evaluateResolution(resolvable({ actionableContactCount: 0 })),
    ];
    const ranked = rankFailureReasons(outcomes);
    expect(ranked[0]!.reason).toBe('product_unknown');
  });
});
