import { describe, expect, it } from 'vitest';

import {
  findDuplicates,
  scoreLocationDuplicate,
  scoreOrganisationDuplicate,
  tokenSimilarity,
  verdictFor,
} from '../duplicates';

describe('scoreOrganisationDuplicate', () => {
  it('calls a registration-number match decisive', () => {
    const result = scoreOrganisationDuplicate(
      { name: 'Samsung Electronics Israel', registrationNumber: '51-234567-8' },
      { name: 'סמסונג אלקטרוניקה בע"מ', registrationNumber: '512345678' },
    );
    expect(result.score).toBe(100);
    expect(verdictFor(result.score)).toBe('likely');
  });

  it('lets two different registration numbers overrule an identical name', () => {
    // Franchise networks really do register separate companies under one brand.
    const result = scoreOrganisationDuplicate(
      { name: 'Electra Service', registrationNumber: '511111111' },
      { name: 'Electra Service', registrationNumber: '522222222' },
    );
    expect(result.score).toBe(0);
    expect(verdictFor(result.score)).toBe('distinct');
  });

  it('accumulates soft signals rather than deciding on any one', () => {
    const nameOnly = scoreOrganisationDuplicate(
      { name: 'Samsung Israel', countryCode: 'IL' },
      { name: 'Samsung Israel', countryCode: 'IL' },
    );
    expect(nameOnly.score).toBeGreaterThanOrEqual(60);

    const nameAndPhone = scoreOrganisationDuplicate(
      { name: 'Samsung Israel', countryCode: 'IL', phone: '*3345' },
      { name: 'Samsung Israel', countryCode: 'IL', phone: '*3345' },
    );
    expect(nameAndPhone.score).toBeGreaterThan(nameOnly.score);
  });

  it('does not call two importers duplicates on country alone', () => {
    const result = scoreOrganisationDuplicate(
      { name: 'Samline', countryCode: 'IL' },
      { name: 'New Pan', countryCode: 'IL' },
    );
    expect(verdictFor(result.score)).toBe('distinct');
  });

  it('explains itself, because a reviewer decides and needs the reason', () => {
    const result = scoreOrganisationDuplicate(
      { name: 'Dyson Israel', website: 'https://www.dyson.co.il/support' },
      { name: 'Dyson Israel', website: 'https://dyson.co.il/support/' },
    );
    expect(result.signals.map((s) => s.key)).toContain('website');
    for (const signal of result.signals) expect(signal.detail).not.toBe('');
  });
});

describe('scoreLocationDuplicate', () => {
  it('treats near-identical coordinates as strong evidence', () => {
    const result = scoreLocationDuplicate(
      { addressLine: 'הרצל 12', city: 'Tel Aviv', latitude: 32.0668, longitude: 34.7778 },
      { addressLine: 'Herzl 12', city: 'תל אביב', latitude: 32.0669, longitude: 34.7779 },
    );
    expect(verdictFor(result.score)).not.toBe('distinct');
  });

  it('keeps two branches of the same network apart', () => {
    const result = scoreLocationDuplicate(
      { addressLine: 'הרצל 12', city: 'Tel Aviv', latitude: 32.0668, longitude: 34.7778 },
      { addressLine: 'דרך חברון 5', city: 'Jerusalem', latitude: 31.7683, longitude: 35.2137 },
    );
    expect(verdictFor(result.score)).toBe('distinct');
  });

  it('still works when neither record has coordinates', () => {
    const result = scoreLocationDuplicate(
      { addressLine: 'Herzl 12', city: 'Tel Aviv', phone: '03-6100000' },
      { addressLine: 'Herzl 12', city: 'Tel Aviv', phone: '+972 3 610 0000' },
    );
    expect(verdictFor(result.score)).toBe('likely');
  });
});

describe('tokenSimilarity', () => {
  it('ignores word order', () => {
    expect(tokenSimilarity('samsung electronics israel', 'samsung israel electronics')).toBe(1);
  });

  it('is zero against nothing', () => {
    expect(tokenSimilarity('', 'samsung')).toBe(0);
  });
});

describe('findDuplicates', () => {
  it('returns only real candidates, best first, and never merges', () => {
    const existing = [
      { name: 'Samsung Israel', countryCode: 'IL' },
      { name: 'Samsung Electronics Israel', countryCode: 'IL' },
      { name: 'Electra Consumer Products', countryCode: 'IL' },
    ];

    const matches = findDuplicates(
      { name: 'Samsung Israel', countryCode: 'IL' },
      existing,
      scoreOrganisationDuplicate,
    );

    expect(matches).toHaveLength(2);
    expect(matches[0]!.candidate.name).toBe('Samsung Israel');
    expect(matches[0]!.score).toBeGreaterThanOrEqual(matches[1]!.score);
    // The incoming record is untouched; resolving the duplicate is a separate,
    // human act.
    expect(existing).toHaveLength(3);
  });
});
