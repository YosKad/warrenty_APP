import { describe, expect, it } from 'vitest';

import {
  importerConflict,
  readReceiptEvidence,
  resolveOrganisation,
  serialApplicability,
  serialMatches,
  type OrganisationRecord,
} from '../identity';

const apple: OrganisationRecord = {
  id: 'apple',
  name: 'Apple',
  roles: ['manufacturer'],
  aliases: [
    {
      value: 'Apple Computer',
      kind: 'trading_name',
      verification: 'verified',
      publicationStatus: 'published',
    },
    {
      value: 'Apple Inc.',
      kind: 'legal_name',
      verification: 'official',
      publicationStatus: 'published',
    },
  ],
};

const idigital: OrganisationRecord = {
  id: 'idigital',
  name: 'iDigital',
  legalName: 'iDigital Israel Ltd.',
  countryCode: 'IL',
  roles: ['importer', 'warranty_provider', 'service_provider'],
  aliases: [
    {
      value: 'איי דיגיטל',
      kind: 'transliteration',
      verification: 'verified',
      publicationStatus: 'published',
    },
  ],
};

const bsh: OrganisationRecord = {
  id: 'bsh',
  name: 'BSH Home Appliances',
  countryCode: 'IL',
  roles: ['importer'],
};

const bosch: OrganisationRecord = {
  id: 'bosch',
  name: 'Bosch',
  roles: ['manufacturer'],
};

const ORGS = [apple, idigital, bsh, bosch];

describe('resolveOrganisation', () => {
  it('matches on the name', () => {
    const result = resolveOrganisation('apple', ORGS);
    expect(result.state).toBe('resolved');
    expect(result.resolved?.via).toBe('name');
  });

  it('matches on the registered name', () => {
    const result = resolveOrganisation('iDigital Israel Ltd', ORGS);
    expect(result.resolved?.organisation.id).toBe('idigital');
    expect(result.resolved?.via).toBe('legal_name');
  });

  it('matches an approved alias, including a Hebrew one', () => {
    const result = resolveOrganisation('איי דיגיטל', ORGS);
    expect(result.resolved?.organisation.id).toBe('idigital');
    expect(result.resolved?.aliasKind).toBe('transliteration');
  });

  it('matches a name the company used to trade under', () => {
    expect(resolveOrganisation('Apple Computer', ORGS).resolved?.organisation.id).toBe('apple');
  });

  it('ignores an alias nobody approved', () => {
    const proposed: OrganisationRecord = {
      id: 'x',
      name: 'Something Else',
      roles: [],
      aliases: [
        {
          value: 'Apple Computer',
          kind: 'trading_name',
          verification: 'ai_extracted',
          publicationStatus: 'candidate',
        },
      ],
    };
    const result = resolveOrganisation('Apple Computer', [proposed, apple]);
    expect(result.resolved?.organisation.id).toBe('apple');
  });

  it('keeps an importer and the brand it imports separate', () => {
    // "BSH" on a receipt is evidence about who imported the appliance. It is
    // not evidence that the appliance is a Bosch, and it must never become so.
    const result = resolveOrganisation('BSH Home Appliances', ORGS);
    expect(result.resolved?.organisation.id).toBe('bsh');
    expect(result.resolved?.organisation.roles).toEqual(['importer']);
  });

  it('narrows by role when the caller knows what it is looking for', () => {
    expect(resolveOrganisation('iDigital', ORGS, { role: 'manufacturer' }).state).toBe(
      'unresolved',
    );
    expect(resolveOrganisation('iDigital', ORGS, { role: 'importer' }).state).toBe('resolved');
  });

  it('refuses to pick between two companies with the same name', () => {
    const twins: OrganisationRecord[] = [
      { id: 'a', name: 'Electra Service', countryCode: 'IL', roles: ['service_provider'] },
      { id: 'b', name: 'Electra Service', countryCode: 'IL', roles: ['service_provider'] },
    ];
    const result = resolveOrganisation('Electra Service', twins);
    expect(result.state).toBe('ambiguous');
    expect(result.resolved).toBeNull();
  });

  it('returns unresolved for a shop we have never recorded', () => {
    expect(resolveOrganisation('Some Corner Shop', ORGS).state).toBe('unresolved');
  });
});

describe('readReceiptEvidence', () => {
  it('resolves each name independently and says what happened to it', () => {
    const signals = readReceiptEvidence(
      { importerName: 'iDigital', retailerName: 'Some Corner Shop' },
      ORGS,
    );
    const importer = signals.find((signal) => signal.field === 'importerName');
    const retailer = signals.find((signal) => signal.field === 'retailerName');

    expect(importer?.organisationId).toBe('idigital');
    expect(retailer?.organisationId).toBeNull();
    // Not an error: most receipts name a shop nobody has recorded.
    expect(retailer?.state).toBe('unresolved');
    expect(retailer?.evidence).toContain('not a company we have recorded');
  });

  it('skips the fields the receipt does not carry', () => {
    expect(readReceiptEvidence({}, ORGS)).toEqual([]);
  });
});

describe('importerConflict', () => {
  it('fires only when both sides name someone and they differ', () => {
    expect(importerConflict('a', 'b')).toBe(true);
    expect(importerConflict('a', 'a')).toBe(false);
    expect(importerConflict(null, 'b')).toBe(false);
    expect(importerConflict('a', null)).toBe(false);
  });
});

describe('serial rules', () => {
  it('matches a prefix', () => {
    expect(serialMatches('RZ8N123456', { kind: 'prefix', value: 'RZ8N' })).toBe(true);
    expect(serialMatches('RZ9N123456', { kind: 'prefix', value: 'RZ8N' })).toBe(false);
  });

  it('compares a range as text, in the manufacturer’s own ordering', () => {
    // Serials are not numbers. Treating them as numbers reorders them.
    const rule = { kind: 'range', from: 'RZ8N000000', to: 'RZ8N999999' } as const;
    expect(serialMatches('RZ8N500000', rule)).toBe(true);
    expect(serialMatches('RZ9N000001', rule)).toBe(false);
  });

  it('matches a pattern', () => {
    expect(serialMatches('RZ8N123456', { kind: 'pattern', value: 'RZ%456' })).toBe(true);
  });

  it('reports unknown rather than out of scope when no rule exists', () => {
    // A policy that says nothing about serials applies regardless of serial.
    // "Out of scope" would be an invented restriction.
    expect(serialApplicability('RZ8N123456', [])).toBe('unknown');
    expect(serialApplicability(null, [{ kind: 'prefix', value: 'RZ8N' }])).toBe('unknown');
  });

  it('reports out of scope only against a stated rule', () => {
    expect(serialApplicability('AB1234', [{ kind: 'prefix', value: 'RZ8N' }])).toBe(
      'out_of_scope',
    );
    expect(serialApplicability('RZ8N1', [{ kind: 'prefix', value: 'RZ8N' }])).toBe('in_scope');
  });
});
