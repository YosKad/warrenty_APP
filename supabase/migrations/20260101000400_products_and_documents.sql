-- ---------------------------------------------------------------------------
-- Products, documents and the derived warranty view
-- ---------------------------------------------------------------------------

create table products (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  -- Denormalised from the workspace so RLS can authorise a row without a join.
  -- Kept honest by the products_owner_matches_workspace trigger below.
  owner_id          uuid not null references user_profiles(id) on delete cascade,

  name              text not null check (length(btrim(name)) between 1 and 160),
  category_id       uuid not null references product_categories(id),
  brand_id          uuid references organisations(id) on delete set null,
  -- Free text for brands not yet in the taxonomy; an admin can promote it later.
  brand_name        text,
  model             text,
  serial_number     text,

  purchase_date     date,
  purchase_price    numeric(12,2) check (purchase_price is null or purchase_price >= 0),
  -- ISO 4217. Stored next to the amount; we never store a bare number.
  currency          char(3),
  retailer_id       uuid references organisations(id) on delete set null,
  retailer_name     text,
  country_code      char(2) not null default 'US',

  warranty_start    date,
  warranty_end      date,
  warranty_duration_months int check (
    warranty_duration_months is null or warranty_duration_months between 1 and 600
  ),
  extension_months  int not null default 0 check (extension_months between 0 and 600),
  warranty_source   warranty_source_kind not null default 'user_entered',
  -- The warranty policy this product was matched to, if any. Preserves *which*
  -- terms applied at purchase even if the manufacturer later publishes new ones.
  warranty_id       uuid references warranties(id) on delete set null,
  warranty_provider_id uuid references organisations(id) on delete set null,
  service_provider_id  uuid references organisations(id) on delete set null,
  -- False until the user has looked at auto-detected warranty data and confirmed it.
  warranty_verified_by_user boolean not null default false,

  image_path        text,
  notes             text check (notes is null or length(notes) <= 2000),
  lifecycle         product_lifecycle not null default 'active',

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,

  constraint products_currency_upper check (currency is null or currency = upper(currency)),
  constraint products_country_upper check (country_code = upper(country_code)),
  constraint products_price_needs_currency check (purchase_price is null or currency is not null),
  constraint products_warranty_order check (
    warranty_start is null or warranty_end is null or warranty_end >= warranty_start
  ),
  constraint products_warranty_after_purchase check (
    warranty_start is null or purchase_date is null or warranty_start >= purchase_date
  )
);

create index products_owner_idx on products(owner_id) where deleted_at is null;
create index products_workspace_idx on products(workspace_id) where deleted_at is null;
create index products_warranty_end_idx on products(warranty_end)
  where deleted_at is null and warranty_end is not null;
create index products_category_idx on products(category_id) where deleted_at is null;
create index products_brand_idx on products(brand_id) where deleted_at is null;
create index products_name_trgm_idx on products using gin (name gin_trgm_ops);
create index products_serial_idx on products(serial_number) where serial_number is not null;

create trigger products_set_updated_at
  before update on products
  for each row execute function set_updated_at();

-- owner_id is a denormalisation for RLS performance; this keeps it truthful.
create or replace function products_owner_matches_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from workspace_members m
    where m.workspace_id = new.workspace_id and m.user_id = new.owner_id
  ) then
    raise exception 'owner_id % is not a member of workspace %', new.owner_id, new.workspace_id
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger products_check_owner
  before insert or update of workspace_id, owner_id on products
  for each row execute function products_owner_matches_workspace();

-- --------------------------------------------------------------------------
-- Documents
--
-- Files live in a private Storage bucket; this table is the metadata index. The
-- storage_path always begins with the owner's uuid, which is what the Storage RLS
-- policies key off — see the storage migration.
-- --------------------------------------------------------------------------

create table product_documents (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id) on delete cascade,
  owner_id      uuid not null references user_profiles(id) on delete cascade,
  kind          document_kind not null default 'receipt',
  -- Path inside the 'documents' bucket: '<owner_id>/<product_id>/<uuid>.<ext>'.
  storage_path  text not null unique,
  file_name     text not null,
  mime_type     text not null,
  byte_size     bigint not null check (byte_size > 0 and byte_size <= 26214400), -- 25 MB
  -- sha256 of the file. Enables duplicate-receipt detection without comparing bytes.
  content_hash  text,
  page_count    int,
  -- Text extracted by OCR. Personal data: never logged, never sent to analytics.
  extracted_text text,
  extracted_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,

  constraint product_documents_mime_allowed check (
    mime_type in (
      'application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp'
    )
  )
);

create index product_documents_product_idx on product_documents(product_id) where deleted_at is null;
create index product_documents_owner_idx on product_documents(owner_id) where deleted_at is null;
-- Duplicate detection is scoped per owner: two users uploading the same manual is
-- not a duplicate, the same user uploading the same receipt twice is.
create index product_documents_hash_idx on product_documents(owner_id, content_hash)
  where content_hash is not null and deleted_at is null;

create trigger product_documents_set_updated_at
  before update on product_documents
  for each row execute function set_updated_at();

-- --------------------------------------------------------------------------
-- Derived warranty status
--
-- Computed in SQL as well as in TypeScript because the reminder scheduler runs
-- server-side and must agree with the app exactly. `src/domain/warranty.ts` is the
-- mirror of this logic; both are covered by tests.
-- --------------------------------------------------------------------------

create or replace function product_warranty_end(p products)
returns date
language sql
immutable
as $$
  select coalesce(
    p.warranty_end,
    case
      when p.warranty_duration_months is not null
      then (coalesce(p.warranty_start, p.purchase_date)
            + make_interval(months => p.warranty_duration_months + p.extension_months))::date
    end
  );
$$;

create or replace function product_warranty_status(p products, as_of date, ending_soon_days int default 30)
returns warranty_status
language sql
immutable
as $$
  select case
    when product_warranty_end(p) is null then 'unknown'::warranty_status
    when product_warranty_end(p) < as_of then 'expired'::warranty_status
    when product_warranty_end(p) - as_of <= ending_soon_days then 'ending_soon'::warranty_status
    else 'active'::warranty_status
  end;
$$;

-- Convenience view for list screens. Security invoker so the caller's RLS applies.
create view product_warranty_overview
with (security_invoker = true)
as
select
  p.id,
  p.owner_id,
  p.workspace_id,
  p.name,
  p.model,
  p.brand_id,
  coalesce(b.name, p.brand_name) as brand_display_name,
  p.category_id,
  c.slug as category_slug,
  p.purchase_date,
  p.image_path,
  p.lifecycle,
  p.warranty_source,
  p.warranty_verified_by_user,
  product_warranty_end(p) as effective_warranty_end,
  product_warranty_status(p, current_date) as status,
  (product_warranty_end(p) - current_date) as days_remaining,
  p.created_at,
  p.updated_at
from products p
left join organisations b on b.id = p.brand_id
left join product_categories c on c.id = p.category_id
where p.deleted_at is null;
