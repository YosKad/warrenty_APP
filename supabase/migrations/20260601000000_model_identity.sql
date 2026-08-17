-- ---------------------------------------------------------------------------
-- Model identity
--
-- Until now a policy said which products it covered with one SQL `LIKE`
-- pattern. That pattern has to be simultaneously tight enough to exclude the
-- wrong product and loose enough to admit every way the right one is written,
-- and those requirements point in opposite directions: `M4%` misses
-- "MacBook Air M4", and `%M4%` hits every M4 Mac ever made.
--
-- What the corpus actually knows is that a set of written forms denote one
-- product. That is a set, not a regular expression, so it gets tables.
--
-- Additive throughout. `warranties.model_pattern` stays and keeps working — a
-- policy that genuinely covers a range is still expressed as a range.
-- ---------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- Canonical models
-- --------------------------------------------------------------------------

create table product_models (
  id              uuid primary key default gen_random_uuid(),

  -- The manufacturer, as an organisation. Not the importer and not the
  -- corporate parent: BSH imports Bosch appliances and is neither of those.
  manufacturer_id uuid references organisations(id) on delete set null,

  /* The corpus's preferred name, e.g. "Samsung S95D". Shown to reviewers. */
  canonical_model text not null,
  /* Product line — "S95", "MacBook Air", "V15". Researched, not derived. */
  family          text,
  /* What distinguishes this member of the line: "Detect Absolute", "13-inch". */
  variant         text,
  /* The market part number, e.g. "QE65S95DATXXH". */
  regional_model  text,
  category_id     uuid references product_categories(id) on delete set null,
  country_code    char(2),

  /*
   * Comparison key, written by the importer and the console using the same
   * `parseModel` the app uses. Stored rather than computed in SQL because the
   * algorithm lives in TypeScript and a second implementation here is exactly
   * the drift the parity test exists to prevent.
   */
  normalized_key  text not null,

  source_id       uuid references warranty_sources(id) on delete set null,
  verification    verification_state not null default 'unverified',
  publication_status publication_status not null default 'candidate',
  data_environment   data_environment not null default 'production',
  verified_at     timestamptz,
  reviewed_by     uuid references user_profiles(id) on delete set null,
  reviewed_at     timestamptz,
  review_note     text,
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint product_models_key_not_empty check (length(trim(normalized_key)) > 0)
);

create index product_models_key_idx on product_models(normalized_key);
create index product_models_manufacturer_idx on product_models(manufacturer_id, family);
create index product_models_pubstatus_idx on product_models(publication_status)
  where publication_status <> 'published';

comment on table product_models is
  'One row per product the corpus can name. The set of ways to write it lives in model_aliases.';

create trigger product_models_set_updated_at
  before update on product_models
  for each row execute function set_updated_at();

-- --------------------------------------------------------------------------
-- Aliases
--
-- The alias set is the fact the corpus researches, so it carries the same
-- lifecycle as every other researched fact: its own source, its own
-- verification, its own review state. A model may propose one during
-- ingestion; only a reviewer can make it usable.
-- --------------------------------------------------------------------------

create type model_alias_kind as enum (
  'trading_name',     -- how the manufacturer markets it
  'regional_code',    -- the part number in one market
  'abbreviation',     -- "MBA M4"
  'retailer_name',    -- how a shop lists it on a receipt
  'ocr_variant',      -- a misreading seen often enough to record
  'legacy'            -- a name the product used to have
);

create table model_aliases (
  id             uuid primary key default gen_random_uuid(),
  model_id       uuid not null references product_models(id) on delete cascade,
  value          text not null,
  normalized_key text not null,
  kind           model_alias_kind not null default 'trading_name',

  source_id      uuid references warranty_sources(id) on delete set null,
  /* Where the alias came from when it was not researched by hand. */
  proposed_by    text,
  verification   verification_state not null default 'unverified',
  publication_status publication_status not null default 'candidate',
  data_environment   data_environment not null default 'production',
  verified_at    timestamptz,
  reviewed_by    uuid references user_profiles(id) on delete set null,
  reviewed_at    timestamptz,
  review_note    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- Unique on the *spelling*, not on the derived key: "QE65S95D" and
  -- "QE55S95D" are two real spellings that normalise to the same television in
  -- two sizes, and refusing the second would lose a fact the corpus researched.
  constraint model_aliases_unique unique (model_id, value)
);

create index model_aliases_key_idx on model_aliases(normalized_key);
create index model_aliases_review_idx on model_aliases(publication_status)
  where publication_status <> 'published';

comment on table model_aliases is
  'Verified spellings of a product. Only published or verified rows are used to resolve; the rest are proposals.';

create trigger model_aliases_set_updated_at
  before update on model_aliases
  for each row execute function set_updated_at();

-- --------------------------------------------------------------------------
-- Organisation aliases
--
-- "Apple Computer" and "Apple" are the same company; "BSH" and "Bosch" are not
-- the same *thing* at all — one is a company, the other a brand — and the
-- difference is expressed by which organisation the alias points at, not by
-- flattening them together.
-- --------------------------------------------------------------------------

create type organisation_alias_kind as enum (
  'trading_name',
  'legal_name',
  'brand',
  'abbreviation',
  'transliteration',   -- the Hebrew spelling of a Latin name, and the reverse
  'receipt_text'       -- how it appears on a till receipt
);

create table organisation_aliases (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  value           text not null,
  normalized_key  text not null,
  kind            organisation_alias_kind not null default 'trading_name',
  country_code    char(2),

  source_id       uuid references warranty_sources(id) on delete set null,
  verification    verification_state not null default 'unverified',
  publication_status publication_status not null default 'candidate',
  data_environment   data_environment not null default 'production',
  verified_at     timestamptz,
  reviewed_by     uuid references user_profiles(id) on delete set null,
  reviewed_at     timestamptz,
  review_note     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint organisation_aliases_unique unique (organisation_id, normalized_key)
);

create index organisation_aliases_key_idx on organisation_aliases(normalized_key);

create trigger organisation_aliases_set_updated_at
  before update on organisation_aliases
  for each row execute function set_updated_at();

-- --------------------------------------------------------------------------
-- Serial-number applicability
--
-- Prepared, not populated. Manufacturers really do scope terms by serial range
-- — a recall batch, a market, a production year — but what those ranges are is
-- corpus evidence. Inventing a rule here would be inventing warranty coverage.
-- --------------------------------------------------------------------------

create type serial_rule_kind as enum ('prefix', 'range', 'pattern');

create table warranty_serial_rules (
  id            uuid primary key default gen_random_uuid(),
  warranty_id   uuid not null references warranties(id) on delete cascade,
  kind          serial_rule_kind not null,
  /* prefix: the leading characters. pattern: a LIKE pattern. */
  value         text,
  /* range: inclusive bounds, compared as text in the manufacturer's own order. */
  range_from    text,
  range_to      text,
  note          text,

  source_id     uuid references warranty_sources(id) on delete set null,
  verification  verification_state not null default 'unverified',
  publication_status publication_status not null default 'candidate',
  data_environment   data_environment not null default 'production',
  reviewed_by   uuid references user_profiles(id) on delete set null,
  reviewed_at   timestamptz,
  review_note   text,
  created_at    timestamptz not null default now(),

  constraint serial_rule_shape check (
    (kind = 'range' and range_from is not null and range_to is not null)
    or (kind in ('prefix', 'pattern') and value is not null)
  )
);

create index warranty_serial_rules_warranty_idx on warranty_serial_rules(warranty_id);

comment on table warranty_serial_rules is
  'Serial-scoped applicability. Empty until a source says otherwise — an inferred serial rule is invented coverage.';

-- --------------------------------------------------------------------------
-- Policies point at models
--
-- Nullable, and alongside `model_pattern` rather than instead of it: a
-- category-wide policy genuinely has no model, and every existing row keeps
-- working exactly as it did.
-- --------------------------------------------------------------------------

alter table warranties
  add column model_id uuid references product_models(id) on delete set null;

create index warranties_model_idx on warranties(model_id);

comment on column warranties.model_id is
  'The canonical product this policy covers, when it covers exactly one. Preferred over model_pattern.';

alter table products
  add column model_id uuid references product_models(id) on delete set null,
  -- What the resolver concluded and why, so a user's screen and the console's
  -- explanation agree without recomputing.
  add column model_match_stage text,
  add column model_match_state text;

create index products_model_idx on products(model_id) where model_id is not null;

-- --------------------------------------------------------------------------
-- Row Level Security
--
-- The same shape as every other reference table: anyone signed in reads what is
-- published, admins read everything, editors write, and promotion is a
-- reviewer's act enforced by the shared trigger.
-- --------------------------------------------------------------------------

alter table product_models enable row level security;
create policy product_models_read on product_models
  for select to authenticated using (
    (publication_status = 'published' and data_environment = 'production') or is_admin()
  );
create policy product_models_write on product_models
  for all using (is_admin('data_editor')) with check (is_admin('data_editor'));

alter table model_aliases enable row level security;
create policy model_aliases_read on model_aliases
  for select to authenticated using (
    (publication_status = 'published' and data_environment = 'production') or is_admin()
  );
create policy model_aliases_write on model_aliases
  for all using (is_admin('data_editor')) with check (is_admin('data_editor'));

alter table organisation_aliases enable row level security;
create policy organisation_aliases_read on organisation_aliases
  for select to authenticated using (
    (publication_status = 'published' and data_environment = 'production') or is_admin()
  );
create policy organisation_aliases_write on organisation_aliases
  for all using (is_admin('data_editor')) with check (is_admin('data_editor'));

alter table warranty_serial_rules enable row level security;
create policy warranty_serial_rules_read on warranty_serial_rules
  for select to authenticated using (
    (publication_status = 'published' and data_environment = 'production') or is_admin()
  );
create policy warranty_serial_rules_write on warranty_serial_rules
  for all using (is_admin('data_editor')) with check (is_admin('data_editor'));

do $$
declare t text;
begin
  foreach t in array array[
    'product_models', 'model_aliases', 'organisation_aliases', 'warranty_serial_rules'
  ] loop
    execute format(
      'create trigger %I before insert or update on %I
         for each row execute function enforce_publication_promotion()',
      t || '_publication_guard', t);
  end loop;
end;
$$;
