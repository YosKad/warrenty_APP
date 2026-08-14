-- ---------------------------------------------------------------------------
-- Phase H — Service Concierge
--
-- Phase E built the tables; this makes them able to answer a real question.
-- Three things were missing:
--
--   1. A contact method had no *purpose*, so the spare-parts line and the
--      warranty-claims line were indistinguishable. Recommending the wrong one
--      is the single most likely way this feature wastes someone's afternoon.
--   2. A service location had no idea which brands or categories it services,
--      so "nearest" could only ever mean nearest, not nearest *useful*.
--   3. Nothing a user reported could go anywhere. A dead phone number needs a
--      queue, not a write to a globally shared record.
--
-- Everything here is additive. `docs/V2_PHASE_H.md` is the audit behind it.
-- ---------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- Capability vocabulary
--
-- Six kinds were enough to say "they do home visits". Twelve are needed to say
-- something a person can act on: whether a technician comes to you, whether a
-- courier collects, whether you must book first, and whether the shop can even
-- take this category in through the door.
--
-- ALTER TYPE ... ADD VALUE is allowed inside a transaction since PG12 provided
-- the new value is not *used* in the same transaction, which is why nothing
-- below inserts one. `home_visit` is kept rather than renamed: existing rows use
-- it, and an enum rename is not worth a data migration for a synonym.
-- --------------------------------------------------------------------------

alter type service_capability_kind add value if not exists 'home_technician';
alter type service_capability_kind add value if not exists 'courier';
alter type service_capability_kind add value if not exists 'appointment_required';
alter type service_capability_kind add value if not exists 'phone_diagnostics';
alter type service_capability_kind add value if not exists 'remote_support';
alter type service_capability_kind add value if not exists 'on_site_repair';
alter type service_capability_kind add value if not exists 'drop_off';
alter type service_capability_kind add value if not exists 'replacement_center';
alter type service_capability_kind add value if not exists 'spare_parts';

alter type contact_method_kind add value if not exists 'sms';

-- --------------------------------------------------------------------------
-- Contact purpose
--
-- Not every number a company publishes is the number for a warranty repair.
-- Sales will transfer you; spare parts will not know; the general line will put
-- you through a menu. The purpose is what makes a recommendation better than a
-- directory.
-- --------------------------------------------------------------------------

create type contact_purpose as enum (
  'warranty_claims',
  'technical_support',
  'customer_service',
  'spare_parts',
  'appointments',
  'sales',
  'general',
  'unknown'
);

alter table provider_contact_methods
  add column purpose      contact_purpose not null default 'unknown',
  -- Where this number was published, so a stale one can be re-checked against
  -- the same page it came from rather than searched for again.
  add column source_url   text,
  add column notes        text,
  -- Free-text hours for providers who publish prose rather than a table
  -- ("Sun–Thu 9:00–17:00, Fri 9:00–13:00"). Rendered as-is; never parsed into a
  -- false "open now".
  add column hours_note   text;

create index provider_contact_methods_purpose_idx
  on provider_contact_methods(organisation_id, purpose, priority) where is_active;

comment on column provider_contact_methods.purpose is
  'What this channel is actually for. Recommending the spare-parts line for a warranty repair is the most likely way this feature wastes an afternoon.';

-- --------------------------------------------------------------------------
-- Service locations
--
-- A branch that does not service televisions is not a television service centre,
-- however close it is. Empty arrays mean "not stated" and are treated as "we do
-- not know" rather than "services nothing" — the alternative would hide every
-- location we have not fully catalogued.
-- --------------------------------------------------------------------------

alter table service_locations
  add column serviced_brand_ids    uuid[] not null default '{}',
  add column serviced_category_ids uuid[] not null default '{}',
  add column appointment_required  boolean,
  -- IANA zone. Opening hours are meaningless without one, and a branch is not
  -- always in the user's own zone.
  add column time_zone             text,
  add column source                warranty_source_kind not null default 'internal_db',
  add column verification          verification_state not null default 'unverified',
  add column verified_at           timestamptz,
  add column source_url            text,
  add column closed_at             timestamptz;

create index service_locations_brands_idx
  on service_locations using gin (serviced_brand_ids);
create index service_locations_categories_idx
  on service_locations using gin (serviced_category_ids);

comment on column service_locations.serviced_brand_ids is
  'Empty means not stated, never "services nothing". Filtering a location out for lack of a catalogue entry would hide most of the network.';
comment on column service_locations.closed_at is
  'Set instead of deleting. A closed branch a user was sent to last month is still worth being able to explain.';

-- --------------------------------------------------------------------------
-- User corrections
--
-- A dead phone number is a fact the user knows and we do not. It must reach us,
-- and it must not reach the shared record directly: one person reporting a
-- number as wrong cannot be allowed to remove it for everyone, because the
-- cheapest attack on a warranty app is making the right number disappear.
-- --------------------------------------------------------------------------

create type service_report_kind as enum (
  'wrong_phone',
  'location_closed',
  'wrong_importer',
  'service_unavailable',
  'wrong_address',
  'wrong_hours',
  'other'
);

create type service_report_status as enum ('open', 'accepted', 'rejected', 'duplicate');

create table service_data_reports (
  id              uuid primary key default gen_random_uuid(),
  reporter_id     uuid not null references user_profiles(id) on delete cascade,
  -- What the report is about. Exactly one of these is set in practice, but the
  -- schema does not enforce it: a report about a location's phone number is
  -- legitimately about both.
  organisation_id     uuid references organisations(id) on delete cascade,
  service_location_id uuid references service_locations(id) on delete cascade,
  contact_method_id   uuid references provider_contact_methods(id) on delete cascade,
  product_id          uuid references products(id) on delete set null,

  kind            service_report_kind not null,
  -- The user's own words. Data, never instruction — same handling as a claim
  -- description.
  note            text check (note is null or length(note) <= 1000),
  -- What they say it should be, when they know.
  suggested_value text check (suggested_value is null or length(suggested_value) <= 500),

  status          service_report_status not null default 'open',
  reviewed_by     uuid references user_profiles(id) on delete set null,
  reviewed_at     timestamptz,
  review_note     text,

  created_at      timestamptz not null default now(),

  constraint service_data_reports_targets_something check (
    organisation_id is not null
    or service_location_id is not null
    or contact_method_id is not null
  )
);

create index service_data_reports_open_idx on service_data_reports(status, created_at)
  where status = 'open';
create index service_data_reports_reporter_idx on service_data_reports(reporter_id);
create index service_data_reports_org_idx on service_data_reports(organisation_id)
  where organisation_id is not null;

comment on table service_data_reports is
  'A queue, not an edit. One person reporting a number as wrong must not remove it for everyone — making the right number disappear is the cheapest attack on a warranty app.';

-- --------------------------------------------------------------------------
-- The service route, in one round trip
--
-- Product detail shows a preview and the concierge screen shows the whole
-- thing; both would otherwise be four queries and an N+1 over locations. This
-- returns the organisations, their contact methods and their capabilities as
-- three JSON aggregates, and leaves every judgement — which contact to
-- recommend, which location is compatible, how fresh the data is — to
-- src/domain/serviceConcierge.ts, where it can be unit-tested.
-- --------------------------------------------------------------------------

create or replace function get_service_route(p_product_id uuid)
returns table (
  role            text,
  organisation_id uuid,
  name            text,
  legal_name      text,
  country_code    char(2),
  website         text,
  is_verified     boolean,
  contacts        jsonb,
  capabilities    jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  with p as (
    select * from products where id = p_product_id and deleted_at is null
  ),
  -- The resolved policy decides the route. Two identical televisions imported
  -- by different companies have different service chains, and it is the
  -- warranty that knows which is which.
  policy as (
    select w.* from warranties w
    join p on p.warranty_id = w.id
  ),
  roles as (
    select 'manufacturer' as role, p.brand_id as org_id, 1 as ord from p
    union all select 'importer', coalesce(p.importer_id, (select importer_id from policy)), 2 from p
    union all select 'retailer', p.retailer_id, 3 from p
    union all select 'warranty_provider',
                    coalesce(p.warranty_provider_id, (select warranty_provider_id from policy)), 4 from p
    union all select 'service_provider', p.service_provider_id, 5 from p
  )
  select
    r.role,
    o.id,
    o.name,
    o.legal_name,
    o.country_code,
    o.website,
    o.is_verified,
    coalesce(
      (select jsonb_agg(to_jsonb(c) order by c.priority)
         from (
           select cm.id, cm.kind, cm.purpose, cm.value, cm.label, cm.language_codes,
                  cm.country_code, cm.hours, cm.hours_note, cm.priority, cm.source,
                  cm.verification, cm.verified_at, cm.source_url, cm.service_location_id
             from provider_contact_methods cm
            where cm.organisation_id = o.id and cm.is_active
         ) c),
      '[]'::jsonb
    ),
    coalesce(
      (select jsonb_agg(to_jsonb(k))
         from (
           select sc.id, sc.kind, sc.availability, sc.country_code, sc.region,
                  sc.typical_lead_time_days, sc.fee_note, sc.source, sc.verification,
                  sc.verified_at, sc.service_location_id
             from service_capabilities sc
            where sc.organisation_id = o.id
         ) k),
      '[]'::jsonb
    )
  from roles r
  join organisations o on o.id = r.org_id
  order by r.ord;
$$;

comment on function get_service_route(uuid) is
  'Provider chain with contacts and capabilities in one round trip. Every judgement lives in src/domain/serviceConcierge.ts.';

-- --------------------------------------------------------------------------
-- Compatible locations
--
-- Filtering happens here and ranking happens in the client, deliberately: the
-- database knows what a branch services, and the device knows where the user is
-- — and the device never has to tell the database, which is what keeps
-- "nearest" from requiring a location grant on the server.
-- --------------------------------------------------------------------------

create or replace function find_service_locations(
  p_product_id uuid,
  p_country_code char(2) default null,
  p_region text default null,
  p_city text default null
)
returns setof service_locations
language sql
stable
security invoker
set search_path = public
as $$
  with p as (
    select * from products where id = p_product_id and deleted_at is null
  ),
  route as (
    select organisation_id from get_service_route(p_product_id)
     where role in ('service_provider', 'warranty_provider', 'importer', 'manufacturer')
  )
  select l.*
  from service_locations l, p
  where l.organisation_id in (select organisation_id from route)
    and l.is_active
    and l.closed_at is null
    and l.country_code = coalesce(p_country_code, p.country_code)
    and (p_region is null or l.region = p_region)
    and (p_city is null or l.city ilike p_city)
    -- An empty array means "not catalogued", which is not the same as "services
    -- nothing". Filtering on it would hide most of a real network.
    and (cardinality(l.serviced_brand_ids) = 0
         or p.brand_id is null
         or p.brand_id = any(l.serviced_brand_ids))
    and (cardinality(l.serviced_category_ids) = 0
         or p.category_id = any(l.serviced_category_ids))
  limit 50;
$$;

comment on function find_service_locations is
  'Locations that can actually service this product. The correct centre beats the closest centre, so compatibility filters before distance ranks.';

-- --------------------------------------------------------------------------
-- Row Level Security
-- --------------------------------------------------------------------------

alter table service_data_reports enable row level security;

create policy service_reports_select_own on service_data_reports
  for select using (reporter_id = auth.uid());

create policy service_reports_insert_own on service_data_reports
  for insert with check (reporter_id = auth.uid());

-- No UPDATE policy. A user may report, and may see what they reported; the
-- review outcome is not theirs to write, or the queue would be decorative.

revoke update on service_data_reports from authenticated;
