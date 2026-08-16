import type { FieldSpec } from '@/components/RecordForm';

/**
 * Field definitions, shared between the create and edit screens.
 *
 * They live here rather than inline so that the two screens cannot drift — an
 * "add" form missing a field the "edit" form has is how records get created
 * incomplete and never noticed.
 *
 * Note what is absent everywhere: a default. No duration, no country, no
 * verification level, no "official" flag. Every optional field starts blank and
 * saves as null.
 */

export const ORGANISATION_FIELDS: FieldSpec[] = [
  { name: 'name', label: 'Name', required: true },
  { name: 'slug', label: 'Slug', required: true, hint: 'Stable identifier. Do not change once published.' },
  { name: 'legal_name', label: 'Registered name', hint: 'As registered. Hebrew is fine.' },
  {
    name: 'roles',
    label: 'Roles',
    type: 'multiselect',
    width: 'full',
    options: [
      { value: 'manufacturer', label: 'manufacturer' },
      { value: 'importer', label: 'importer' },
      { value: 'retailer', label: 'retailer' },
      { value: 'warranty_provider', label: 'warranty provider' },
      { value: 'service_provider', label: 'service provider' },
    ],
    hint: 'Several at once is normal here — one Israeli company is often importer, warranty provider and repairer.',
  },
  { name: 'country_code', label: 'Country', placeholder: 'IL' },
  { name: 'website', label: 'Website', type: 'url' },
  { name: 'support_phone', label: 'Support phone' },
  { name: 'support_email', label: 'Support email' },
  { name: 'is_verified', label: 'Confirmed as a real company', type: 'checkbox' },
];

export const CONTACT_KINDS = [
  'phone',
  'whatsapp',
  'email',
  'web_form',
  'website',
  'chat',
  'app',
  'address',
] as const;

export const CONTACT_PURPOSES = [
  'warranty_claim',
  'technical_support',
  'customer_service',
  'appointment_booking',
  'spare_parts',
  'sales',
  'general',
] as const;

export const CONTACT_FIELDS: FieldSpec[] = [
  {
    name: 'kind',
    label: 'Kind',
    type: 'select',
    required: true,
    options: CONTACT_KINDS.map((kind) => ({ value: kind, label: kind.replace(/_/g, ' ') })),
  },
  {
    name: 'purpose',
    label: 'Purpose',
    type: 'select',
    options: CONTACT_PURPOSES.map((purpose) => ({
      value: purpose,
      label: purpose.replace(/_/g, ' '),
    })),
    hint: 'Leave blank if the provider does not say. A guessed purpose sends people to the wrong desk.',
  },
  { name: 'value', label: 'Value', required: true, width: 'full', hint: 'The number, address or URL exactly as published.' },
  { name: 'label', label: 'Label', hint: 'What the provider calls this line.' },
  { name: 'country_code', label: 'Country', placeholder: 'IL' },
  { name: 'source_url', label: 'Where this was found', type: 'url', width: 'full' },
  { name: 'hours_note', label: 'Hours, as published', hint: 'Free text. Not parsed, not guessed.' },
  { name: 'notes', label: 'Notes', type: 'textarea', width: 'full' },
];

export const LOCATION_FIELDS: FieldSpec[] = [
  { name: 'name', label: 'Branch name' },
  { name: 'country_code', label: 'Country', placeholder: 'IL' },
  { name: 'region', label: 'Region' },
  { name: 'city', label: 'City' },
  { name: 'address_line', label: 'Street address', width: 'full' },
  { name: 'postal_code', label: 'Postal code' },
  { name: 'phone', label: 'Phone' },
  { name: 'email', label: 'Email' },
  { name: 'latitude', label: 'Latitude', type: 'number' },
  { name: 'longitude', label: 'Longitude', type: 'number' },
  {
    name: 'time_zone',
    label: 'Time zone',
    placeholder: 'Asia/Jerusalem',
    hint: 'Opening hours are resolved in the branch’s own zone, not the reader’s.',
  },
  { name: 'appointment_required', label: 'Appointment required', type: 'checkbox' },
  { name: 'source_url', label: 'Where this was found', type: 'url', width: 'full' },
];

export const CAPABILITY_KINDS = [
  'walk_in_service',
  'mail_in_service',
  'home_technician',
  'pickup_and_return',
  'on_site_repair',
  'courier_collection',
  'replacement_unit',
  'loaner_unit',
  'remote_diagnosis',
  'spare_parts_sale',
  'installation',
  'extended_warranty_sale',
] as const;

export const CAPABILITY_FIELDS: FieldSpec[] = [
  {
    name: 'kind',
    label: 'Capability',
    type: 'select',
    required: true,
    options: CAPABILITY_KINDS.map((kind) => ({ value: kind, label: kind.replace(/_/g, ' ') })),
  },
  {
    name: 'availability',
    label: 'Availability',
    type: 'select',
    required: true,
    options: [
      { value: 'available', label: 'available' },
      { value: 'unavailable', label: 'unavailable' },
      { value: 'unknown', label: 'not confirmed' },
    ],
    hint: '“Not confirmed” is the honest answer far more often than either of the others.',
  },
  { name: 'country_code', label: 'Country', placeholder: 'IL' },
  { name: 'region', label: 'Region' },
  { name: 'typical_lead_time_days', label: 'Typical lead time (days)', type: 'number' },
  { name: 'fee_note', label: 'Fee', hint: 'As published. Blank means unknown, not free.' },
  { name: 'notes', label: 'Notes', type: 'textarea', width: 'full' },
];

export const WARRANTY_FIELDS: FieldSpec[] = [
  {
    name: 'model_pattern',
    label: 'Model pattern',
    hint: 'SQL LIKE. “QE%S95%” matches a family; blank means the policy is not model-specific.',
    width: 'full',
  },
  { name: 'country_code', label: 'Country', placeholder: 'IL' },
  { name: 'policy_version', label: 'Policy version', hint: 'As the document names itself.' },
  { name: 'duration_months', label: 'Duration (months)', type: 'number' },
  { name: 'parts_months', label: 'Parts (months)', type: 'number' },
  { name: 'labour_months', label: 'Labour (months)', type: 'number' },
  { name: 'valid_from', label: 'Terms in force from', type: 'date' },
  { name: 'valid_to', label: 'Terms in force to', type: 'date' },
  { name: 'coverage_summary', label: 'What is covered', type: 'textarea', width: 'full' },
  { name: 'exclusions_summary', label: 'What is excluded', type: 'textarea', width: 'full' },
  {
    name: 'special_conditions_summary',
    label: 'Conditions and fees',
    type: 'textarea',
    width: 'full',
  },
];

export const RELATIONSHIP_KINDS = [
  'imports_for',
  'warranty_provider_for',
  'services_for',
  'authorized_service_for',
  'retails_for',
  'subsidiary_of',
] as const;

export const SOURCE_FIELDS: FieldSpec[] = [
  {
    name: 'kind',
    label: 'Source kind',
    type: 'select',
    required: true,
    options: [
      { value: 'manufacturer', label: 'manufacturer / importer document' },
      { value: 'retailer', label: 'retailer' },
      { value: 'internal_db', label: 'internal' },
      { value: 'document_extraction', label: 'document extraction' },
      { value: 'user_entered', label: 'user entered' },
      { value: 'ai_inferred', label: 'AI inferred' },
    ],
  },
  { name: 'document_title', label: 'Document title', width: 'full' },
  { name: 'source_url', label: 'URL', type: 'url', width: 'full' },
  { name: 'document_version', label: 'Version' },
  { name: 'language', label: 'Language', placeholder: 'he' },
  { name: 'country_code', label: 'Country', placeholder: 'IL' },
  { name: 'effective_from', label: 'Effective from', type: 'date' },
  { name: 'effective_to', label: 'Effective to', type: 'date' },
  { name: 'notes', label: 'Notes', type: 'textarea', width: 'full' },
];
