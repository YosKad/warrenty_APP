import { describe, expect, it } from 'vitest';

import {
  normaliseCountry,
  normaliseModel,
  normaliseName,
  normalisePhone,
  normaliseUrl,
  parseDurationMonths,
  parseSheetDate,
  slugify,
} from '../normalise';

describe('normaliseName', () => {
  it('folds case, punctuation and legal form', () => {
    expect(normaliseName('Samsung Electronics Israel Ltd.')).toBe('samsung electronics israel');
    expect(normaliseName('SAMSUNG  ELECTRONICS,  ISRAEL')).toBe('samsung electronics israel');
  });

  it('folds the three ways an Israeli company writes בע"מ', () => {
    const forms = ['סמסונג אלקטרוניקה בע"מ', 'סמסונג אלקטרוניקה בע״מ', 'סמסונג אלקטרוניקה בעמ'];
    const keys = forms.map(normaliseName);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('סמסונג אלקטרוניקה');
  });

  it('keeps word identity, so similar companies stay distinct', () => {
    expect(normaliseName('Samline')).not.toBe(normaliseName('Sameline'));
  });

  it('returns an empty key for nothing rather than throwing', () => {
    expect(normaliseName(null)).toBe('');
    expect(normaliseName('   ')).toBe('');
  });
});

describe('normaliseModel', () => {
  it('collapses the separators a manufacturer uses inconsistently', () => {
    expect(normaliseModel('QN-65-S95D')).toBe('QN65S95D');
    expect(normaliseModel('qn65s95d')).toBe('QN65S95D');
  });

  it('keeps digits, which are never noise in a model number', () => {
    expect(normaliseModel('S95D')).not.toBe(normaliseModel('S95C'));
  });
});

describe('normalisePhone', () => {
  it('reduces the Israeli spellings of one number to one key', () => {
    const forms = ['03-6100000', '+972 3 6100000', '972-3-610-0000', '(03) 610 0000'];
    const keys = forms.map((form) => normalisePhone(form));
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('+97236100000');
  });

  it('preserves a star short code verbatim', () => {
    // *3345 is how a large share of Israeli service lines are actually reached.
    // Stripping the star would turn it into a number that dials nothing.
    expect(normalisePhone('*3345')).toBe('*3345');
  });

  it('returns nothing for nothing', () => {
    expect(normalisePhone(null)).toBe('');
    expect(normalisePhone('n/a')).toBe('');
  });
});

describe('normaliseUrl', () => {
  it('ignores scheme, www, trailing slash and tracking parameters', () => {
    const forms = [
      'https://www.samsung.com/il/support/warranty/',
      'http://samsung.com/il/support/warranty',
      'https://samsung.com/il/support/warranty?utm_source=x#top',
    ];
    const keys = forms.map(normaliseUrl);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('samsung.com/il/support/warranty');
  });

  it('keeps different paths on one host apart', () => {
    expect(normaliseUrl('https://samsung.com/il/tv')).not.toBe(
      normaliseUrl('https://samsung.com/il/appliance'),
    );
  });
});

describe('slugify', () => {
  it('produces a URL-safe slug', () => {
    expect(slugify('Samsung Electronics Israel Ltd.')).toBe('samsung-electronics-israel');
  });

  it('falls back to the folded name rather than an empty slug for Hebrew', () => {
    expect(slugify('סמסונג אלקטרוניקה בע"מ')).toBe('סמסונג-אלקטרוניקה');
  });
});

describe('parseSheetDate', () => {
  it('reads ISO', () => {
    expect(parseSheetDate('2025-04-03')).toBe('2025-04-03');
  });

  it('reads an ambiguous slashed date day-first, as an Israeli operator means it', () => {
    expect(parseSheetDate('03/04/2025')).toBe('2025-04-03');
  });

  it('refuses to invent a date it cannot read', () => {
    expect(parseSheetDate('sometime in April')).toBeNull();
    expect(parseSheetDate('2025-02-30')).toBeNull();
    expect(parseSheetDate('')).toBeNull();
  });
});

describe('parseDurationMonths', () => {
  it('reads months and years', () => {
    expect(parseDurationMonths('24')).toBe(24);
    expect(parseDurationMonths('24 months')).toBe(24);
    expect(parseDurationMonths('2 years')).toBe(24);
    expect(parseDurationMonths('2 שנים')).toBe(24);
  });

  it('returns null rather than a default twelve', () => {
    // Item 59 in the brief, expressed as a unit test: unknown is a valid answer
    // and the one thing this function must never do is guess.
    expect(parseDurationMonths('warranty per manufacturer')).toBeNull();
    expect(parseDurationMonths('')).toBeNull();
    expect(parseDurationMonths(null)).toBeNull();
    expect(parseDurationMonths('0')).toBeNull();
  });
});

describe('normaliseCountry', () => {
  it('accepts a two-letter code and nothing else', () => {
    expect(normaliseCountry('il')).toBe('IL');
    expect(normaliseCountry('Israel')).toBeNull();
    expect(normaliseCountry(null)).toBeNull();
  });
});
