import {
  normaliseCountry,
  normaliseName,
  parseModel,
  parseSheetDate,
  scoreLocationDuplicate,
  scoreOrganisationDuplicate,
  slugify,
  type DuplicateSignal,
} from '@mw/domain';

import { CAPABILITY_KINDS, CONTACT_KINDS, CONTACT_PURPOSES, RELATIONSHIP_KINDS } from '@/lib/fields';
import { provenanceFields, readProvenance } from './provenance';

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
  | 'organisation_relationships'
  | 'organisation_aliases'
  | 'product_models'
  | 'model_aliases'
  | 'warranty_sources';

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
  duplicateKey: 'organisation' | 'location' | 'model' | 'none';
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

  // -------------------------------------------------------------------------
  // Phase I.5 — the model corpus
  // -------------------------------------------------------------------------

  organisation_aliases: {
    target: 'organisation_aliases',
    label: 'Organisation aliases',
    table: 'organisation_aliases',
    duplicateKey: 'none',
    fields: [
      {
        key: 'organisation',
        label: 'Organisation',
        required: true,
        aliases: ['organisation', 'organization', 'company', 'חברה'],
      },
      {
        key: 'value',
        label: 'Alias',
        required: true,
        aliases: ['alias', 'value', 'name', 'שם'],
        hint: 'How the company appears somewhere else — a Hebrew spelling, a receipt line, an abbreviation.',
      },
      {
        key: 'kind',
        label: 'Kind',
        aliases: ['kind', 'type'],
        hint: 'trading_name · legal_name · brand · abbreviation · transliteration · receipt_text',
      },
      { key: 'country_code', label: 'Country', aliases: ['country'] },
    ],
    validate(row) {
      const errors: string[] = [];
      const value = row.value?.trim() ?? '';
      if (!row.organisation?.trim()) errors.push('Organisation is required');
      if (!value) errors.push('Alias is required');

      const kind = enumField(
        ['trading_name', 'legal_name', 'brand', 'abbreviation', 'transliteration', 'receipt_text'],
        'Kind',
        row.kind ?? '',
        errors,
      );

      return {
        values: {
          value: value || null,
          // The comparison key comes from the same folding the resolver uses.
          normalized_key: normaliseName(value),
          kind: kind ?? 'trading_name',
          country_code: normaliseCountry(row.country_code),
        },
        errors,
      };
    },
  },

  product_models: {
    target: 'product_models',
    label: 'Models',
    table: 'product_models',
    duplicateKey: 'model',
    fields: [
      {
        key: 'manufacturer',
        label: 'Manufacturer',
        required: true,
        aliases: ['manufacturer', 'brand', 'maker', 'יצרן'],
        hint: 'The company that makes it. Not the importer, not the corporate parent.',
      },
      {
        key: 'canonical_model',
        label: 'Canonical name',
        required: true,
        aliases: ['model', 'canonical model', 'name', 'דגם'],
      },
      { key: 'family', label: 'Family', aliases: ['family', 'series', 'line'] },
      { key: 'variant', label: 'Variant', aliases: ['variant', 'edition'] },
      {
        key: 'regional_model',
        label: 'Market part number',
        aliases: ['regional model', 'part number', 'sku', 'market code'],
      },
      { key: 'country_code', label: 'Country', aliases: ['country'] },
    ],
    validate(row) {
      const errors: string[] = [];
      const canonical = row.canonical_model?.trim() ?? '';
      if (!row.manufacturer?.trim()) errors.push('Manufacturer is required');
      if (!canonical) errors.push('Canonical name is required');

      // The key is computed here, by the matcher's own parser. A researcher
      // never has to work it out, and it cannot drift from the algorithm.
      const parsed = canonical
        ? parseModel(canonical, { brands: [row.manufacturer ?? ''] })
        : null;
      if (canonical && !parsed?.normalised) {
        errors.push(`“${canonical}” contains nothing that identifies a product`);
      }

      return {
        values: {
          canonical_model: canonical || null,
          family: row.family?.trim() || null,
          variant: row.variant?.trim() || null,
          regional_model: row.regional_model?.trim() || null,
          country_code: normaliseCountry(row.country_code),
          normalized_key: parsed?.normalised ?? '',
        },
        errors,
      };
    },
  },

  model_aliases: {
    target: 'model_aliases',
    label: 'Model aliases',
    table: 'model_aliases',
    duplicateKey: 'none',
    fields: [
      {
        key: 'manufacturer',
        label: 'Manufacturer',
        required: true,
        aliases: ['manufacturer', 'brand', 'יצרן'],
      },
      {
        key: 'canonical_model',
        label: 'Model',
        required: true,
        aliases: ['model', 'canonical model', 'דגם'],
      },
      {
        key: 'value',
        label: 'Alias',
        required: true,
        aliases: ['alias', 'value', 'spelling', 'other name'],
      },
      {
        key: 'kind',
        label: 'Kind',
        aliases: ['kind', 'type'],
        hint: 'trading_name · regional_code · abbreviation · retailer_name · ocr_variant · legacy',
      },
    ],
    validate(row) {
      const errors: string[] = [];
      const value = row.value?.trim() ?? '';
      if (!row.canonical_model?.trim()) errors.push('Model is required');
      if (!value) errors.push('Alias is required');

      const kind = enumField(
        ['trading_name', 'regional_code', 'abbreviation', 'retailer_name', 'ocr_variant', 'legacy'],
        'Kind',
        row.kind ?? '',
        errors,
      );

      const parsed = value ? parseModel(value, { brands: [row.manufacturer ?? ''] }) : null;
      if (value && !parsed?.normalised) {
        errors.push(`“${value}” folds to nothing, so it could never match anything`);
      }

      return {
        values: {
          value: value || null,
          normalized_key: parsed?.normalised ?? '',
          kind: kind ?? 'trading_name',
        },
        errors,
      };
    },
  },

  warranty_sources: {
    target: 'warranty_sources',
    label: 'Sources',
    table: 'warranty_sources',
    duplicateKey: 'none',
    fields: [
      {
        key: 'document_title',
        label: 'Document title',
        required: true,
        aliases: ['title', 'document', 'document title', 'שם המסמך'],
      },
      { key: 'source_url', label: 'URL', aliases: ['url', 'link', 'source url', 'קישור'] },
      { key: 'organisation', label: 'Published by', aliases: ['organisation', 'publisher', 'company'] },
      { key: 'kind', label: 'Kind', aliases: ['kind', 'type'] },
      { key: 'document_version', label: 'Version', aliases: ['version'] },
      { key: 'language', label: 'Language', aliases: ['language', 'lang', 'שפה'] },
      { key: 'country_code', label: 'Country', aliases: ['country'] },
      { key: 'effective_from', label: 'Effective from', aliases: ['effective from', 'from'] },
      { key: 'content_hash', label: 'Content hash', aliases: ['hash', 'sha256', 'content hash'] },
    ],
    validate(row) {
      const errors: string[] = [];
      if (!row.document_title?.trim()) errors.push('Document title is required');

      const kind = enumField(
        ['manufacturer', 'retailer', 'internal_db', 'document_extraction', 'user_entered', 'ai_inferred'],
        'Kind',
        row.kind ?? '',
        errors,
      );

      const from = row.effective_from?.trim() ? parseSheetDate(row.effective_from) : null;
      if (row.effective_from?.trim() && !from) {
        errors.push(`Effective from “${row.effective_from}” could not be read`);
      }

      return {
        values: {
          document_title: row.document_title?.trim() || null,
          source_url: row.source_url?.trim() || null,
          kind: kind ?? 'internal_db',
          document_version: row.document_version?.trim() || null,
          language: row.language?.trim() || null,
          country_code: normaliseCountry(row.country_code),
          effective_from: from,
          content_hash: row.content_hash?.trim() || null,
        },
        errors,
      };
    },
  },
};

/**
 * Every corpus target also accepts provenance columns.
 *
 * Appended rather than written into each definition so that adding a
 * provenance field cannot be forgotten for one target — which is how a corpus
 * ends up with facts nobody can trace.
 */
for (const spec of Object.values(TARGETS)) {
  spec.fields = [...spec.fields, ...provenanceFields()];
}

/**
 * The provenance a row carries, and what it is allowed to claim because of it.
 *
 * Re-exported here so the importer has one place to ask.
 */
export { readProvenance };

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

  // A model is a duplicate when it folds to the same comparison key under the
  // same manufacturer. Two manufacturers can legitimately both sell an "S95D";
  // one manufacturer cannot sell two of them.
  if (spec.duplicateKey === 'model') {
    for (const candidate of existing) {
      if (!values.normalized_key || candidate.normalized_key !== values.normalized_key) continue;
      if (
        values.manufacturer_id &&
        candidate.manufacturer_id &&
        values.manufacturer_id !== candidate.manufacturer_id
      ) {
        continue;
      }
      return {
        existingId: String(candidate.id),
        score: 100,
        signals: [
          {
            key: 'model_key',
            weight: 100,
            detail: `“${candidate.canonical_model}” already folds to ${values.normalized_key}`,
          },
        ],
      };
    }
    return null;
  }

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
