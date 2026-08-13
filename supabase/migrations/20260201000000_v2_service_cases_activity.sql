-- ---------------------------------------------------------------------------
-- V2 core: service capabilities, provider contacts, warranty cases, activity,
-- protection layers, pre-expiry checkups and recalls.
--
-- Written against the reuse decisions in docs/V2_AUDIT.md §D. Three existing
-- tables are extended rather than duplicated (claims, claim_messages,
-- product_documents); service_locations is reused as-is; four proposed tables
-- were dropped because an existing one already models the concept.
--
-- Two rules govern everything below.
--
-- 1. UNKNOWN IS A VALUE, NOT AN ABSENCE. A service capability we have not
--    confirmed is `unknown`, never `false`. A product with no protection layer
--    on record is not "out of warranty". The app is allowed to say "we don't
--    know" and is never allowed to guess a default.
--
-- 2. NOTHING HERE WEAKENS AN EXISTING CONTROL. Every new table gets RLS with a
--    default deny; owner-scoped tables key off auth.uid(); tables the server
--    owns (activity_events, recall_matches) get a SELECT policy and no INSERT
--    policy at all, exactly like ai_analyses and notifications.
--
-- Client types (`apps/mobile/src/types/database.ts`) are deliberately not
-- updated here: that file models only what the app queries, and the screens
-- for these tables land in phases G–L.
-- ---------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- Enums
-- --------------------------------------------------------------------------

-- How service is actually delivered. A television that must be carried to a
-- workshop and one collected from your living room are different products from
-- the owner's point of view, and that difference is invisible today.
create type service_capability_kind as enum (
  'home_visit', 'pickup', 'mail_in', 'walk_in', 'phone_support', 'online_support'
);

-- Three-valued on purpose. `unknown` is the default and must survive to the UI.
create type capability_availability as enum ('available', 'unavailable', 'unknown');

create type contact_method_kind as enum (
  'phone', 'whatsapp', 'email', 'web_form', 'website', 'chat', 'address'
);

-- Permanent history, distinct from `notifications`, which is delivery. A push
-- that failed to send still happened to the product; a warranty that expired is
-- part of the record whether or not anyone was told.
create type activity_event_kind as enum (
  'product_added', 'product_updated', 'document_added', 'warranty_verified',
  'warranty_expiring', 'warranty_expired', 'coverage_checked',
  'case_opened', 'case_updated', 'case_resolved',
  'checkup_completed', 'recall_matched'
);

-- A product can carry several protections at once, from different providers,
-- ending on different dates.
create type protection_layer_kind as enum (
  'manufacturer', 'importer', 'retailer_extension', 'extended_plan',
  'credit_card', 'insurance', 'statutory'
);

create type case_event_kind as enum (
  'note', 'status_change', 'provider_contacted', 'provider_replied',
  'appointment_scheduled', 'item_collected', 'item_returned',
  'quote_received', 'document_attached'
);

create type service_channel as enum (
  'phone', 'whatsapp', 'email', 'web_form', 'walk_in', 'unknown'
);

create type checkup_status as enum ('pending', 'in_progress', 'completed', 'skipped');

create type recall_severity as enum ('advisory', 'safety', 'critical');

-- --------------------------------------------------------------------------
-- Service capabilities
--
-- Attached to an organisation, optionally narrowed to one location: an importer
-- may offer home visits nationally but only in some cities. A row scoped to a
-- location wins over the organisation-wide row for that location.
-- --------------------------------------------------------------------------

create table service_capabilities (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references organisations(id) on delete cascade,
  service_location_id uuid references service_locations(id) on delete cascade,
  kind                service_capability_kind not null,
  availability        capability_availability not null default 'unknown',
  -- Coverage area for home visit and pickup. Null means "not stated", which is
  -- not the same as "everywhere".
  country_code        char(2),
  region              text,
  -- What it costs and how long it takes, when the provider publishes it.
  typical_lead_time_days int check (typical_lead_time_days >= 0),
  fee_note            text,
  -- Where this came from, so the UI can show it with the same honesty as a
  -- warranty date rather than presenting scraped data as fact.
  source              warranty_source_kind not null default 'internal_db',
  verification        verification_state not null default 'unverified',
  verified_at         timestamptz,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- One row per capability per scope. Two conflicting answers to "do they come
  -- to your house?" is worse than no answer.
  constraint service_capabilities_scope_unique
    unique nulls not distinct (organisation_id, service_location_id, kind, country_code, region)
);

create index service_capabilities_org_idx on service_capabilities(organisation_id, kind);
create index service_capabilities_location_idx on service_capabilities(service_location_id)
  where service_location_id is not null;

create trigger service_capabilities_set_updated_at
  before update on service_capabilities
  for each row execute function set_updated_at();

-- --------------------------------------------------------------------------
-- Provider contact methods
--
-- Providers legitimately have several ways in, and they are not interchangeable:
-- the WhatsApp number is answered, the web form is not. Flattening these into
-- one column on `organisations` is why "contact support" so often fails.
-- --------------------------------------------------------------------------

create table provider_contact_methods (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references organisations(id) on delete cascade,
  service_location_id uuid references service_locations(id) on delete cascade,
  kind                contact_method_kind not null,
  -- The dialable number, mailto address or URL. Rendered with a bidi isolate so
  -- a Latin number survives a Hebrew layout.
  value               text not null check (length(btrim(value)) between 1 and 500),
  label               text,
  language_codes      text[] not null default '{}',
  country_code        char(2),
  -- { "mon": ["09:00","17:00"], ... }; null means unknown, not closed.
  hours               jsonb,
  -- Lower sorts first. Lets a curated "call this first" ordering exist without
  -- the client inventing one.
  priority            smallint not null default 100,
  is_active           boolean not null default true,
  source              warranty_source_kind not null default 'internal_db',
  verification        verification_state not null default 'unverified',
  verified_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index provider_contact_methods_org_idx
  on provider_contact_methods(organisation_id, priority) where is_active;
create index provider_contact_methods_location_idx
  on provider_contact_methods(service_location_id) where service_location_id is not null;

create trigger provider_contact_methods_set_updated_at
  before update on provider_contact_methods
  for each row execute function set_updated_at();

-- --------------------------------------------------------------------------
-- Protection layers
--
-- The single warranty window on `products` cannot express "manufacturer cover
-- ended last year, the retailer's extension runs another two, and the card I
-- paid with adds a third". Each layer keeps its own dates, provider and
-- provenance; `products.warranty_end` remains the primary window so nothing
-- that reads it today changes behaviour.
-- --------------------------------------------------------------------------

create table product_protection_layers (
  id                uuid primary key default gen_random_uuid(),
  product_id        uuid not null references products(id) on delete cascade,
  owner_id          uuid not null references user_profiles(id) on delete cascade,
  kind              protection_layer_kind not null,
  provider_id       uuid references organisations(id) on delete set null,
  -- Free text for a provider we have no organisation record for. Better than
  -- refusing to store what the user knows.
  provider_name     text,
  starts_on         date,
  ends_on           date,
  duration_months   int check (duration_months between 0 and 600),
  -- What this layer actually covers, in the provider's words where we have them.
  coverage_summary  text,
  policy_number     text,
  warranty_id       uuid references warranties(id) on delete set null,
  document_id       uuid references product_documents(id) on delete set null,
  source            warranty_source_kind not null default 'user_entered',
  verified_by_user  boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,

  constraint protection_layer_dates_ordered
    check (starts_on is null or ends_on is null or ends_on >= starts_on)
);

create index protection_layers_product_idx
  on product_protection_layers(product_id) where deleted_at is null;
create index protection_layers_owner_idx
  on product_protection_layers(owner_id) where deleted_at is null;

create trigger product_protection_layers_set_updated_at
  before update on product_protection_layers
  for each row execute function set_updated_at();

-- --------------------------------------------------------------------------
-- Warranty cases — extending `claims`
--
-- `claims` already models product, owner, status, issue, snapshot, provider,
-- location, reference number and resolution. A warranty case is that, plus how
-- it is being handled. Extending keeps one history rather than splitting a
-- user's repair across two tables depending on which version created it.
-- --------------------------------------------------------------------------

alter table claims
  -- Human-quotable identifier. The number the user reads down the phone.
  add column case_number      text,
  add column channel          service_channel not null default 'unknown',
  add column contact_method_id uuid references provider_contact_methods(id) on delete set null,
  add column appointment_at   timestamptz,
  add column appointment_location_id uuid references service_locations(id) on delete set null,
  add column estimated_cost   numeric(12,2) check (estimated_cost >= 0),
  add column actual_cost      numeric(12,2) check (actual_cost >= 0),
  add column currency         char(3),
  -- Set when the case leaves 'draft'. Separate from created_at, which is when
  -- the user started typing.
  add column opened_at        timestamptz,
  add column last_activity_at timestamptz;

create unique index claims_case_number_idx on claims(owner_id, case_number)
  where case_number is not null and deleted_at is null;

comment on column claims.snapshot is
  'Facts frozen at case-open time so a case stays explainable after the product is edited.';

-- Timeline entries become typed events rather than free text with a role.
alter table claim_messages
  add column kind        case_event_kind not null default 'note',
  add column metadata    jsonb not null default '{}'::jsonb,
  -- When it happened, which is not always when it was recorded.
  add column occurred_at timestamptz not null default now();

create index claim_messages_kind_idx on claim_messages(claim_id, occurred_at desc);

-- Attachments reuse product_documents rather than a parallel store, so a receipt
-- attached to a case is the same object as the receipt on the product.
alter table product_documents
  add column claim_id uuid references claims(id) on delete set null;

create index product_documents_claim_idx on product_documents(claim_id)
  where claim_id is not null and deleted_at is null;

-- --------------------------------------------------------------------------
-- Activity
--
-- Server-written history. Distinct from `notifications`: one is what happened,
-- the other is what we told you about. Deleting a notification must never erase
-- the fact.
-- --------------------------------------------------------------------------

create table activity_events (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references user_profiles(id) on delete cascade,
  workspace_id uuid references workspaces(id) on delete cascade,
  product_id  uuid references products(id) on delete cascade,
  claim_id    uuid references claims(id) on delete set null,
  kind        activity_event_kind not null,
  -- Rendering data only: names, counts, dates. Never a message the client
  -- displays verbatim, so a compromised row cannot inject copy into the UI.
  payload     jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create index activity_events_owner_idx on activity_events(owner_id, occurred_at desc);
create index activity_events_product_idx on activity_events(product_id, occurred_at desc)
  where product_id is not null;

-- --------------------------------------------------------------------------
-- Pre-expiry checkups (schema only — the flow is V2.1)
-- --------------------------------------------------------------------------

create table checkup_templates (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid references product_categories(id) on delete cascade,
  -- Null category = the generic checkup, used when nothing more specific exists.
  locale       text not null default 'en',
  title        text not null,
  -- [{ id, prompt, kind: 'boolean'|'choice'|'text', options: [...] }]
  questions    jsonb not null default '[]'::jsonb,
  -- How many days before expiry this is worth offering.
  offer_within_days int not null default 45 check (offer_within_days > 0),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index checkup_templates_category_idx on checkup_templates(category_id, locale)
  where is_active;

create trigger checkup_templates_set_updated_at
  before update on checkup_templates
  for each row execute function set_updated_at();

create table product_checkups (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references products(id) on delete cascade,
  owner_id     uuid not null references user_profiles(id) on delete cascade,
  template_id  uuid references checkup_templates(id) on delete set null,
  status       checkup_status not null default 'pending',
  -- Set when a finding leads somewhere: the case it opened.
  claim_id     uuid references claims(id) on delete set null,
  started_at   timestamptz,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index product_checkups_product_idx on product_checkups(product_id, created_at desc);
create index product_checkups_owner_idx on product_checkups(owner_id, status);

create trigger product_checkups_set_updated_at
  before update on product_checkups
  for each row execute function set_updated_at();

create table checkup_answers (
  id          uuid primary key default gen_random_uuid(),
  checkup_id  uuid not null references product_checkups(id) on delete cascade,
  owner_id    uuid not null references user_profiles(id) on delete cascade,
  question_id text not null,
  -- The user's own words. Data, never instruction — the same handling as
  -- issue_description on claims.
  answer      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),

  constraint checkup_answers_one_per_question unique (checkup_id, question_id)
);

create index checkup_answers_checkup_idx on checkup_answers(checkup_id);

-- --------------------------------------------------------------------------
-- Recalls (schema only — matching is V2.1)
-- --------------------------------------------------------------------------

create table recall_notices (
  id             uuid primary key default gen_random_uuid(),
  -- Brands are organisations with role 'manufacturer'; there is no separate
  -- brand table, and inventing one here would fork the taxonomy.
  brand_id       uuid references organisations(id) on delete set null,
  category_id    uuid references product_categories(id) on delete set null,
  -- Model and serial ranges as published by the authority. Matching is
  -- deliberately conservative: a false "your product is recalled" is worse than
  -- a missed one, so a match needs a model hit, not a brand hit.
  model_patterns text[] not null default '{}',
  serial_ranges  jsonb not null default '[]'::jsonb,
  country_codes  char(2)[] not null default '{}',
  severity       recall_severity not null default 'advisory',
  title          text not null,
  summary        text not null,
  remedy         text,
  -- Where this was published. Shown to the user; we never paraphrase an
  -- authority without linking to it.
  authority      text,
  source_url     text,
  published_on   date,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index recall_notices_brand_idx on recall_notices(brand_id) where is_active;

create trigger recall_notices_set_updated_at
  before update on recall_notices
  for each row execute function set_updated_at();

create table recall_matches (
  id          uuid primary key default gen_random_uuid(),
  recall_id   uuid not null references recall_notices(id) on delete cascade,
  product_id  uuid not null references products(id) on delete cascade,
  owner_id    uuid not null references user_profiles(id) on delete cascade,
  confidence  confidence_level not null default 'low',
  matched_on  text[] not null default '{}',
  dismissed_at timestamptz,
  created_at  timestamptz not null default now(),

  constraint recall_matches_unique unique (recall_id, product_id)
);

create index recall_matches_owner_idx on recall_matches(owner_id) where dismissed_at is null;

-- --------------------------------------------------------------------------
-- Protection completeness in SQL
--
-- Mirrors `getProtectionCompleteness` in apps/mobile/src/domain/protection.ts,
-- weight for weight, so a server-side reminder and the app never disagree about
-- how ready a product is. The weights are stated once in each language and
-- guarded by a test on the TypeScript side; if you change one, change both.
--
-- Deliberately a function rather than a stored column: it is a pure function of
-- data already present, and storing it would create a cache to invalidate on
-- every edit to a product or its documents.
-- --------------------------------------------------------------------------

create or replace function product_protection_completeness(p_product_id uuid)
returns table (score int, gaps text[])
language sql
stable
security invoker
set search_path = public
as $$
  with p as (
    select
      pr.*,
      (select count(*) from product_documents d
        where d.product_id = pr.id
          and d.kind in ('receipt', 'invoice')
          and d.deleted_at is null) as proof_count
    from products pr
    where pr.id = p_product_id and pr.deleted_at is null
  ),
  f as (
    select * from (values
      ('purchase_date',     20, (select purchase_date is not null from p)),
      ('warranty_end',      20, (select warranty_end is not null
                                   or ((warranty_start is not null or purchase_date is not null)
                                       and coalesce(warranty_duration_months, 0) > 0) from p)),
      ('proof_of_purchase', 18, (select proof_count > 0 from p)),
      ('warranty_provider', 12, (select warranty_provider_id is not null from p)),
      ('warranty_terms',    10, (select warranty_id is not null from p)),
      ('serial_number',      8, (select length(btrim(coalesce(serial_number, ''))) > 0 from p)),
      ('service_provider',   7, (select service_provider_id is not null from p)),
      ('model',              5, (select length(btrim(coalesce(model, ''))) > 0 from p))
    ) as t(key, weight, satisfied)
  )
  select
    coalesce(sum(weight) filter (where satisfied), 0)::int as score,
    coalesce(
      array_agg(key order by weight desc) filter (where not satisfied),
      '{}'::text[]
    ) as gaps
  from f;
$$;

comment on function product_protection_completeness(uuid) is
  'Claim readiness 0-100 plus the unsatisfied factors, heaviest first. Mirrors src/domain/protection.ts.';

-- --------------------------------------------------------------------------
-- Row Level Security
--
-- Same rule as the original schema: enabled everywhere, default deny, and
-- server-owned tables get SELECT only.
-- --------------------------------------------------------------------------

-- Reference data: readable by any signed-in user, writable by no one but the
-- service role. This is catalogue data about companies, not user data.
alter table service_capabilities enable row level security;
create policy service_capabilities_read on service_capabilities
  for select to authenticated using (true);

alter table provider_contact_methods enable row level security;
create policy provider_contact_methods_read on provider_contact_methods
  for select to authenticated using (is_active);

alter table checkup_templates enable row level security;
create policy checkup_templates_read on checkup_templates
  for select to authenticated using (is_active);

alter table recall_notices enable row level security;
create policy recall_notices_read on recall_notices
  for select to authenticated using (is_active);

-- Owner-scoped, user-writable.
alter table product_protection_layers enable row level security;

create policy protection_layers_select_own on product_protection_layers
  for select using (owner_id = auth.uid() and deleted_at is null);

create policy protection_layers_insert_own on product_protection_layers
  for insert with check (
    owner_id = auth.uid()
    and exists (
      select 1 from products p
      where p.id = product_id and p.owner_id = auth.uid() and p.deleted_at is null
    )
  );

create policy protection_layers_update_own on product_protection_layers
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy protection_layers_delete_own on product_protection_layers
  for delete using (owner_id = auth.uid());

alter table product_checkups enable row level security;

create policy product_checkups_select_own on product_checkups
  for select using (owner_id = auth.uid());

create policy product_checkups_insert_own on product_checkups
  for insert with check (
    owner_id = auth.uid()
    and exists (
      select 1 from products p
      where p.id = product_id and p.owner_id = auth.uid() and p.deleted_at is null
    )
  );

create policy product_checkups_update_own on product_checkups
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

alter table checkup_answers enable row level security;

create policy checkup_answers_select_own on checkup_answers
  for select using (owner_id = auth.uid());

create policy checkup_answers_insert_own on checkup_answers
  for insert with check (
    owner_id = auth.uid()
    and exists (
      select 1 from product_checkups c
      where c.id = checkup_id and c.owner_id = auth.uid()
    )
  );

create policy checkup_answers_update_own on checkup_answers
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Server-written: readable by the owner, never writable by them. An activity
-- record a client could forge would be worthless as history, and a recall match
-- a client could create would be a way to make the app lie to its own user.
alter table activity_events enable row level security;
create policy activity_events_select_own on activity_events
  for select using (owner_id = auth.uid());

alter table recall_matches enable row level security;
create policy recall_matches_select_own on recall_matches
  for select using (owner_id = auth.uid());
-- Dismissing a match is the one thing a user may change about it.
create policy recall_matches_dismiss on recall_matches
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- --------------------------------------------------------------------------
-- Column-level hardening
--
-- Row policies stop the wrong user; these stop the right user from rewriting
-- fields the server owns via a hand-crafted PostgREST call.
-- --------------------------------------------------------------------------

revoke update (owner_id, product_id, created_at) on product_protection_layers from authenticated;
revoke update (owner_id, product_id, created_at) on product_checkups from authenticated;
revoke update (owner_id, checkup_id, question_id) on checkup_answers from authenticated;

-- Only the dismissal is the user's to set; confidence and match evidence are the
-- server's conclusions.
revoke update on recall_matches from authenticated;
grant update (dismissed_at) on recall_matches to authenticated;

-- Cases: the client may narrate its own case, but costs and appointment times
-- confirmed with a provider are written server-side, and the case number is
-- issued, not chosen.
revoke update (case_number, opened_at) on claims from authenticated;

-- A timeline entry is a record of something that happened. Letting a client
-- rewrite the kind or the time would let it rewrite history.
revoke update on claim_messages from authenticated;
