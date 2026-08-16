-- ---------------------------------------------------------------------------
-- Phase I — Data Operations
--
-- The machine that fills the tables the resolver reads. Everything here is
-- additive; the consumer RLS model is untouched, and admin access arrives as new
-- policies beside the existing owner-scoped ones rather than as changes to them.
--
-- Two ideas carry most of the weight.
--
--   1. `verification_state` says how *good* a fact is. `publication_status` says
--      where it is in a *workflow*. Conflating them would have meant either
--      breaking the resolver's source hierarchy or leaving unreviewed AI output
--      indistinguishable from a checked document.
--   2. Nothing an extractor produces is live. `published` is a state a person
--      puts a row into, and the resolver only reads published rows.
--
-- docs/V2_PHASE_I.md is the audit behind these choices.
-- ---------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- Admin identity
--
-- A separate table rather than a column on `user_profiles`, which users can
-- already update: a role stored there is an escalation target sitting on a row
-- the attacker controls. Membership is granted out of band — service role or
-- SQL — and never by anything the console exposes.
-- --------------------------------------------------------------------------

create type admin_role as enum ('admin', 'reviewer', 'data_editor', 'viewer');

create table admin_members (
  user_id    uuid primary key references user_profiles(id) on delete cascade,
  role       admin_role not null default 'viewer',
  granted_by uuid references user_profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  note       text
);

create index admin_members_active_idx on admin_members(role) where revoked_at is null;

/*
 * SECURITY DEFINER so a policy can consult the table without recursing into its
 * own RLS. Revoked membership is membership that has ended, not membership that
 * was deleted — the audit trail is the point.
 */
create or replace function is_admin(p_min_role admin_role default 'viewer')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from admin_members m
    where m.user_id = auth.uid()
      and m.revoked_at is null
      and case p_min_role
        when 'viewer'      then true
        when 'data_editor' then m.role in ('admin', 'reviewer', 'data_editor')
        when 'reviewer'    then m.role in ('admin', 'reviewer')
        when 'admin'       then m.role = 'admin'
      end
  );
$$;

comment on function is_admin(admin_role) is
  'Admin predicate for RLS. Default deny: a user with no row here is not an admin, and nothing a consumer can write grants it.';

-- --------------------------------------------------------------------------
-- Publication lifecycle
--
-- Orthogonal to `verification_state`, which keeps its meaning and its ordering
-- in the resolver's source hierarchy. This answers a different question: may the
-- app use this row yet.
--
-- The default is `published` for every existing row, because everything already
-- in the database predates the workflow and the resolver already reads it.
-- New extractions arrive as `candidate` and have to be walked forward by a
-- person.
-- --------------------------------------------------------------------------

create type publication_status as enum (
  'candidate',            -- extracted or imported, nobody has looked
  'needs_review',         -- queued for a human
  'verified',             -- a person checked it against its source
  'published',            -- live: the resolver may use it
  'needs_reverification', -- was published, has aged or its source changed
  'archived',             -- withdrawn, kept for audit
  'rejected'              -- reviewed and refused
);

/*
 * `demo` is structural rather than a naming convention. A fixture that leaks
 * into a user's warranty answer is worse than no answer, and "we called it
 * DEMO —" is not a guarantee.
 */
create type data_environment as enum ('production', 'demo');

do $$
declare
  t text;
begin
  foreach t in array array[
    'warranties', 'warranty_terms', 'warranty_sources',
    'provider_contact_methods', 'service_locations', 'service_capabilities',
    'organisations'
  ] loop
    execute format(
      'alter table %I
         add column publication_status publication_status not null default ''published'',
         add column data_environment data_environment not null default ''production'',
         add column reviewed_by uuid references user_profiles(id) on delete set null,
         add column reviewed_at timestamptz,
         add column review_note text', t);
    execute format(
      'create index %I on %I(publication_status) where publication_status <> ''published''',
      t || '_pubstatus_idx', t);
  end loop;
end;
$$;

comment on column warranties.publication_status is
  'Workflow state, orthogonal to verification. The resolver reads published rows only.';

-- --------------------------------------------------------------------------
-- Organisation relationships
--
-- `parent_id` models ownership. It cannot say "Samline imports Samsung
-- televisions into Israel, for products bought from March 2024" — which is
-- exactly the fact the whole product turns on, and exactly the fact that is not
-- permanent.
-- --------------------------------------------------------------------------

create type org_relationship_kind as enum (
  'imports_for',
  'warranty_provider_for',
  'services_for',
  'authorized_service_for',
  'retails_for',
  'subsidiary_of'
);

create table organisation_relationships (
  id            uuid primary key default gen_random_uuid(),
  -- "Samline imports_for Samsung": subject acts for object.
  subject_id    uuid not null references organisations(id) on delete cascade,
  object_id     uuid not null references organisations(id) on delete cascade,
  kind          org_relationship_kind not null,

  -- Scope. Every one of these may be null, meaning "not narrowed" — which is
  -- different from "everywhere", and the resolver treats it as the former.
  country_code  char(2),
  category_id   uuid references product_categories(id) on delete cascade,
  model_pattern text,
  purchase_channel text,

  -- A relationship that ended still explains a product bought while it held.
  effective_from date,
  effective_to   date,

  source_id     uuid references warranty_sources(id) on delete set null,
  verification  verification_state not null default 'unverified',
  publication_status publication_status not null default 'candidate',
  data_environment   data_environment not null default 'production',
  verified_at   timestamptz,
  reviewed_by   uuid references user_profiles(id) on delete set null,
  reviewed_at   timestamptz,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint org_relationships_not_self check (subject_id <> object_id),
  constraint org_relationships_dates check (
    effective_from is null or effective_to is null or effective_to >= effective_from
  )
);

create index org_relationships_subject_idx on organisation_relationships(subject_id, kind);
create index org_relationships_object_idx on organisation_relationships(object_id, kind);
create index org_relationships_scope_idx on organisation_relationships(country_code, category_id);

create trigger organisation_relationships_set_updated_at
  before update on organisation_relationships
  for each row execute function set_updated_at();

comment on table organisation_relationships is
  'Scoped, dated relationships. A relationship that ended still explains a product bought while it held, which is why nothing here is deleted.';

-- --------------------------------------------------------------------------
-- Source snapshots
--
-- A live URL is not evidence. When a manufacturer quietly reissues its terms,
-- the record of what we verified has to survive the change — so a snapshot is
-- appended per fetch and never overwritten.
-- --------------------------------------------------------------------------

create table warranty_source_snapshots (
  id           uuid primary key default gen_random_uuid(),
  source_id    uuid not null references warranty_sources(id) on delete cascade,
  fetched_at   timestamptz not null default now(),
  fetched_by   uuid references user_profiles(id) on delete set null,
  http_status  int,
  content_hash text,
  page_title   text,
  -- The text as it read at fetch time. Bounded: this is evidence, not an
  -- archive, and a 5 MB page helps nobody review a phone number.
  extracted_text text check (extracted_text is null or length(extracted_text) <= 200000),
  byte_size    bigint,
  -- Set when this fetch differs from the previous one, which is what puts the
  -- source into the re-verification queue.
  changed_from_previous boolean not null default false,
  diff_summary text,
  note         text
);

create index warranty_source_snapshots_source_idx
  on warranty_source_snapshots(source_id, fetched_at desc);

-- --------------------------------------------------------------------------
-- Freshness policy
--
-- Per data class, because the intervals genuinely differ: a phone number rots
-- faster than an importer relationship, and one arbitrary expiry for everything
-- either nags about stable facts or misses volatile ones.
-- --------------------------------------------------------------------------

create table freshness_policies (
  data_class     text primary key,
  -- Days after which a record is worth re-checking, and after which it should
  -- stop being presented as current.
  recheck_after_days int not null check (recheck_after_days > 0),
  stale_after_days   int not null check (stale_after_days > 0),
  note           text,
  updated_at     timestamptz not null default now(),

  constraint freshness_order check (stale_after_days > recheck_after_days)
);

insert into freshness_policies (data_class, recheck_after_days, stale_after_days, note) values
  ('provider_contact',      180, 365,  'Phone numbers and service lines change often and fail loudly.'),
  ('service_location',      270, 540,  'Branches move or close, but slowly.'),
  ('opening_hours',         180, 365,  'Seasonal and easily wrong.'),
  ('service_capability',    365, 730,  'A provider''s service model is fairly stable.'),
  ('importer_relationship', 365, 730,  'Changes rarely, but a change invalidates every route beneath it.'),
  ('warranty_policy',       540, 1095, 'Terms are reissued rarely; the validity window carries the history.')
on conflict (data_class) do nothing;

-- --------------------------------------------------------------------------
-- Bulk import
--
-- Row-level status is what turns "the import failed" into a report a person can
-- act on. A malformed row is recorded and skipped, never silently dropped and
-- never silently coerced.
-- --------------------------------------------------------------------------

create type import_target as enum (
  'organisations',
  'provider_contacts',
  'service_locations',
  'service_capabilities',
  'organisation_relationships'
);

create type import_job_status as enum (
  'uploaded', 'mapping', 'validating', 'preview', 'importing', 'completed', 'failed', 'cancelled'
);

create type import_row_status as enum (
  'pending', 'valid', 'invalid', 'duplicate', 'imported', 'skipped', 'merged'
);

create table import_jobs (
  id            uuid primary key default gen_random_uuid(),
  created_by    uuid not null references user_profiles(id) on delete cascade,
  target        import_target not null,
  file_name     text not null,
  status        import_job_status not null default 'uploaded',
  -- { "csv column" -> "table column" }, decided by the operator after the
  -- console proposes a mapping.
  column_mapping jsonb not null default '{}'::jsonb,
  data_environment data_environment not null default 'production',
  total_rows    int not null default 0,
  valid_rows    int not null default 0,
  invalid_rows  int not null default 0,
  duplicate_rows int not null default 0,
  imported_rows int not null default 0,
  error_summary text,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);

create index import_jobs_creator_idx on import_jobs(created_by, created_at desc);

create table import_rows (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references import_jobs(id) on delete cascade,
  row_number  int not null,
  -- Exactly what was in the file, before mapping. Kept so an operator can see
  -- what they uploaded rather than what we made of it.
  raw         jsonb not null,
  mapped      jsonb,
  status      import_row_status not null default 'pending',
  errors      text[] not null default '{}',
  -- What this row probably already is, and why we think so.
  duplicate_of uuid,
  duplicate_reason text,
  duplicate_score numeric(4,3),
  created_entity_id uuid,

  constraint import_rows_unique unique (job_id, row_number)
);

create index import_rows_job_idx on import_rows(job_id, status);

-- --------------------------------------------------------------------------
-- Extraction queue
--
-- `ocr_jobs` is receipt-shaped and per-user. This is global, admin-owned, and
-- tracks a document from bytes to a reviewed policy.
-- --------------------------------------------------------------------------

create type extraction_status as enum (
  'pending', 'fetching', 'text_extracted', 'extracting', 'needs_review',
  'reviewed', 'failed', 'unsupported'
);

create table extraction_jobs (
  id            uuid primary key default gen_random_uuid(),
  created_by    uuid references user_profiles(id) on delete set null,
  -- One of these. A URL job fetches first; a document job already has bytes.
  source_url    text,
  document_id   uuid references product_documents(id) on delete set null,
  source_id     uuid references warranty_sources(id) on delete set null,

  organisation_id uuid references organisations(id) on delete set null,
  brand_id      uuid references organisations(id) on delete set null,
  category_id   uuid references product_categories(id) on delete set null,
  country_code  char(2),

  status        extraction_status not null default 'pending',
  -- What it produced, so the review queue can link straight to it.
  warranty_id   uuid references warranties(id) on delete set null,
  clause_count  int not null default 0,
  low_confidence_count int not null default 0,
  failure_reason text,
  extraction_version text,
  attempts      int not null default 0,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  completed_at  timestamptz,

  constraint extraction_jobs_has_input check (source_url is not null or document_id is not null)
);

create index extraction_jobs_status_idx on extraction_jobs(status, created_at);

create trigger extraction_jobs_set_updated_at
  before update on extraction_jobs
  for each row execute function set_updated_at();

-- --------------------------------------------------------------------------
-- Conflict resolution
--
-- Item 15 is explicit: do not choose one policy and delete the other. Two
-- policies genuinely can both be right for different products, so a resolution
-- records a *decision* and, where the answer is "both", the rule that separates
-- them.
-- --------------------------------------------------------------------------

create type conflict_resolution_kind as enum (
  'chose_policy',       -- one of them applies here
  'both_valid',         -- both apply, in different circumstances
  'rejected_source',    -- one source is not trustworthy
  'needs_more_review'   -- escalated
);

create table warranty_conflicts (
  id            uuid primary key default gen_random_uuid(),
  -- The comparable candidates that disagreed.
  warranty_ids  uuid[] not null,
  field         text not null,
  values_seen   jsonb not null default '{}'::jsonb,
  -- What surfaced it: a resolver run, an import, a user report.
  detected_by   text not null default 'resolver',
  product_id    uuid references products(id) on delete set null,

  status        text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolution    conflict_resolution_kind,
  chosen_warranty_id uuid references warranties(id) on delete set null,
  -- When the answer is "both", this is the rule that tells them apart.
  applicability_note text,
  resolved_by   uuid references user_profiles(id) on delete set null,
  resolved_at   timestamptz,

  created_at    timestamptz not null default now(),

  constraint warranty_conflicts_has_candidates check (cardinality(warranty_ids) >= 2)
);

create index warranty_conflicts_open_idx on warranty_conflicts(status, created_at)
  where status = 'open';

-- --------------------------------------------------------------------------
-- Resolution runs
--
-- The KPI. Storing runs is what turns a number into a trend, and what makes a
-- regression in the corpus visible before a user finds it.
-- --------------------------------------------------------------------------

create type resolution_failure as enum (
  'product_unknown',
  'model_unknown',
  'policy_missing',
  'importer_unknown',
  'provider_unknown',
  'contact_missing',
  'conflicting_policy',
  'country_mismatch',
  'stale_data',
  'insufficient_receipt_data'
);

create table resolution_runs (
  id            uuid primary key default gen_random_uuid(),
  created_by    uuid references user_profiles(id) on delete set null,
  -- The test set this belongs to, so a suite can be re-run and compared.
  suite         text,
  label         text,

  -- Inputs, exactly as an incoming product would supply them.
  brand_name    text,
  model         text,
  category_id   uuid references product_categories(id) on delete set null,
  country_code  char(2),
  purchase_date date,
  retailer_name text,
  importer_name text,

  -- The five stages of the Full Resolution Rate.
  product_identified boolean not null default false,
  warranty_resolved  boolean not null default false,
  provider_resolved  boolean not null default false,
  service_route_resolved boolean not null default false,
  contact_actionable boolean not null default false,

  matched_warranty_id uuid references warranties(id) on delete set null,
  match_score   int,
  match_state   text,
  failure_reasons resolution_failure[] not null default '{}',
  duration_ms   int,
  detail        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index resolution_runs_suite_idx on resolution_runs(suite, created_at desc);

/** Fully resolved means all five stages, which is the only claim worth making. */
create or replace function resolution_rates(p_suite text default null)
returns table (
  total int,
  product_identification_rate numeric,
  warranty_resolution_rate numeric,
  provider_resolution_rate numeric,
  service_route_resolution_rate numeric,
  full_resolution_rate numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with r as (
    select * from resolution_runs
    where p_suite is null or suite = p_suite
  )
  select
    count(*)::int,
    round(avg(case when product_identified then 1 else 0 end)::numeric, 3),
    round(avg(case when warranty_resolved then 1 else 0 end)::numeric, 3),
    round(avg(case when provider_resolved then 1 else 0 end)::numeric, 3),
    round(avg(case when service_route_resolved then 1 else 0 end)::numeric, 3),
    round(avg(case
      when product_identified and warranty_resolved and provider_resolved
       and service_route_resolved and contact_actionable then 1 else 0 end)::numeric, 3)
  from r;
$$;

-- --------------------------------------------------------------------------
-- Audit trail
--
-- `audit_logs` recorded that something happened. For trusted data an operator
-- needs to see what it was before.
-- --------------------------------------------------------------------------

alter table audit_logs
  add column before_state jsonb,
  add column after_state  jsonb,
  add column reason       text;

comment on column audit_logs.before_state is
  'Prior value for admin mutations to trusted data. Absent for consumer actions, which do not need it.';

-- --------------------------------------------------------------------------
-- Row Level Security
--
-- Additive. Consumer policies are untouched; these sit beside them.
-- --------------------------------------------------------------------------

alter table admin_members enable row level security;
create policy admin_members_select_self on admin_members
  for select using (user_id = auth.uid() or is_admin('admin'));
-- No INSERT/UPDATE policy at all. Membership is granted by the service role,
-- out of band. An admin table the console can write is an admin table an
-- attacker can write.

alter table organisation_relationships enable row level security;
create policy org_relationships_read on organisation_relationships
  for select to authenticated using (
    (publication_status = 'published' and data_environment = 'production') or is_admin()
  );
create policy org_relationships_write on organisation_relationships
  for all using (is_admin('data_editor')) with check (is_admin('data_editor'));

alter table warranty_source_snapshots enable row level security;
create policy source_snapshots_admin on warranty_source_snapshots
  for all using (is_admin()) with check (is_admin('data_editor'));

alter table freshness_policies enable row level security;
create policy freshness_read on freshness_policies for select to authenticated using (true);
create policy freshness_write on freshness_policies
  for all using (is_admin('admin')) with check (is_admin('admin'));

alter table import_jobs enable row level security;
create policy import_jobs_admin on import_jobs
  for all using (is_admin('data_editor')) with check (is_admin('data_editor'));

alter table import_rows enable row level security;
create policy import_rows_admin on import_rows
  for all using (is_admin('data_editor')) with check (is_admin('data_editor'));

alter table extraction_jobs enable row level security;
create policy extraction_jobs_admin on extraction_jobs
  for all using (is_admin()) with check (is_admin('data_editor'));

alter table warranty_conflicts enable row level security;
create policy warranty_conflicts_admin on warranty_conflicts
  for all using (is_admin()) with check (is_admin('reviewer'));

alter table resolution_runs enable row level security;
create policy resolution_runs_admin on resolution_runs
  for all using (is_admin()) with check (is_admin());

-- Admins may now write the global tables consumers can only read. The consumer
-- read policies stay exactly as they were.
create policy organisations_admin_write on organisations
  for all using (is_admin('data_editor')) with check (is_admin('data_editor'));
create policy warranties_admin_write on warranties
  for all using (is_admin('data_editor')) with check (is_admin('data_editor'));
create policy warranty_terms_admin_write on warranty_terms
  for all using (is_admin('data_editor')) with check (is_admin('data_editor'));
create policy warranty_sources_admin_write on warranty_sources
  for all using (is_admin('data_editor')) with check (is_admin('data_editor'));
create policy contact_methods_admin_write on provider_contact_methods
  for all using (is_admin('data_editor')) with check (is_admin('data_editor'));
create policy service_locations_admin_write on service_locations
  for all using (is_admin('data_editor')) with check (is_admin('data_editor'));
create policy service_capabilities_admin_write on service_capabilities
  for all using (is_admin('data_editor')) with check (is_admin('data_editor'));

-- Reviewing a user report is an admin action; the reporter still only sees
-- their own, which is the policy from Phase H and stays untouched.
create policy service_reports_admin on service_data_reports
  for all using (is_admin('reviewer')) with check (is_admin('reviewer'));

-- Admins read the audit trail. Nobody writes it from a client — the service
-- role does, from the functions that make the changes.
create policy audit_logs_admin_read on audit_logs
  for select using (is_admin('admin'));

-- --------------------------------------------------------------------------
-- The published view the resolver should read
--
-- Existing resolver functions are left alone in this migration so nothing in
-- the app changes behaviour today. This is what they move onto once the corpus
-- has unpublished rows in it, and what the console uses to preview what a user
-- would actually see.
-- --------------------------------------------------------------------------

create or replace view published_warranties
with (security_invoker = true) as
  select * from warranties
   where publication_status = 'published'
     and data_environment = 'production';

comment on view published_warranties is
  'What a consumer may be shown. Demo fixtures and unreviewed extractions are structurally excluded, not excluded by naming convention.';
