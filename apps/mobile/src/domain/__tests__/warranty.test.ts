import {
  addDays,
  addMonths,
  daysBetween,
  isCalendarDate,
  todayInTimeZone,
} from '../date';
import {
  canStartClaim,
  clampStartToPurchase,
  compareByUrgency,
  confidenceForSource,
  getWarrantySnapshot,
  isEndBeforeStart,
  requiresUserVerification,
  resolveWarrantyPeriod,
  summarise,
} from '../warranty';

/**
 * The warranty status engine is the one piece of logic where being wrong has real
 * consequences for a user — a missed claim window. These tests cover the boundaries
 * that matter: month-end clamping, the last covered day, timezone edges, and the
 * refusal to invent a warranty that was never stated.
 */

describe('calendar dates', () => {
  it('accepts valid dates and rejects malformed or impossible ones', () => {
    expect(isCalendarDate('2026-05-20')).toBe(true);
    expect(isCalendarDate('2024-02-29')).toBe(true); // leap year
    expect(isCalendarDate('2026-02-29')).toBe(false); // not a leap year
    expect(isCalendarDate('2026-13-01')).toBe(false);
    expect(isCalendarDate('2026-5-20')).toBe(false);
    expect(isCalendarDate('20/05/2026')).toBe(false);
    expect(isCalendarDate(20260520)).toBe(false);
  });

  it('clamps to the end of the month when adding months', () => {
    // "One month after 31 January" is what every consumer reads as end of February.
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
  });

  it('rolls years correctly in both directions', () => {
    expect(addMonths('2026-05-20', 24)).toBe('2028-05-20');
    expect(addMonths('2026-05-20', -6)).toBe('2025-11-20');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
  });

  it('counts whole days across a DST boundary without drifting', () => {
    // Late March in Europe crosses a clock change; the day count must not shift.
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-05-20', '2026-05-20')).toBe(0);
    expect(daysBetween('2026-05-20', '2026-05-19')).toBe(-1);
  });

  it('resolves "today" in the user\'s timezone, not UTC', () => {
    // 22:30 UTC on 19 May is already 20 May in Tokyo and still 19 May in Los Angeles.
    const instant = new Date('2026-05-19T22:30:00Z');
    expect(todayInTimeZone('Asia/Tokyo', instant)).toBe('2026-05-20');
    expect(todayInTimeZone('America/Los_Angeles', instant)).toBe('2026-05-19');
    expect(todayInTimeZone('UTC', instant)).toBe('2026-05-19');
  });

  it('falls back to UTC rather than throwing on an unknown timezone', () => {
    const instant = new Date('2026-05-19T10:00:00Z');
    expect(todayInTimeZone('Not/AZone', instant)).toBe('2026-05-19');
  });
});

describe('resolveWarrantyPeriod', () => {
  it('prefers an explicit end date over a computed one', () => {
    const period = resolveWarrantyPeriod({
      purchaseDate: '2026-05-20',
      warrantyEnd: '2027-01-01',
      durationMonths: 24,
    });
    expect(period.end).toBe('2027-01-01');
    expect(period.derived).toBe(false);
  });

  it('derives the end date from purchase + duration', () => {
    const period = resolveWarrantyPeriod({
      purchaseDate: '2026-05-20',
      durationMonths: 24,
    });
    expect(period.end).toBe('2028-05-20');
    expect(period.derived).toBe(true);
  });

  it('adds a purchased extension on top of the base period', () => {
    const period = resolveWarrantyPeriod({
      purchaseDate: '2026-05-20',
      durationMonths: 24,
      extensionMonths: 12,
    });
    expect(period.end).toBe('2029-05-20');
  });

  it('uses warranty start over purchase date when cover begins on delivery', () => {
    const period = resolveWarrantyPeriod({
      purchaseDate: '2026-05-20',
      warrantyStart: '2026-06-10',
      durationMonths: 12,
    });
    expect(period.start).toBe('2026-06-10');
    expect(period.end).toBe('2027-06-10');
  });

  it('returns no end date rather than inventing one', () => {
    // This is the single most important behaviour in the module: an unknown warranty
    // stays unknown. Guessing a plausible duration would mislead someone into
    // thinking they are covered when they are not.
    expect(resolveWarrantyPeriod({ purchaseDate: '2026-05-20' }).end).toBeNull();
    expect(resolveWarrantyPeriod({ purchaseDate: null, durationMonths: 24 }).end).toBeNull();
    expect(
      resolveWarrantyPeriod({ purchaseDate: '2026-05-20', durationMonths: 0 }).end,
    ).toBeNull();
  });
});

describe('getWarrantySnapshot', () => {
  const base = { purchaseDate: '2026-01-01', durationMonths: 24 };

  it('reports active well before expiry', () => {
    const snapshot = getWarrantySnapshot(base, '2026-06-01');
    expect(snapshot.status).toBe('active');
    expect(snapshot.end).toBe('2028-01-01');
    expect(snapshot.daysRemaining).toBe(daysBetween('2026-06-01', '2028-01-01'));
  });

  it('treats the final day of cover as still covered', () => {
    const snapshot = getWarrantySnapshot(base, '2028-01-01');
    expect(snapshot.daysRemaining).toBe(0);
    expect(snapshot.status).toBe('ending_soon');
    expect(snapshot.status).not.toBe('expired');
  });

  it('expires the day after the end date', () => {
    const snapshot = getWarrantySnapshot(base, '2028-01-02');
    expect(snapshot.status).toBe('expired');
    expect(snapshot.daysRemaining).toBe(-1);
  });

  it('switches to ending_soon exactly at the window boundary', () => {
    const endingSoonStart = addDays('2028-01-01', -30);
    expect(getWarrantySnapshot(base, endingSoonStart).status).toBe('ending_soon');
    expect(getWarrantySnapshot(base, addDays(endingSoonStart, -1)).status).toBe('active');
  });

  it('honours a custom ending-soon window', () => {
    expect(getWarrantySnapshot(base, '2027-11-15', 90).status).toBe('ending_soon');
    expect(getWarrantySnapshot(base, '2027-11-15', 7).status).toBe('active');
  });

  it('reports unknown when there is no end date', () => {
    const snapshot = getWarrantySnapshot({ purchaseDate: '2026-01-01' }, '2026-06-01');
    expect(snapshot.status).toBe('unknown');
    expect(snapshot.daysRemaining).toBeNull();
    expect(snapshot.progress).toBeNull();
  });

  it('reports progress through the warranty period', () => {
    const snapshot = getWarrantySnapshot(base, '2027-01-01');
    expect(snapshot.progress).toBeGreaterThan(0.45);
    expect(snapshot.progress).toBeLessThan(0.55);
  });

  it('clamps progress to the 0–1 range outside the period', () => {
    expect(getWarrantySnapshot(base, '2025-06-01').progress).toBe(0);
    expect(getWarrantySnapshot(base, '2030-01-01').progress).toBe(1);
  });
});

describe('claim eligibility', () => {
  it('allows a claim while cover is live', () => {
    expect(canStartClaim('active', 'active')).toBe(true);
    expect(canStartClaim('ending_soon', 'active')).toBe(true);
  });

  it('blocks a claim once cover has ended or the item has left the user', () => {
    expect(canStartClaim('expired', 'active')).toBe(false);
    expect(canStartClaim('unknown', 'active')).toBe(false);
    expect(canStartClaim('active', 'sold')).toBe(false);
    expect(canStartClaim('active', 'disposed')).toBe(false);
  });
});

describe('confidence and verification', () => {
  it('never rates an AI inference as high confidence', () => {
    expect(confidenceForSource('ai_inferred', '2026-05-01T00:00:00Z')).toBe('low');
  });

  it('treats the user as authoritative about their own purchase', () => {
    expect(confidenceForSource('user_entered', null)).toBe('high');
    expect(requiresUserVerification('user_entered', 'high')).toBe(false);
  });

  it('requires verification for anything short of confirmed manufacturer data', () => {
    expect(confidenceForSource('manufacturer', null)).toBe('medium');
    expect(confidenceForSource('manufacturer', '2026-05-01T00:00:00Z')).toBe('high');
    expect(requiresUserVerification('manufacturer', 'medium')).toBe(true);
    expect(requiresUserVerification('document_extraction', 'medium')).toBe(true);
  });
});

describe('sorting and summarising', () => {
  const today = '2026-06-01';
  const snap = (input: Parameters<typeof getWarrantySnapshot>[0]) =>
    getWarrantySnapshot(input, today);

  it('puts the soonest expiry first and unknowns before expired', () => {
    const endingSoon = snap({ purchaseDate: '2024-06-20', durationMonths: 24 });
    const active = snap({ purchaseDate: '2026-01-01', durationMonths: 36 });
    const unknown = snap({ purchaseDate: '2026-01-01' });
    const expired = snap({ purchaseDate: '2020-01-01', durationMonths: 12 });

    const sorted = [expired, unknown, active, endingSoon].sort(compareByUrgency);
    expect(sorted.map((s) => s.status)).toEqual([
      'ending_soon',
      'active',
      'unknown',
      'expired',
    ]);
  });

  it('counts each status for the Home dashboard', () => {
    const counts = summarise([
      snap({ purchaseDate: '2026-01-01', durationMonths: 36 }),
      snap({ purchaseDate: '2024-06-20', durationMonths: 24 }),
      snap({ purchaseDate: '2020-01-01', durationMonths: 12 }),
      snap({ purchaseDate: '2026-01-01' }),
    ]);
    expect(counts).toEqual({
      active: 1,
      endingSoon: 1,
      expired: 1,
      unknown: 1,
      total: 4,
    });
  });
});

describe('data integrity guards', () => {
  it('never lets warranty start precede the purchase date', () => {
    // Guards against an OCR misread putting the start in the wrong year.
    expect(clampStartToPurchase('2025-01-01', '2026-05-20')).toBe('2026-05-20');
    expect(clampStartToPurchase('2026-06-01', '2026-05-20')).toBe('2026-06-01');
    expect(clampStartToPurchase(null, '2026-05-20')).toBe('2026-05-20');
    expect(clampStartToPurchase('2026-06-01', null)).toBe('2026-06-01');
  });

  it('detects an end date before the start', () => {
    expect(
      isEndBeforeStart({ start: '2026-05-20', end: '2026-01-01', derived: false }),
    ).toBe(true);
    expect(
      isEndBeforeStart({ start: '2026-05-20', end: '2027-05-20', derived: false }),
    ).toBe(false);
  });
});
