import {
  CONFLICT_SCORE_MARGIN,
  MATCH_STALE_AFTER_DAYS,
  MATCH_SIGNALS,
  MATCH_TOTAL_WEIGHT,
  SOURCE_PRIORITY,
  applyOverride,
  clauseHeadline,
  detectConflicts,
  groupClauses,
  hasIdentifiedWarranty,
  intelligenceCompleteness,
  isMatchStale,
  matchState,
  outranksSource,
  rankCandidates,
  scoreMatch,
  type PolicyCandidate,
  type WarrantyClause,
  type WarrantyIntelligence,
} from '../warrantyIntelligence';

/**
 * These tests exist because every one of them describes a way the product could
 * lie to a user: a policy from the wrong country presented as theirs, a scraped
 * page silently overruling an importer's document, a duration disagreement
 * resolved by coin toss, or a user's own correction displayed back to them as
 * "verified".
 */

const candidate = (over: Partial<PolicyCandidate> = {}): PolicyCandidate => ({
  warrantyId: 'w1',
  durationMonths: 24,
  providerId: 'org-samline',
  providerName: 'Samline',
  policyVersion: null,
  source: 'manufacturer',
  verification: 'unverified',
  confidence: 'medium',
  validFrom: null,
  validTo: null,
  signals: {},
  ...over,
});

describe('match scoring', () => {
  it('weights total exactly 100', () => {
    expect(MATCH_TOTAL_WEIGHT).toBe(100);
    expect(MATCH_SIGNALS.every((s) => s.weight > 0)).toBe(true);
  });

  it('scores nothing when no signal fires', () => {
    expect(scoreMatch({})).toBe(0);
  });

  it('scores a full match at 100', () => {
    const all = Object.fromEntries(MATCH_SIGNALS.map((s) => [s.key, true]));
    expect(scoreMatch(all)).toBe(100);
  });

  it('weights the model above any other single signal', () => {
    const model = MATCH_SIGNALS.find((s) => s.key === 'model')?.weight ?? 0;
    for (const signal of MATCH_SIGNALS) {
      if (signal.key === 'model') continue;
      expect(model).toBeGreaterThan(signal.weight);
    }
  });

  it('scores the importer-specific TV match as strong', () => {
    // Model + brand + country + importer + category + validity, no serial and an
    // unverified source: the shape of the Samline demo policy.
    const score = scoreMatch({
      model: true,
      brand: true,
      country: true,
      importer: true,
      category: true,
      validity: true,
    });
    expect(score).toBe(82);
    expect(matchState(score, 'unverified')).toBe('strong');
  });

  it('promotes the same match to verified once the record is verified', () => {
    const score = scoreMatch({
      model: true,
      brand: true,
      country: true,
      importer: true,
      category: true,
      validity: true,
    });
    expect(matchState(score, 'official')).toBe('verified');
    expect(matchState(score, 'verified')).toBe('verified');
  });

  it('never calls a weak match verified, however official the source', () => {
    const score = scoreMatch({ brand: true, category: true });
    expect(matchState(score, 'official')).not.toBe('verified');
  });

  it('asks for confirmation on a brand-and-category-only match', () => {
    const score = scoreMatch({ brand: true, category: true, validity: true });
    expect(matchState(score, 'unverified')).toBe('needs_confirmation');
  });

  it('returns unknown when almost nothing matched', () => {
    expect(matchState(scoreMatch({ category: true }), 'unverified')).toBe('unknown');
  });
});

describe('source hierarchy', () => {
  it('ranks official documentation above everything derived', () => {
    expect(SOURCE_PRIORITY.manufacturer).toBeLessThan(SOURCE_PRIORITY.internal_db);
    expect(SOURCE_PRIORITY.internal_db).toBeLessThan(SOURCE_PRIORITY.retailer);
    expect(SOURCE_PRIORITY.retailer).toBeLessThan(SOURCE_PRIORITY.document_extraction);
    expect(SOURCE_PRIORITY.document_extraction).toBeLessThan(SOURCE_PRIORITY.user_entered);
    expect(SOURCE_PRIORITY.user_entered).toBeLessThan(SOURCE_PRIORITY.ai_inferred);
  });

  it('lets a better source kind outrank a worse one at equal verification', () => {
    expect(
      outranksSource(
        { source: 'manufacturer', verification: 'unverified' },
        { source: 'ai_inferred', verification: 'unverified' },
      ),
    ).toBe(true);
  });

  it('does not let an unverified manufacturer page beat a verified retailer document', () => {
    // Both axes must be at least as good. Kind alone is not enough, or a scraped
    // manufacturer page would outrank a document a person actually checked.
    expect(
      outranksSource(
        { source: 'manufacturer', verification: 'unverified' },
        { source: 'retailer', verification: 'verified' },
      ),
    ).toBe(false);
  });

  it('is not reflexive — an identical source does not outrank itself', () => {
    const same = { source: 'manufacturer' as const, verification: 'official' as const };
    expect(outranksSource(same, same)).toBe(false);
  });

  it('never lets AI-inferred data outrank anything', () => {
    for (const source of Object.keys(SOURCE_PRIORITY)) {
      if (source === 'ai_inferred') continue;
      expect(
        outranksSource(
          { source: 'ai_inferred', verification: 'official' },
          { source: source as keyof typeof SOURCE_PRIORITY, verification: 'official' },
        ),
      ).toBe(false);
    }
  });
});

describe('candidate ranking', () => {
  it('puts the better-matched policy first regardless of insertion order', () => {
    const generic = candidate({ warrantyId: 'generic', signals: { brand: true, category: true } });
    const specific = candidate({
      warrantyId: 'specific',
      signals: { model: true, brand: true, country: true, importer: true },
    });
    expect(rankCandidates([generic, specific])[0]?.warrantyId).toBe('specific');
  });

  it('breaks a score tie on source trust', () => {
    const signals = { brand: true, category: true };
    const scraped = candidate({ warrantyId: 'scraped', source: 'ai_inferred', signals });
    const official = candidate({ warrantyId: 'official', source: 'manufacturer', signals });
    expect(rankCandidates([scraped, official])[0]?.warrantyId).toBe('official');
  });

  it('does not mutate its input', () => {
    const list = [
      candidate({ warrantyId: 'a', signals: {} }),
      candidate({ warrantyId: 'b', signals: { model: true } }),
    ];
    rankCandidates(list);
    expect(list[0]?.warrantyId).toBe('a');
  });
});

describe('conflict detection', () => {
  it('reports a duration disagreement between comparable candidates', () => {
    const conflicts = detectConflicts([
      candidate({
        warrantyId: 'importer',
        durationMonths: 24,
        signals: { model: true, brand: true, country: true, importer: true, category: true, validity: true },
      }),
      candidate({
        warrantyId: 'retailer',
        durationMonths: 36,
        source: 'retailer',
        signals: { model: true, brand: true, country: true, category: true, validity: true },
      }),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.field).toBe('duration_months');
    expect(conflicts[0]?.chosen).toBe('24');
    expect(conflicts[0]?.alternative).toBe('36');
  });

  it('does not call specificity a conflict', () => {
    // The generic policy matches far less well. Preferring the specific one is
    // the algorithm working, not an arbitrary choice the user must arbitrate.
    const conflicts = detectConflicts([
      candidate({
        warrantyId: 'specific',
        durationMonths: 24,
        signals: { model: true, brand: true, country: true, importer: true, category: true, validity: true },
      }),
      candidate({
        warrantyId: 'generic',
        durationMonths: 12,
        signals: { brand: true, category: true, validity: true },
      }),
    ]);
    expect(conflicts).toEqual([]);
  });

  it('ignores a comparable candidate from a strictly worse source', () => {
    const conflicts = detectConflicts([
      candidate({
        warrantyId: 'doc',
        durationMonths: 24,
        source: 'manufacturer',
        verification: 'official',
        signals: { model: true, brand: true, country: true },
      }),
      candidate({
        warrantyId: 'guess',
        durationMonths: 12,
        source: 'ai_inferred',
        verification: 'ai_extracted',
        signals: { model: true, brand: true, country: true },
      }),
    ]);
    expect(conflicts).toEqual([]);
  });

  it('reports a provider disagreement', () => {
    const conflicts = detectConflicts([
      candidate({ warrantyId: 'a', providerId: 'org-1', providerName: 'Samline', signals: { model: true } }),
      candidate({ warrantyId: 'b', providerId: 'org-2', providerName: 'Samsung', signals: { model: true } }),
    ]);
    expect(conflicts.map((c) => c.field)).toContain('warranty_provider');
  });

  it('reports each field at most once however many candidates disagree', () => {
    const conflicts = detectConflicts([
      candidate({ warrantyId: 'a', durationMonths: 24, signals: { model: true } }),
      candidate({ warrantyId: 'b', durationMonths: 12, signals: { model: true } }),
      candidate({ warrantyId: 'c', durationMonths: 36, signals: { model: true } }),
    ]);
    expect(conflicts.filter((c) => c.field === 'duration_months')).toHaveLength(1);
  });

  it('says nothing when a duration is unknown on either side', () => {
    const conflicts = detectConflicts([
      candidate({ warrantyId: 'a', durationMonths: null, signals: { model: true } }),
      candidate({ warrantyId: 'b', durationMonths: 24, signals: { model: true } }),
    ]);
    expect(conflicts.filter((c) => c.field === 'duration_months')).toEqual([]);
  });

  it('returns nothing for a single candidate or none at all', () => {
    expect(detectConflicts([])).toEqual([]);
    expect(detectConflicts([candidate()])).toEqual([]);
  });

  it('uses the stated margin as the comparability boundary', () => {
    expect(CONFLICT_SCORE_MARGIN).toBeGreaterThan(0);
    const leader = candidate({
      warrantyId: 'leader',
      durationMonths: 24,
      signals: { model: true, brand: true },
    });
    // 36 - 22 = 14 apart: inside the margin, so it is a conflict.
    const near = candidate({
      warrantyId: 'near',
      durationMonths: 12,
      signals: { model: true, country: true },
    });
    expect(detectConflicts([leader, near])).toHaveLength(1);
  });
});

describe('clause grouping', () => {
  const clause = (over: Partial<WarrantyClause>): WarrantyClause => ({
    id: 'c1',
    clauseType: 'coverage',
    title: null,
    summary: null,
    sourceText: 'Some warranty text that is long enough to be a clause.',
    section: null,
    sourceSection: null,
    sourcePage: null,
    coverageCategories: [],
    confidence: 'medium',
    verification: 'unverified',
    ...over,
  });

  it('splits coverage from exclusions', () => {
    const groups = groupClauses([
      clause({ id: 'a', clauseType: 'coverage' }),
      clause({ id: 'b', clauseType: 'exclusion' }),
    ]);
    expect(groups.covered.map((c) => c.id)).toEqual(['a']);
    expect(groups.notCovered.map((c) => c.id)).toEqual(['b']);
  });

  it('keeps durations, fees and conditions together as special conditions', () => {
    // A 10-year motor term buried among exclusions is a term nobody reads.
    const groups = groupClauses([
      clause({ id: 'motor', clauseType: 'duration' }),
      clause({ id: 'visit', clauseType: 'service_fee' }),
      clause({ id: 'battery', clauseType: 'condition' }),
    ]);
    expect(groups.specialConditions.map((c) => c.id)).toEqual(['motor', 'visit', 'battery']);
  });

  it('separates claim requirements and territory', () => {
    const groups = groupClauses([
      clause({ id: 'receipt', clauseType: 'claim_requirement' }),
      clause({ id: 'howto', clauseType: 'procedure' }),
      clause({ id: 'il', clauseType: 'geographic_restriction' }),
    ]);
    expect(groups.claimRequirements.map((c) => c.id)).toEqual(['receipt', 'howto']);
    expect(groups.geographic.map((c) => c.id)).toEqual(['il']);
  });

  it('drops nothing into a group it does not belong in', () => {
    const groups = groupClauses([clause({ id: 'misc', clauseType: 'other' })]);
    const total =
      groups.covered.length +
      groups.notCovered.length +
      groups.specialConditions.length +
      groups.claimRequirements.length +
      groups.geographic.length;
    expect(total).toBe(0);
  });

  it('prefers the extracted title, then the summary, then the section', () => {
    expect(clauseHeadline(clause({ title: 'Display panel', summary: 'x', section: 'y' }))).toBe(
      'Display panel',
    );
    expect(clauseHeadline(clause({ summary: 'Panel faults are covered.' }))).toBe(
      'Panel faults are covered.',
    );
    expect(clauseHeadline(clause({ section: 'Section 4' }))).toBe('Section 4');
  });

  it('falls back to the source text rather than inventing a label', () => {
    const headline = clauseHeadline(clause({ sourceText: 'Verbatim clause wording here.' }));
    expect(headline).toBe('Verbatim clause wording here.');
  });
});

describe('user overrides', () => {
  const matched = {
    value: 'org-samsung',
    source: 'manufacturer' as const,
    verification: 'official' as const,
    isOverride: false,
  };

  it('leaves the matched value alone when there is no override', () => {
    expect(applyOverride(matched, undefined)).toEqual(matched);
  });

  it('never lets a correction inherit the provenance it replaced', () => {
    const result = applyOverride(matched, {
      field: 'importer',
      value: 'org-samline',
      previousValue: 'org-samsung',
      createdAt: '2026-08-14T00:00:00Z',
    });
    expect(result?.value).toBe('org-samline');
    expect(result?.source).toBe('user_entered');
    expect(result?.verification).toBe('unverified');
    expect(result?.isOverride).toBe(true);
  });

  it('applies to a field we had nothing for', () => {
    const result = applyOverride(null, {
      field: 'service_provider',
      value: 'org-xyz',
      previousValue: null,
      createdAt: '2026-08-14T00:00:00Z',
    });
    expect(result?.value).toBe('org-xyz');
    expect(result?.isOverride).toBe(true);
  });
});

describe('completeness and identification', () => {
  const emptyGroups = {
    covered: [],
    notCovered: [],
    specialConditions: [],
    claimRequirements: [],
    geographic: [],
  };

  it('is zero when nothing is known', () => {
    expect(
      intelligenceCompleteness({
        policy: null,
        providerChain: [],
        clauses: emptyGroups,
        source: null,
      }),
    ).toBe(0);
  });

  it('rises as the picture fills in', () => {
    const partial = intelligenceCompleteness({
      policy: {
        warrantyId: 'w',
        durationMonths: 24,
        policyVersion: null,
        coverageSummary: null,
        exclusionsSummary: null,
        specialConditionsSummary: null,
        validFrom: null,
        validTo: null,
      },
      providerChain: [
        { role: 'warranty_provider', organisationId: 'o', name: 'Samline', isUserProvided: false },
      ],
      clauses: emptyGroups,
      source: null,
    });
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(1);
  });

  it('treats an unknown match as not identified even when a policy exists', () => {
    const intel = {
      policy: { warrantyId: 'w' },
      matchState: 'unknown',
    } as unknown as WarrantyIntelligence;
    expect(hasIdentifiedWarranty(intel)).toBe(false);
  });

  it('treats a needs-confirmation match as identified — it just needs checking', () => {
    const intel = {
      policy: { warrantyId: 'w' },
      matchState: 'needs_confirmation',
    } as unknown as WarrantyIntelligence;
    expect(hasIdentifiedWarranty(intel)).toBe(true);
  });
});

/**
 * Freshness. A match is only as good as when it was worked out: a policy the
 * manufacturer reissued last month against a match resolved last year is exactly
 * the case where the app should say "last checked" rather than state a duration
 * as though it were current.
 */
describe('match staleness', () => {
  const now = new Date('2026-08-14T12:00:00Z');
  const daysAgo = (days: number) =>
    new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

  it('treats a never-resolved match as stale', () => {
    expect(isMatchStale(null, now)).toBe(true);
  });

  it('treats a match resolved today as fresh', () => {
    expect(isMatchStale(daysAgo(0), now)).toBe(false);
  });

  it('treats a match just inside the window as fresh', () => {
    expect(isMatchStale(daysAgo(MATCH_STALE_AFTER_DAYS - 1), now)).toBe(false);
  });

  it('treats a match past the window as stale', () => {
    expect(isMatchStale(daysAgo(MATCH_STALE_AFTER_DAYS + 1), now)).toBe(true);
  });

  it('states the window rather than leaving it a magic number', () => {
    expect(MATCH_STALE_AFTER_DAYS).toBeGreaterThan(0);
  });
});
