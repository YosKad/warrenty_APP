import { describe, expect, it } from 'vitest';

import {
  SOURCE_PRIORITY,
  actorMayPublish,
  canTransition,
  isLive,
  outranksSource,
  type PublicationStatus,
} from '../sources';

describe('source hierarchy', () => {
  it('ranks a manufacturer above an inferred guess', () => {
    expect(SOURCE_PRIORITY.manufacturer).toBeLessThan(SOURCE_PRIORITY.ai_inferred);
  });

  it('does not let source kind alone beat verification', () => {
    // The case this exists for: an unread manufacturer page against a retailer
    // document a person actually checked.
    const scrapedManufacturer = { source: 'manufacturer', verification: 'unverified' } as const;
    const checkedRetailer = { source: 'retailer', verification: 'verified' } as const;

    expect(outranksSource(scrapedManufacturer, checkedRetailer)).toBe(false);
    expect(outranksSource(checkedRetailer, scrapedManufacturer)).toBe(false);
  });

  it('outranks only when better on one axis and no worse on the other', () => {
    expect(
      outranksSource(
        { source: 'manufacturer', verification: 'official' },
        { source: 'retailer', verification: 'official' },
      ),
    ).toBe(true);
  });
});

describe('publication lifecycle', () => {
  it('never lets a candidate reach published in one step', () => {
    expect(canTransition('candidate', 'published')).toBe(false);
    expect(canTransition('candidate', 'needs_review')).toBe(true);
    expect(canTransition('needs_review', 'verified')).toBe(true);
    expect(canTransition('verified', 'published')).toBe(true);
  });

  it('lets a reviewer verify a candidate without parking it in a queue first', () => {
    expect(canTransition('candidate', 'verified')).toBe(true);
  });

  it('lets a machine propose but never publish', () => {
    expect(actorMayPublish('machine', 'candidate')).toBe(true);
    expect(actorMayPublish('machine', 'needs_review')).toBe(true);
    expect(actorMayPublish('machine', 'verified')).toBe(false);
    expect(actorMayPublish('machine', 'published')).toBe(false);
    expect(actorMayPublish('human', 'published')).toBe(true);
  });

  it('treats every non-published state as invisible to the resolver', () => {
    const states: PublicationStatus[] = [
      'candidate',
      'needs_review',
      'verified',
      'needs_reverification',
      'archived',
      'rejected',
    ];
    for (const publicationStatus of states) {
      expect(isLive({ publicationStatus, dataEnvironment: 'production' })).toBe(false);
    }
    expect(isLive({ publicationStatus: 'published', dataEnvironment: 'production' })).toBe(true);
  });

  it('keeps demo data out of production regardless of status', () => {
    // Item 41: a fixture must never be able to surface as verified production
    // data, even if someone publishes it by hand.
    expect(isLive({ publicationStatus: 'published', dataEnvironment: 'demo' })).toBe(false);
  });
});
