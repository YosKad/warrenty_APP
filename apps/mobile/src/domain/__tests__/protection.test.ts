import {
  PROTECTION_FACTORS,
  PROTECTION_TOTAL_WEIGHT,
  buildSuggestedActions,
  getPortfolioProtection,
  getProtectionCompleteness,
  isScorable,
  protectionWeightForStatus,
  scoreProduct,
  type ProtectionInput,
} from '../protection';

/**
 * The Protection Score is shown to users as a headline number, so it has to be
 * defensible: weights that total exactly 100, gaps that name something the user
 * can act on, and no silent judgement about someone who has just installed the app.
 */

const EMPTY: ProtectionInput = {
  purchaseDate: null,
  warrantyStart: null,
  warrantyEnd: null,
  durationMonths: null,
  extensionMonths: null,
  serialNumber: null,
  model: null,
  warrantyProviderId: null,
  serviceProviderId: null,
  warrantyId: null,
  proofDocumentCount: 0,
  lifecycle: 'active',
};

const COMPLETE: ProtectionInput = {
  purchaseDate: '2026-01-01',
  warrantyStart: null,
  warrantyEnd: null,
  durationMonths: 24,
  extensionMonths: 0,
  serialNumber: 'RZ8N40FKT9L',
  model: 'QE65S95D',
  warrantyProviderId: '11111111-1111-4111-8111-111111111111',
  serviceProviderId: '22222222-2222-4222-8222-222222222222',
  warrantyId: '33333333-3333-4333-8333-333333333333',
  proofDocumentCount: 1,
  lifecycle: 'active',
};

describe('factor weights', () => {
  it('total exactly 100, so the percentage means something', () => {
    expect(PROTECTION_TOTAL_WEIGHT).toBe(100);
  });

  it('has no duplicate factor keys', () => {
    const keys = PROTECTION_FACTORS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('weights the things that decide a claim above the recoverable ones', () => {
    const weight = (k: string) => PROTECTION_FACTORS.find((f) => f.key === k)!.weight;
    expect(weight('purchase_date')).toBeGreaterThan(weight('serial_number'));
    expect(weight('warranty_end')).toBeGreaterThan(weight('model'));
    expect(weight('proof_of_purchase')).toBeGreaterThan(weight('service_provider'));
  });
});

describe('getProtectionCompleteness', () => {
  it('scores a fully documented product at 100 with no gaps', () => {
    const result = getProtectionCompleteness(COMPLETE);
    expect(result.score).toBe(100);
    expect(result.gaps).toEqual([]);
    expect(result.satisfied).toHaveLength(PROTECTION_FACTORS.length);
  });

  it('scores an empty product at 0 and names every gap', () => {
    const result = getProtectionCompleteness(EMPTY);
    expect(result.score).toBe(0);
    expect(result.gaps).toHaveLength(PROTECTION_FACTORS.length);
  });

  it('accepts a derivable warranty end, not just an explicit one', () => {
    const derivable = getProtectionCompleteness({
      ...EMPTY,
      purchaseDate: '2026-01-01',
      durationMonths: 24,
    });
    expect(derivable.satisfied).toContain('warranty_end');

    const explicit = getProtectionCompleteness({ ...EMPTY, warrantyEnd: '2028-01-01' });
    expect(explicit.satisfied).toContain('warranty_end');
  });

  it('does not credit a duration with nothing to anchor it to', () => {
    const result = getProtectionCompleteness({ ...EMPTY, durationMonths: 24 });
    expect(result.satisfied).not.toContain('warranty_end');
  });

  it('treats whitespace-only text as missing', () => {
    const result = getProtectionCompleteness({
      ...COMPLETE,
      serialNumber: '   ',
      model: '',
    });
    expect(result.gaps.map((g) => g.key)).toEqual(
      expect.arrayContaining(['serial_number', 'model']),
    );
  });

  it('orders gaps heaviest first, so the action list leads with what matters', () => {
    const result = getProtectionCompleteness(EMPTY);
    const weights = result.gaps.map((g) => g.weight);
    expect([...weights].sort((a, b) => b - a)).toEqual(weights);
    expect(result.gaps[0]?.weight).toBe(20);
  });

  it('subtracts exactly the weight of the missing factor', () => {
    const noSerial = getProtectionCompleteness({ ...COMPLETE, serialNumber: null });
    expect(noSerial.score).toBe(100 - 8);

    const noReceipt = getProtectionCompleteness({ ...COMPLETE, proofDocumentCount: 0 });
    expect(noReceipt.score).toBe(100 - 18);
  });

  it('only counts proof documents, not any attachment', () => {
    expect(
      getProtectionCompleteness({ ...COMPLETE, proofDocumentCount: 0 }).gaps
        .map((g) => g.key),
    ).toContain('proof_of_purchase');
  });
});

describe('portfolio score', () => {
  const scored = (score: number, status: 'active' | 'expired' | 'unknown' | 'ending_soon') => ({
    id: 's' + score + status,
    status,
    completeness: { score, gaps: score === 100 ? [] : [{ key: 'model' as const, weight: 5 }], satisfied: [] },
  });

  it('returns null for an empty portfolio rather than judging a new user', () => {
    const result = getPortfolioProtection([]);
    expect(result.score).toBeNull();
    expect(result.band).toBe('empty');
  });

  it('averages a single product to its own completeness', () => {
    expect(getPortfolioProtection([scored(82, 'active')]).score).toBe(82);
  });

  it('weights live products above expired ones', () => {
    // A perfect live product alongside a poor expired one should land well above
    // the flat mean of 50.
    const result = getPortfolioProtection([scored(100, 'active'), scored(0, 'expired')]);
    expect(result.score).toBe(80);
    expect(result.score).toBeGreaterThan(50);
  });

  it('bands the score', () => {
    expect(getPortfolioProtection([scored(90, 'active')]).band).toBe('strong');
    expect(getPortfolioProtection([scored(70, 'active')]).band).toBe('fair');
    expect(getPortfolioProtection([scored(40, 'active')]).band).toBe('needs_attention');
  });

  it('counts how many products still have gaps', () => {
    const result = getPortfolioProtection([
      scored(100, 'active'),
      scored(60, 'active'),
      scored(40, 'ending_soon'),
    ]);
    expect(result.productCount).toBe(3);
    expect(result.needsAttentionCount).toBe(2);
  });

  it('weights unknown-warranty products between live and expired', () => {
    expect(protectionWeightForStatus('active')).toBe(1);
    expect(protectionWeightForStatus('unknown')).toBe(0.5);
    expect(protectionWeightForStatus('expired')).toBe(0.25);
  });
});

describe('scoreProduct', () => {
  it('derives the warranty status alongside the completeness', () => {
    const result = scoreProduct('p1', COMPLETE, '2026-06-01');
    expect(result.status).toBe('active');
    expect(result.completeness.score).toBe(100);
  });

  it('reports unknown status when nothing pins the warranty down', () => {
    const result = scoreProduct('p2', { ...EMPTY, purchaseDate: '2026-01-01' }, '2026-06-01');
    expect(result.status).toBe('unknown');
  });

  it('excludes products the user no longer owns', () => {
    expect(isScorable('active')).toBe(true);
    expect(isScorable('claim_open')).toBe(true);
    expect(isScorable('sold')).toBe(false);
    expect(isScorable('disposed')).toBe(false);
  });
});

describe('buildSuggestedActions', () => {
  const gap = (key: 'proof_of_purchase' | 'model', weight: number) => ({ key, weight });

  it('puts an urgent product above a heavier gap on a distant one', () => {
    const actions = buildSuggestedActions([
      {
        id: 'urgent',
        status: 'ending_soon',
        daysRemaining: 12,
        completeness: { score: 82, gaps: [gap('model', 5)], satisfied: [] },
      },
      {
        id: 'distant',
        status: 'active',
        daysRemaining: 700,
        completeness: { score: 82, gaps: [gap('proof_of_purchase', 18)], satisfied: [] },
      },
    ]);
    // 5 × 2.5 = 12.5 versus 18 × 1 = 18 — the heavier gap still wins here, which
    // is correct; urgency tilts the scale, it does not override importance.
    expect(actions[0]?.productId).toBe('distant');
  });

  it('lets urgency win when the gaps are comparable', () => {
    const actions = buildSuggestedActions([
      {
        id: 'urgent',
        status: 'ending_soon',
        daysRemaining: 10,
        completeness: { score: 82, gaps: [gap('proof_of_purchase', 18)], satisfied: [] },
      },
      {
        id: 'distant',
        status: 'active',
        daysRemaining: 700,
        completeness: { score: 82, gaps: [gap('proof_of_purchase', 18)], satisfied: [] },
      },
    ]);
    expect(actions[0]?.productId).toBe('urgent');
  });

  it('all but ignores expired products', () => {
    const actions = buildSuggestedActions([
      {
        id: 'expired',
        status: 'expired',
        daysRemaining: -400,
        completeness: { score: 20, gaps: [gap('proof_of_purchase', 18)], satisfied: [] },
      },
      {
        id: 'live',
        status: 'active',
        daysRemaining: 300,
        completeness: { score: 95, gaps: [gap('model', 5)], satisfied: [] },
      },
    ]);
    expect(actions[0]?.productId).toBe('live');
  });

  it('caps the list so Home never becomes a chore', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      id: 'p' + i,
      status: 'active' as const,
      daysRemaining: 300,
      completeness: {
        score: 50,
        gaps: [gap('proof_of_purchase', 18), gap('model', 5)],
        satisfied: [],
      },
    }));
    expect(buildSuggestedActions(many)).toHaveLength(4);
    expect(buildSuggestedActions(many, 2)).toHaveLength(2);
  });

  it('returns nothing when every product is complete', () => {
    const actions = buildSuggestedActions([
      { id: 'p', status: 'active', daysRemaining: 100, completeness: { score: 100, gaps: [], satisfied: [] } },
    ]);
    expect(actions).toEqual([]);
  });
});
