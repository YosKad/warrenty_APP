import { describe, expect, it } from 'vitest';

import {
  isTrustedAlias,
  resolveModel,
  type CanonicalModel,
  type ModelAlias,
} from '../modelMatch';

const alias = (value: string, over: Partial<ModelAlias> = {}): ModelAlias => ({
  value,
  verification: 'verified',
  publicationStatus: 'published',
  sourceId: 'src-1',
  ...over,
});

const model = (over: Partial<CanonicalModel> & { canonicalModel: string }): CanonicalModel => ({
  id: over.canonicalModel,
  manufacturerName: null,
  family: null,
  variant: null,
  regionalModel: null,
  categoryId: null,
  aliases: [],
  ...over,
});

const MACBOOK_AIR_M4 = model({
  id: 'apple-mba-m4',
  canonicalModel: 'MacBook Air M4',
  manufacturerName: 'Apple',
  family: 'MacBook Air',
  variant: '13-inch',
  aliases: [alias('MBA M4'), alias('MacBook Air 13-inch M4')],
});

const MACBOOK_PRO_M4 = model({
  id: 'apple-mbp-m4',
  canonicalModel: 'MacBook Pro M4',
  manufacturerName: 'Apple',
  family: 'MacBook Pro',
});

const S95D = model({
  id: 'samsung-s95d',
  canonicalModel: 'Samsung S95D',
  manufacturerName: 'Samsung',
  family: 'S95',
  regionalModel: 'QE65S95DATXXH',
  aliases: [alias('QE65S95D'), alias('QE55S95D'), alias('S95D OLED')],
});

const S95C = model({
  id: 'samsung-s95c',
  canonicalModel: 'Samsung S95C',
  manufacturerName: 'Samsung',
  family: 'S95',
  regionalModel: 'QE65S95CATXXH',
});

const CATALOGUE = [MACBOOK_AIR_M4, MACBOOK_PRO_M4, S95D, S95C];

describe('the regression this phase exists for', () => {
  it('resolves “MacBook Air M4” to the MacBook Air M4', () => {
    // Pinned. Before Phase I.5 this fell through `M4%` and produced nothing.
    const result = resolveModel('MacBook Air M4', CATALOGUE);
    expect(result.state).toBe('resolved');
    expect(result.resolved?.model?.id).toBe('apple-mba-m4');
    expect(result.resolved?.stage).toBe('canonical');
  });

  it('resolves every form of it a person or a receipt might produce', () => {
    for (const form of [
      'MacBook Air 13-inch M4',
      'MacBook Air 13 M4',
      'M4 MacBook Air',
      'MacBook Air (M4)',
      'MBA M4',
      'Apple MacBook Air M4',
    ]) {
      const result = resolveModel(form, CATALOGUE);
      expect(result.state, `${form} should resolve`).toBe('resolved');
      expect(result.resolved?.model?.id, form).toBe('apple-mba-m4');
    }
  });

  it('does not reach the MacBook Pro on the way', () => {
    const result = resolveModel('MacBook Air M4', CATALOGUE);
    const reached = result.candidates.map((candidate) => candidate.model?.id);
    expect(reached).not.toContain('apple-mbp-m4');
  });
});

describe('stages', () => {
  it('uses the canonical name when it is the canonical name', () => {
    expect(resolveModel('Samsung S95D', CATALOGUE).resolved?.stage).toBe('canonical');
  });

  it('uses a verified alias when the input is one', () => {
    const result = resolveModel('MBA M4', CATALOGUE);
    expect(result.resolved?.stage).toBe('alias');
    expect(result.resolved?.evidence[0]).toContain('alias');
  });

  it('will not use an alias nobody approved', () => {
    // An abbreviation a model proposed during ingestion is a suggestion. Acting
    // on it would let an extraction decide whose warranty this is.
    const proposed = model({
      id: 'apple-mba-m4',
      canonicalModel: 'MacBook Air M4',
      manufacturerName: 'Apple',
      aliases: [alias('MBA M4', { publicationStatus: 'candidate', verification: 'ai_extracted' })],
    });
    const result = resolveModel('MBA M4', [proposed, MACBOOK_PRO_M4]);
    expect(result.state).not.toBe('resolved');
  });

  it('repairs an OCR misreading when only one model is reachable', () => {
    const result = resolveModel('QE65595D', CATALOGUE);
    expect(result.state).toBe('resolved');
    expect(result.resolved?.stage).toBe('normalised');
    expect(result.resolved?.model?.id).toBe('samsung-s95d');
    expect(result.ocr?.corrected).not.toBeNull();
  });

  it('falls to family when the exact member is unknown', () => {
    const result = resolveModel('Samsung S95Z', CATALOGUE);
    expect(result.candidates.every((candidate) => candidate.stage !== 'canonical')).toBe(true);
    expect(result.candidates.some((candidate) => candidate.stage === 'family')).toBe(true);
    // Two S95 models, so the family stage cannot settle it either.
    expect(result.state).toBe('ambiguous');
  });

  it('trusts a specific policy pattern', () => {
    const result = resolveModel('QE65S95DATXXH', [], {
      patterns: [{ warrantyId: 'w1', pattern: 'S95D%' }],
    });
    expect(result.state).toBe('resolved');
    expect(result.resolved?.stage).toBe('pattern');
    expect(result.resolved?.warrantyId).toBe('w1');
  });

  it('refuses to resolve on a pattern too broad to mean anything', () => {
    // `%M4%` matches every M4 Mac ever made. Matching on it is how a Mac mini
    // gets a MacBook Air's terms.
    const result = resolveModel('M4 MacBook Air', [], {
      patterns: [{ warrantyId: 'w1', pattern: '%M4%' }],
    });
    expect(result.state).not.toBe('resolved');
    expect(result.candidates[0]!.trust).toBe('probable');
    expect(result.candidates[0]!.evidence.join(' ')).toContain('too broad');
  });

  it('offers a fuzzy hit as a suggestion and never as an answer', () => {
    const v11 = model({ id: 'dyson-v11', canonicalModel: 'Dyson V11 Detect Fluffy' });
    const result = resolveModel('Dyson V15 Detect Fluffy', [v11]);
    const fuzzy = result.candidates.find((candidate) => candidate.stage === 'fuzzy');
    expect(fuzzy?.trust).toBe('weak');
    expect(result.state).toBe('unresolved');
  });
});

describe('ambiguity', () => {
  it('does not choose between two equally good candidates', () => {
    const twins = [
      model({ id: 'a', canonicalModel: 'Samsung S95D', family: 'S95' }),
      model({ id: 'b', canonicalModel: 'Samsung S95D', family: 'S95', variant: '2025' }),
    ];
    const result = resolveModel('Samsung S95D', twins);
    expect(result.state).toBe('ambiguous');
    expect(result.resolved).toBeNull();
    expect(result.candidates.length).toBeGreaterThan(1);
  });

  it('asks for something that would actually settle it', () => {
    const twins = [
      model({ id: 'a', canonicalModel: 'Samsung S95D', regionalModel: 'QE65S95DATXXH' }),
      model({ id: 'b', canonicalModel: 'Samsung S95D', regionalModel: 'QN65S95DAFXZA' }),
    ];
    const result = resolveModel('Samsung S95D', twins);
    expect(result.state).toBe('ambiguous');
    expect(result.distinguishers).toContain('region');
    expect(result.distinguishers).toContain('serial_number');
  });

  it('reports an ambiguous OCR reading rather than picking one', () => {
    const twins = [
      model({ id: 'd', canonicalModel: 'S95D' }),
      model({ id: 'zero', canonicalModel: 'S950' }),
    ];
    const result = resolveModel('S95O', twins);
    expect(result.state).not.toBe('resolved');
    expect(result.ocr?.ambiguous).toBe(true);
  });
});

describe('explanation', () => {
  it('says what it read, what it matched, and at which stage', () => {
    const result = resolveModel('QE65S95DATXXH', CATALOGUE);
    expect(result.explanation[0]).toContain('Read');
    expect(result.explanation.join(' ')).toMatch(/Stage [A-F]/);
    expect(result.input.screenSize).toBe(65);
    expect(result.input.region).toBe('ATXXH');
  });

  it('never returns a bare score', () => {
    const result = resolveModel('MacBook Air M4', CATALOGUE);
    for (const candidate of result.candidates) {
      expect(candidate.evidence.length).toBeGreaterThan(0);
    }
  });
});

describe('isTrustedAlias', () => {
  it('requires both a review state and a verification state', () => {
    expect(isTrustedAlias(alias('X'))).toBe(true);
    expect(isTrustedAlias(alias('X', { publicationStatus: 'candidate' }))).toBe(false);
    expect(isTrustedAlias(alias('X', { verification: 'ai_extracted' }))).toBe(false);
    expect(isTrustedAlias(alias('X', { verification: 'unverified' }))).toBe(false);
  });
});
