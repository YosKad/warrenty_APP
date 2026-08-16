import {
  normaliseCountry,
  normaliseName,
  parseSheetDate,
  scoreLocationDuplicate,
  scoreOrganisationDuplicate,
  slugify,
  type DuplicateSignal,
} from '@mw/domain';

import { CAPABILITY_KINDS, CONTACT_KINDS, CONTACT_PURPOSES, RELATIONSHIP_KINDS } from '@/lib/fields';

/**
 * What each import target expects, and what it refuses.
 *
 * Two rules run through every validator here. A field the sheet does not
 * mention becomes null, never a default — an import that quietly writes twelve
 * months because the duration column was blank produces exactly the confident
 * wrong answer this product exists to avoid. And a row that cannot be read is
 * recorded with its reason and skipped, never coerced into something plausible.
 */

export type ImportTarget =
  | 'organisations'
  | 'provider_contacts'
  | 'service_locations'
  | 'service_capabilities'
  | 'organisation_relationships';

export type FieldSpec = {
  key: string;
  label: string;
  required?: boolean;
  /** Header names that map to this field without the operator saying so. */
  aliases: string[];
  hint?: string;
};

export type ValidationResult = {
  values: Record<string, unknown>;
  errors: string[];
};

export type TargetSpec = {
  target: ImportTarget;
  label: string;
  table: string;
  fields: FieldSpec[];
  /** Turns one mapped row into column values, or into a list of reasons why not. */
  validate: (row: Record<string, string>) => ValidationResult;
  /** How this target recognises an existing record as the same thing. */
  duplicateKey: 'organisation' | 'location' | 'none';
};

const enumField = (
  values: readonly string[],
  label: string,
  raw: string,
  errors: string[],
): string | null => {
  if (!raw) return null;
  const candidate = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if ((values as readonly string[]).includes(candidate)) return candidate;
  errors.push(`${label} “${raw}” is not one of: ${values.join(', ')}`);
  return null;
};

const numberField = (label: string, raw: string, errors: string[]): number | null => {
  if (!raw) return null;
  const value = Number(raw.replace(/[, ]/g, ''));
  if (!Number.isFinite(value)) {
    errors.push(`${label} “${raw}” is not a number`);
    return null;
  }
  return value;
};

const booleanField = (raw: string): boolean | null => {
  if (!raw) return null;
  return ['yes', 'true', '1', 'y', 'כן'].includes(raw.trim().toLowerCase());
};

export const TARGETS: Record<ImportTarget, TargetSpec> = {
  organisations: {
    target: 'organisations',
    label: 'Organisations',
    table: 'organisations',
    duplicateKey: 'organisation',
    fields: [
      { key: 'name', label: 'Name', required: true, aliases: ['name', 'company', 'שם', 'חברה'] },
      { key: 'legal_name', label: 'Registered name', aliases: ['legal name', 'legal_name', 'שם חברה'] },
      {
        key: 'roles',
        label: 'Roles',
        aliases: ['roles', 'role', 'type'],
        hint: 'Comma-separated: importer, service_provider, …',
      },
      { key: 'country_code', label: 'Country', aliases: ['country', 'country code', 'מדינה'] },
      { key: 'website', label: 'Website', aliases: ['website', 'url', 'site', 'אתר'] },
      { key: 'support_phone', label: 'Phone', aliases: ['phone', 'telephone', 'טלפון'] },
      { key: 'support_email', label: 'Email', aliases: ['email', 'mail', 'אימייל'] },
    ],
    validate(row) {
      const errors: string[] = [];
      const name = row.name?.trim() ?? '';
      if (!name) errors.push('Name is required');

      const roles = (row.roles ?? '')
        .split(/[,;/]/)
        .map((role) => role.trim().toLowerCase().replace(/[\s-]+/g, '_'))
        .filter(Boolean);

      const known = [
        'manufacturer',
        'importer',
        'retailer',
        'warranty_provider',
        'service_provider',
      ];
      for (const role of roles) {
        if (!known.includes(role)) errors.push(`Role “${role}” is not recognised`);
      }

      return {
        values: {
          name,
          slug: slugify(name),
          legal_name: row.legal_name?.trim() || null,
          roles,
          country_code: normaliseCountry(row.country_code),
          website: row.website?.trim() || null,
          support_phone: row.support_phone?.trim() || null,
          support_email: row.support_email?.trim() || null,
        },
        errors,
      };
    },
  },

  provider_contacts: {
    target: 'provider_contacts',
    label: 'Contact methods',
    table: 'provider_contact_methods',
    duplicateKey: 'none',
    fields: [
      {
        key: 'organisation',
        label: 'Organisation',
        required: true,
        aliases: ['organisation', 'organization', 'company', 'provider', 'חברה'],
        hint: 'Matched by name against existing organisations. Never created here.',
      },
      {
        key: 'kind',
        label: 'Kind',
        required: true,
        aliases: ['kind', 'channel', 'type'],
      },
      { key: 'purpose', label: 'Purpose', aliases: ['purpose', 'for', 'use'] },
      { key: 'value', label: 'Value', required: true, aliases: ['value', 'number', 'phone', 'email', 'url'] },
      { key: 'label', label: 'Label', aliases: ['label', 'name', 'description'] },
      { key: 'country_code', label: 'Country', aliases: ['country'] },
      { key: 'hours_note', label: 'Hours', aliases: ['hours', 'opening hours', 'שעות'] },
      { key: 'source_url', label: 'Source', aliases: ['source', 'source url', 'reference'] },
    ],
    validate(row) {
      const errors: string[] = [];
      if (!row.organisation?.trim()) errors.push('Organisation is required');
      if (!row.value?.trim()) errors.push('Value is required');

      const kind = enumField(CONTACT_KINDS, 'Kind', row.kind ?? '', errors);
      if (!kind) errors.push('Kind is required');

      return {
        values: {
          kind,
          purpose: enumField(CONTACT_PURPOSES, 'Purpose', row.purpose ?? '', errors),
          value: row.value?.trim() || null,
          label: row.label?.trim() || null,
          country_code: normaliseCountry(row.country_code),
          hours_note: row.hours_note?.trim() || null,
          source_url: row.source_url?.trim() || null,
        },
        errors,
      };
    },
  },

  service_locations: {
    target: 'service_locations',
    label: 'Service locations',
    table: 'service_locations',
    duplicateKey: 'location',
    fields: [
      {
        key: 'organisation',
        label: 'Organisation',
        required: true,
        aliases: ['organisation', 'organization', 'company', 'provider', 'חברה', 'ספק'],
      },
      { key: 'name', label: 'Branch name', aliases: ['branch', 'name', 'סניף'] },
      { key: 'country_code', label: 'Country', aliases: ['country'] },
      { key: 'region', label: 'Region', aliases: ['region', 'district', 'אזור'] },
      { key: 'city', label: 'City', aliases: ['city', 'town', 'עיר'] },
      { key: 'address_line', label: 'Address', aliases: ['address', 'street', 'כתובת'] },
      { key: 'postal_code', label: 'Postal code', aliases: ['postal code', 'zip', 'מיקוד'] },
      { key: 'phone', label: 'Phone', aliases: ['phone', 'telephone', 'טלפון'] },
      { key: 'latitude', label: 'Latitude', aliases: ['latitude', 'lat'] },
      { key: 'longitude', label: 'Longitude', aliases: ['longitude', 'lng', 'lon'] },
      { key: 'time_zone', label: 'Time zone', aliases: ['timezone', 'time zone'] },
      {
        key: 'appointment_required',
        label: 'Appointment required',
        aliases: ['appointment', 'appointment required'],
      },
      { key: 'source_url', label: 'Source', aliases: ['source', 'source url'] },
    ],
    validate(row) {
      const errors: string[] = [];
      if (!row.organisation?.trim()) errors.push('Organisation is required');
      if (!row.city?.trim() && !row.address_line?.trim()) {
        errors.push('A branch needs at least a city or an address');
      }

      const latitude = numberField('Latitude', row.latitude ?? '', errors);
      const longitude = numberField('Longitude', row.longitude ?? '', errors);
      if (latitude !== null && (latitude < -90 || latitude > 90)) {
        errors.push(`Latitude ${latitude} is outside the possible range`);
      }
      if (longitude !== null && (longitude < -180 || longitude > 180)) {
        errors.push(`Longitude ${longitude} is outside the possible range`);
      }
      // One coordinate alone points at the wrong place with total confidence.
      if ((latitude === null) !== (longitude === null)) {
        errors.push('Latitude and longitude must be given together');
      }

      return {
        values: {
          name: row.name?.trim() || null,
          country_code: normaliseCountry(row.country_code),
          region: row.region?.trim() || null,
          city: row.city?.trim() || null,
          address_line: row.address_line?.trim() || null,
          postal_code: row.postal_code?.trim() || null,
          phone: row.phone?.trim() || null,
          latitude,
          longitude,
          time_zone: row.time_zone?.trim() || null,
          appointment_required: booleanField(row.appointment_required ?? ''),
          source_url: row.source_url?.trim() || null,
        },
        errors,
      };
    },
  },

  service_capabilities: {
    target: 'service_capabilities',
    label: 'Capabilities',
    table: 'service_capabilities',
    duplicateKey: 'none',
    fields: [
      {
        key: 'organisation',
        label: 'Organisation',
        required: true,
        aliases: ['organisation', 'organization', 'company', 'provider', 'חברה', 'ספק'],
      },
      { key: 'kind', label: 'Capability', required: true, aliases: ['capability', 'kind', 'service'] },
      {
        key: 'availability',
        label: 'Availability',
        aliases: ['availability', 'available'],
        hint: 'Blank becomes “not confirmed”, which is usually the truth.',
      },
      { key: 'country_code', label: 'Country', aliases: ['country'] },
      { key: 'region', label: 'Region', aliases: ['region'] },
      {
        key: 'typical_lead_time_days',
        label: 'Lead time (days)',
        aliases: ['lead time', 'days', 'turnaround'],
      },
      { key: 'fee_note', label: 'Fee', aliases: ['fee', 'price', 'cost'] },
    ],
    validate(row) {
      const errors: string[] = [];
      if (!row.organisation?.trim()) errors.push('Organisation is required');

      const kind = enumField(CAPABILITY_KINDS, 'Capability', row.kind ?? '', errors);
      if (!kind) errors.push('Capability is required');

      const availabilityRaw = (row.availability ?? '').trim().toLowerCase();
      const availability =
        availabilityRaw === ''
          ? 'unknown'
          : ['yes', 'true', 'available', '1'].includes(availabilityRaw)
            ? 'available'
            : ['no', 'false', 'unavailable', '0'].includes(availabilityRaw)
              ? 'unavailable'
              : 'unknown';

      return {
        values: {
          kind,
          availability,
          country_code: normaliseCountry(row.country_code),
          region: row.region?.trim() || null,
          typical_lead_time_days: numberField(
            'Lead time',
            row.typical_lead_time_days ?? '',
            errors,
          ),
          fee_note: row.fee_note?.trim() || null,
        },
        errors,
      };
    },
  },

  organisation_relationships: {
    target: 'organisation_relationships',
    label: 'Relationships',
    table: 'organisation_relationships',
    duplicateKey: 'none',
    fields: [
      { key: 'subject', label: 'This company', required: true, aliases: ['subject', 'company', 'importer'] },
      { key: 'kind', label: 'Acts as', required: true, aliases: ['kind', 'relationship', 'role'] },
      { key: 'object', label: 'For', required: true, aliases: ['object', 'brand', 'manufacturer'] },
      { key: 'country_code', label: 'Country', aliases: ['country'] },
      { key: 'model_pattern', label: 'Model pattern', aliases: ['model', 'models', 'model pattern'] },
      { key: 'purchase_channel', label: 'Channel', aliases: ['channel', 'purchase channel'] },
      { key: 'effective_from', label: 'From', aliases: ['from', 'start', 'since', 'effective from'] },
      { key: 'effective_to', label: 'To', aliases: ['to', 'end', 'until', 'effective to'] },
    ],
    validate(row) {
      const errors: string[] = [];
      if (!row.subject?.trim()) errors.push('This company is required');
      if (!row.object?.trim()) errors.push('For (the brand) is required');
      if (normaliseName(row.subject ?? '') === normaliseName(row.object ?? '')) {
        errors.push('A company cannot hold a relationship with itself');
      }

      const kind = enumField(RELATIONSHIP_KINDS, 'Relationship', row.kind ?? '', errors);
      if (!kind) errors.push('Relationship kind is required');

      const from = row.effective_from?.trim()
        ? parseSheetDate(row.effective_from)
        : null;
      const to = row.effective_to?.trim() ? parseSheetDate(row.effective_to) : null;

      if (row.effective_from?.trim() && !from) {
        errors.push(`From date “${row.effective_from}” could not be read`);
      }
      if (row.effective_to?.trim() && !to) {
        errors.push(`To date “${row.effective_to}” could not be read`);
      }
      if (from && to && to < from) errors.push('The relationship ends before it starts');

      return {
        values: {
          kind,
          country_code: normaliseCountry(row.country_code),
          model_pattern: row.model_pattern?.trim() || null,
          purchase_channel: row.purchase_channel?.trim() || null,
          effective_from: from,
          effective_to: to,
        },
        errors,
      };
    },
  },
};

/**
 * Guesses the column mapping from the sheet's own headers.
 *
 * A guess, offered for correction — never applied silently. The operator sees
 * every mapping before anything is validated, because a header called "Phone"
 * meaning the branch's fax is not something a list of aliases can know.
 */
export function guessMapping(target: ImportTarget, headers: string[]): Record<string, string> {
  const spec = TARGETS[target];
  const mapping: Record<string, string> = {};
  const used = new Set<string>();

  for (const field of spec.fields) {
    const match = headers.find((header) => {
      if (used.has(header)) return false;
      const folded = header.trim().toLowerCase();
      return field.aliases.some((alias) => alias === folded) || folded === field.key;
    });
    if (match) {
      mapping[field.key] = match;
      used.add(match);
    }
  }

  return mapping;
}

/** Applies a mapping to a raw row, producing field-keyed values. */
export function applyMapping(
  mapping: Record<string, string>,
  raw: Record<string, string>,
): Record<string, string> {
  const mapped: Record<string, string> = {};
  for (const [field, header] of Object.entries(mapping)) {
    if (!header) continue;
    mapped[field] = raw[header] ?? '';
  }
  return mapped;
}

export type DuplicateFinding = {
  existingId: string;
  score: number;
  signals: DuplicateSignal[];
};

/**
 * Compares an incoming row against records that already exist.
 *
 * Returns the best candidate and why. Nothing is merged, nothing is
 * overwritten, and nothing is deleted: the row is marked as a duplicate and
 * waits for a person, because the loser of an automatic merge is often the more
 * carefully researched of the two and there is no way to find that out
 * afterwards.
 */
export function findDuplicate(
  target: ImportTarget,
  values: Record<string, unknown>,
  existing: Record<string, unknown>[],
): DuplicateFinding | null {
  const spec = TARGETS[target];
  if (spec.duplicateKey === 'none') return null;

  let best: DuplicateFinding | null = null;

  for (const candidate of existing) {
    const result =
      spec.duplicateKey === 'organisation'
        ? scoreOrganisationDuplicate(
            {
              name: String(values.name ?? ''),
              legalName: (values.legal_name as string) ?? null,
              countryCode: (values.country_code as string) ?? null,
              website: (values.website as string) ?? null,
              phone: (values.support_phone as string) ?? null,
            },
            {
              name: String(candidate.name ?? ''),
              legalName: (candidate.legal_name as string) ?? null,
              countryCode: (candidate.country_code as string) ?? null,
              website: (candidate.website as string) ?? null,
              phone: (candidate.support_phone as string) ?? null,
            },
          )
        : scoreLocationDuplicate(
            {
              name: (values.name as string) ?? null,
              addressLine: (values.address_line as string) ?? null,
              city: (values.city as string) ?? null,
              phone: (values.phone as string) ?? null,
              countryCode: (values.country_code as string) ?? null,
              latitude: (values.latitude as number) ?? null,
              longitude: (values.longitude as number) ?? null,
            },
            {
              name: (candidate.name as string) ?? null,
              addressLine: (candidate.address_line as string) ?? null,
              city: (candidate.city as string) ?? null,
              phone: (candidate.phone as string) ?? null,
              countryCode: (candidate.country_code as string) ?? null,
              latitude: (candidate.latitude as number) ?? null,
              longitude: (candidate.longitude as number) ?? null,
            },
          );

    if (result.score >= 40 && (!best || result.score > best.score)) {
      best = {
        existingId: String(candidate.id),
        score: result.score,
        signals: result.signals,
      };
    }
  }

  return best;
}
