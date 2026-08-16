import { describe, expect, it } from 'vitest';

import { TARGETS, applyMapping, findDuplicate, guessMapping } from './targets';

describe('guessMapping', () => {
  it('recognises the obvious headers', () => {
    const mapping = guessMapping('organisations', ['Name', 'Country', 'Website']);
    expect(mapping).toMatchObject({ name: 'Name', country_code: 'Country', website: 'Website' });
  });

  it('recognises Hebrew headers', () => {
    const mapping = guessMapping('service_locations', ['חברה', 'עיר', 'כתובת', 'טלפון']);
    expect(mapping).toMatchObject({
      organisation: 'חברה',
      city: 'עיר',
      address_line: 'כתובת',
      phone: 'טלפון',
    });
  });

  it('leaves a header it does not recognise unmapped rather than guessing', () => {
    const mapping = guessMapping('organisations', ['Name', 'Sector']);
    expect(mapping.name).toBe('Name');
    expect(Object.values(mapping)).not.toContain('Sector');
  });

  it('never maps one column to two fields', () => {
    const mapping = guessMapping('organisations', ['name']);
    const used = Object.values(mapping);
    expect(new Set(used).size).toBe(used.length);
  });
});

describe('applyMapping', () => {
  it('reads through the mapping, not the header names', () => {
    const mapped = applyMapping(
      { name: 'Company', country_code: 'Country' },
      { Company: 'Samline', Country: 'IL', Ignored: 'x' },
    );
    expect(mapped).toEqual({ name: 'Samline', country_code: 'IL' });
  });

  it('gives an empty string for a mapped column the row does not have', () => {
    expect(applyMapping({ name: 'Company' }, {})).toEqual({ name: '' });
  });
});

describe('organisations validator', () => {
  const validate = TARGETS.organisations.validate;

  it('requires a name', () => {
    expect(validate({ name: '' }).errors).toContain('Name is required');
  });

  it('builds a slug from the name', () => {
    expect(validate({ name: 'Samsung Electronics Israel Ltd.' }).values.slug).toBe(
      'samsung-electronics-israel',
    );
  });

  it('reads a comma-separated role list', () => {
    const result = validate({ name: 'Samline', roles: 'importer, warranty_provider' });
    expect(result.values.roles).toEqual(['importer', 'warranty_provider']);
    expect(result.errors).toEqual([]);
  });

  it('refuses a role it does not know instead of dropping it silently', () => {
    const result = validate({ name: 'Samline', roles: 'distributor' });
    expect(result.errors[0]).toContain('distributor');
  });

  it('writes null, not an empty string, for a column the sheet does not have', () => {
    const result = validate({ name: 'Samline' });
    expect(result.values.country_code).toBeNull();
    expect(result.values.website).toBeNull();
  });
});

describe('service_locations validator', () => {
  const validate = TARGETS.service_locations.validate;

  it('needs a city or an address', () => {
    const result = validate({ organisation: 'Samline' });
    expect(result.errors).toContain('A branch needs at least a city or an address');
  });

  it('refuses one coordinate without the other', () => {
    // Half a coordinate points at the wrong place with total confidence.
    const result = validate({ organisation: 'Samline', city: 'Tel Aviv', latitude: '32.07' });
    expect(result.errors).toContain('Latitude and longitude must be given together');
  });

  it('refuses coordinates outside the possible range', () => {
    const result = validate({
      organisation: 'Samline',
      city: 'Tel Aviv',
      latitude: '132.07',
      longitude: '34.78',
    });
    expect(result.errors.some((error) => error.includes('outside the possible range'))).toBe(true);
  });

  it('accepts a complete branch', () => {
    const result = validate({
      organisation: 'Samline',
      name: 'Samline Tel Aviv',
      city: 'תל אביב',
      address_line: 'הרצל 12',
      latitude: '32.0668',
      longitude: '34.7778',
      appointment_required: 'yes',
    });
    expect(result.errors).toEqual([]);
    expect(result.values.appointment_required).toBe(true);
    expect(result.values.latitude).toBe(32.0668);
  });
});

describe('capabilities validator', () => {
  const validate = TARGETS.service_capabilities.validate;

  it('reads a blank availability as “not confirmed”, never as “no”', () => {
    const result = validate({ organisation: 'Samline', kind: 'home_technician' });
    expect(result.values.availability).toBe('unknown');
  });

  it('reads anything it does not understand as “not confirmed” too', () => {
    const result = validate({
      organisation: 'Samline',
      kind: 'home_technician',
      availability: 'sometimes?',
    });
    expect(result.values.availability).toBe('unknown');
  });

  it('accepts the words operators actually type', () => {
    expect(
      validate({ organisation: 'S', kind: 'walk_in_service', availability: 'Yes' }).values
        .availability,
    ).toBe('available');
    expect(
      validate({ organisation: 'S', kind: 'walk_in_service', availability: 'no' }).values
        .availability,
    ).toBe('unavailable');
  });

  it('names the capability it rejected', () => {
    const result = validate({ organisation: 'S', kind: 'teleportation' });
    expect(result.errors[0]).toContain('teleportation');
  });
});

describe('relationships validator', () => {
  const validate = TARGETS.organisation_relationships.validate;

  it('reads a slashed date day-first, as an Israeli operator means it', () => {
    const result = validate({
      subject: 'Samline',
      kind: 'imports_for',
      object: 'Samsung',
      effective_from: '03/04/2024',
    });
    expect(result.values.effective_from).toBe('2024-04-03');
  });

  it('reports a date it cannot read rather than importing without one', () => {
    const result = validate({
      subject: 'Samline',
      kind: 'imports_for',
      object: 'Samsung',
      effective_from: 'early 2024',
    });
    expect(result.errors.some((error) => error.includes('could not be read'))).toBe(true);
  });

  it('refuses a relationship that ends before it starts', () => {
    const result = validate({
      subject: 'Samline',
      kind: 'imports_for',
      object: 'Samsung',
      effective_from: '2024-01-01',
      effective_to: '2023-01-01',
    });
    expect(result.errors).toContain('The relationship ends before it starts');
  });

  it('refuses a company acting for itself', () => {
    const result = validate({
      subject: 'Samsung Israel Ltd',
      kind: 'imports_for',
      object: 'Samsung Israel',
    });
    expect(result.errors).toContain('A company cannot hold a relationship with itself');
  });

  it('treats a blank end date as still in force, not as an error', () => {
    const result = validate({
      subject: 'Samline',
      kind: 'imports_for',
      object: 'Samsung',
      effective_from: '2024-01-01',
    });
    expect(result.errors).toEqual([]);
    expect(result.values.effective_to).toBeNull();
  });
});

describe('findDuplicate', () => {
  const existing = [
    { id: 'org-1', name: 'Samline', country_code: 'IL', support_phone: '03-5555000' },
    { id: 'org-2', name: 'New Pan', country_code: 'IL' },
  ];

  it('finds the company that is already there', () => {
    const found = findDuplicate(
      'organisations',
      { name: 'Samline', country_code: 'IL' },
      existing,
    );
    expect(found?.existingId).toBe('org-1');
    expect(found?.signals.length).toBeGreaterThan(0);
  });

  it('leaves a genuinely new company alone', () => {
    const found = findDuplicate(
      'organisations',
      { name: 'Electra Consumer Products', country_code: 'IL' },
      existing,
    );
    expect(found).toBeNull();
  });

  it('does not look for duplicates where there is no sensible key', () => {
    // Two phone numbers on one provider are not a duplicate; they are two lines.
    expect(findDuplicate('provider_contacts', { value: '03-5555000' }, existing)).toBeNull();
  });
});
