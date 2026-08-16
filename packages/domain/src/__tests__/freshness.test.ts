import { describe, expect, it } from 'vitest';

import { DEFAULT_FRESHNESS, ageInDays, freshnessOf, overdueRatio } from '../freshness';

const NOW = new Date('2026-08-16T00:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

describe('freshnessOf', () => {
  it('separates never-verified from stale', () => {
    // Two different problems: one needs a first look, the other a second one.
    expect(freshnessOf(null, 'provider_contact', { now: NOW })).toBe('unknown');
    expect(freshnessOf(daysAgo(400), 'provider_contact', { now: NOW })).toBe('stale');
  });

  it('uses a different interval per class of fact', () => {
    const age = daysAgo(400);
    // A phone number unchecked for 400 days is probably dead; a warranty policy
    // unchecked for 400 days is almost certainly still accurate.
    expect(freshnessOf(age, 'provider_contact', { now: NOW })).toBe('stale');
    expect(freshnessOf(age, 'warranty_policy', { now: NOW })).toBe('fresh');
  });

  it('reports the middle state so a queue can be built from it', () => {
    expect(freshnessOf(daysAgo(200), 'provider_contact', { now: NOW })).toBe('due');
  });

  it('treats an unparseable timestamp as unknown, not as fresh', () => {
    expect(freshnessOf('not a date', 'provider_contact', { now: NOW })).toBe('unknown');
  });
});

describe('ageInDays', () => {
  it('is null when nothing was ever verified', () => {
    expect(ageInDays(null, NOW)).toBeNull();
    expect(ageInDays(daysAgo(10), NOW)).toBe(10);
  });
});

describe('overdueRatio', () => {
  it('ranks by how overdue a record is for its own class, not by raw age', () => {
    const contact = overdueRatio(daysAgo(210), 'provider_contact', { now: NOW });
    const policy = overdueRatio(daysAgo(400), 'warranty_policy', { now: NOW });
    expect(contact).toBeGreaterThan(policy);
  });

  it('puts never-verified records at the front', () => {
    expect(overdueRatio(null, 'provider_contact', { now: NOW })).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe('default intervals', () => {
  it('always leaves room between recheck and stale', () => {
    for (const policy of Object.values(DEFAULT_FRESHNESS)) {
      expect(policy.staleAfterDays).toBeGreaterThan(policy.recheckAfterDays);
    }
  });
});
