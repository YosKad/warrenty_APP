import { describe, expect, it } from 'vitest';

import { readProvenance } from './provenance';
import { TARGETS, applyMapping, findDuplicate, guessMapping } from './targets';

describe('readProvenance', () => {
  it('keeps a claim that has a source behind it', () => {
    const result = readProvenance({
      source_url: 'https://example.invalid/warranty.pdf',
      source_title: 'Warranty booklet',
      verification: 'official',
      retrieved_date: '16/08/2026',
    });
    expect(result.verification).toBe('official');
    expect(result.retrievedAt).toBe('2026-08-16');
    expect(result.notes).toEqual([]);
  });

  it('downgrades a claim with nothing behind it', () => {
    // The rule this file exists for: a spreadsheet asserting "official" with no
    // source is a spreadsheet asserting its own authority.
    const result = readProvenance({ verification: 'official' });
    expect(result.verification).toBe('unverified');
    expect(result.notes[0]).toContain('no source');
  });

  it('leaves an unverified claim alone, source or not', () => {
    expect(readProvenance({}).verification).toBe('unverified');
    expect(readProvenance({}).notes).toEqual([]);
  });

  it('reports a verification word it does not recognise', () => {
    const result = readProvenance({
      source_url: 'https://example.invalid/x',
      verification: 'very sure',
    });
    expect(result.verification).toBe('unverified');
    expect(result.notes[0]).toContain('not a value we use');
  });

  it('reports a date it cannot read rather than dropping it', () => {
    const result = readProvenance({ retrieved_date: 'last spring' });
    expect(result.retrievedAt).toBeNull();
    expect(result.notes.some((note) => note.includes('could not be read'))).toBe(true);
  });

  it('deduplicates sources by normalised URL', () => {
    const a = readProvenance({ source_url: 'https://www.example.invalid/a/' });
    const b = readProvenance({ source_url: 'http://example.invalid/a?utm_source=x' });
    expect(a.sourceKey).toBe(b.sourceKey);
  });
});

describe('corpus targets', () => {
  it('offers provenance columns on every target', () => {
    for (const spec of Object.values(TARGETS)) {
      const keys = spec.fields.map((field) => field.key);
      expect(keys, spec.target).toContain('source_url');
      expect(keys, spec.target).toContain('verification');
    }
  });

  it('computes a model’s comparison key with the matcher’s own parser', () => {
    const result = TARGETS.product_models.validate({
      manufacturer: 'Apple',
      canonical_model: 'MacBook Air M4',
    });
    expect(result.errors).toEqual([]);
    expect(result.values.normalized_key).toBe('MACBOOKAIRM4');
  });

  it('strips the manufacturer from the key, so “Samsung S95D” folds to S95D', () => {
    const result = TARGETS.product_models.validate({
      manufacturer: 'Samsung',
      canonical_model: 'Samsung S95D',
    });
    expect(result.values.normalized_key).toBe('S95D');
  });

  it('refuses a model name that identifies nothing', () => {
    const result = TARGETS.product_models.validate({
      manufacturer: 'Apple',
      canonical_model: '---',
    });
    expect(result.errors.some((error) => error.includes('nothing that identifies'))).toBe(true);
  });

  it('refuses an alias that folds to nothing', () => {
    const result = TARGETS.model_aliases.validate({
      manufacturer: 'Apple',
      canonical_model: 'MacBook Air M4',
      value: '  ---  ',
    });
    expect(result.errors.some((error) => error.includes('folds to nothing'))).toBe(true);
  });

  it('reads Hebrew headers for the corpus files too', () => {
    const mapping = guessMapping('product_models', ['יצרן', 'דגם']);
    expect(mapping).toMatchObject({ manufacturer: 'יצרן', canonical_model: 'דגם' });
  });

  it('folds an organisation alias with the resolver’s own name folding', () => {
    const result = TARGETS.organisation_aliases.validate({
      organisation: 'iDigital',
      value: 'iDigital Israel Ltd.',
      kind: 'legal_name',
    });
    expect(result.values.normalized_key).toBe('idigital israel');
  });

  it('reads a source row', () => {
    const mapped = applyMapping(guessMapping('warranty_sources', ['title', 'url', 'kind']), {
      title: 'Warranty booklet',
      url: 'https://example.invalid/w.pdf',
      kind: 'manufacturer',
    });
    const result = TARGETS.warranty_sources.validate(mapped);
    expect(result.errors).toEqual([]);
    expect(result.values.document_title).toBe('Warranty booklet');
  });
});

describe('model duplicates', () => {
  const existing = [
    {
      id: 'existing',
      canonical_model: 'Samsung S95D',
      normalized_key: 'S95D',
      manufacturer_id: 'samsung',
    },
  ];

  it('catches a model that folds to a key the corpus already has', () => {
    const found = findDuplicate(
      'product_models',
      { normalized_key: 'S95D', manufacturer_id: 'samsung' },
      existing,
    );
    expect(found?.existingId).toBe('existing');
    expect(found?.signals[0]?.detail).toContain('already folds to');
  });

  it('lets two manufacturers each have an S95D', () => {
    // One manufacturer cannot sell two; two manufacturers can each sell one.
    const found = findDuplicate(
      'product_models',
      { normalized_key: 'S95D', manufacturer_id: 'someone-else' },
      existing,
    );
    expect(found).toBeNull();
  });
});
