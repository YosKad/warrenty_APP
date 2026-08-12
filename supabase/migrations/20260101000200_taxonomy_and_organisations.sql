-- ---------------------------------------------------------------------------
-- Shared reference data: categories, organisations (brands, retailers, service
-- providers) and their locations.
--
-- These tables are global, readable by every signed-in user and writable only by
-- admins / service-role. Categories are rows rather than an enum precisely so the
-- taxonomy can grow without shipping an app update.
-- ---------------------------------------------------------------------------

create table product_categories (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  -- Localised labels: { "en": "Electronics", "he": "אלקטרוניקה" }.
  -- Kept in the row so a new category is instantly usable in every language.
  labels        jsonb not null default '{}'::jsonb,
  parent_id     uuid references product_categories(id) on delete set null,
  icon          text,
  sort_order    int not null default 100,
  -- Typical manufacturer warranty for this category, used only as a *suggestion*
  -- in the add flow. Never written to a product without the user confirming.
  typical_warranty_months int,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index product_categories_parent_idx on product_categories(parent_id);
create index product_categories_active_idx on product_categories(is_active, sort_order);

create trigger product_categories_set_updated_at
  before update on product_categories
  for each row execute function set_updated_at();

-- --------------------------------------------------------------------------
-- Organisations
--
-- One table, many roles. Samsung is a manufacturer; Samsung Electronics Israel is
-- an importer and warranty provider; a local workshop is a service provider. The
-- roles array lets one row carry several hats without duplicating the entity.
-- --------------------------------------------------------------------------

create table organisations (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  name          text not null,
  legal_name    text,
  roles         org_role[] not null default '{}',
  -- null = operates globally; otherwise the country this entity serves.
  country_code  char(2),
  website       text,
  support_phone text,
  support_email citext,
  logo_url      text,
  -- Brands this organisation services (for service providers).
  serviced_brand_ids uuid[] not null default '{}',
  serviced_category_ids uuid[] not null default '{}',
  parent_id     uuid references organisations(id) on delete set null,
  is_verified   boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint organisations_country_upper check (
    country_code is null or country_code = upper(country_code)
  )
);

create index organisations_roles_idx on organisations using gin (roles);
create index organisations_country_idx on organisations(country_code);
create index organisations_name_trgm_idx on organisations using gin (name gin_trgm_ops);
create index organisations_serviced_brands_idx on organisations using gin (serviced_brand_ids);

create trigger organisations_set_updated_at
  before update on organisations
  for each row execute function set_updated_at();

comment on column organisations.roles is
  'A manufacturer, importer, retailer, warranty provider and repairer are distinct roles and often distinct companies. Modelling them as one table with roles keeps the relationships explicit.';

-- Physical service locations, for "nearest service centre".
create table service_locations (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  name            text,
  country_code    char(2) not null,
  region          text,
  city            text,
  address_line    text,
  postal_code     text,
  phone           text,
  email           citext,
  -- Coarse coordinates are enough to rank "nearest"; we never need precise GPS.
  latitude        numeric(9,6),
  longitude       numeric(9,6),
  -- { "mon": ["09:00","17:00"], ... } — null means unknown, not closed.
  opening_hours   jsonb,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index service_locations_org_idx on service_locations(organisation_id);
create index service_locations_geo_idx on service_locations(country_code, region, city);

create trigger service_locations_set_updated_at
  before update on service_locations
  for each row execute function set_updated_at();

-- --------------------------------------------------------------------------
-- Feature flags
--
-- Server-driven so capabilities (barcode scan, AI coverage, provider discovery) can
-- be rolled out gradually and killed instantly without an app release.
-- --------------------------------------------------------------------------

create table feature_flags (
  key            text primary key,
  description    text,
  enabled        boolean not null default false,
  -- 0–100. Bucketed by a stable hash of the user id, so a user's bucket never flips.
  rollout_percent int not null default 0 check (rollout_percent between 0 and 100),
  -- Optional restriction to specific plans, e.g. '{plus,pro}'.
  plans          plan_id[],
  min_app_version text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger feature_flags_set_updated_at
  before update on feature_flags
  for each row execute function set_updated_at();
