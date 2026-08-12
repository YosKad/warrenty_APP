-- ---------------------------------------------------------------------------
-- The warranty knowledge base
--
-- This is the part of MY Warranty that is not a CRUD app. It stores what warranties
-- actually *say*, per brand, per model family, per country — with provenance on
-- every record, because the product's whole credibility rests on being able to
-- answer "how do you know that?".
-- ---------------------------------------------------------------------------

-- Where a warranty record came from. Separated from the warranty itself so several
-- warranties extracted from one PDF share a single provenance row, and so a source
-- can be re-verified (updating last_verified_at) without touching the warranties.
create table warranty_sources (
  id              uuid primary key default gen_random_uuid(),
  kind            warranty_source_kind not null,
  organisation_id uuid references organisations(id) on delete set null,
  -- The page or document this was taken from. Shown to users as "where this came from".
  source_url      text,
  document_title  text,
  -- Version/edition of the source document, so historic analyses stay explainable.
  document_version text,
  -- sha256 of the fetched document; lets us detect that a manufacturer changed terms.
  content_hash    text,
  country_code    char(2),
  language        text not null default 'en',
  retrieved_at    timestamptz,
  last_verified_at timestamptz,
  verified_by     uuid references user_profiles(id) on delete set null,
  verification    verification_state not null default 'unverified',
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index warranty_sources_org_idx on warranty_sources(organisation_id);
create index warranty_sources_hash_idx on warranty_sources(content_hash);

create trigger warranty_sources_set_updated_at
  before update on warranty_sources
  for each row execute function set_updated_at();

-- --------------------------------------------------------------------------
-- Warranty policies
--
-- A policy is scoped by brand + optional model pattern + optional category +
-- country. Resolution walks from most specific to least, so "Samsung QN90D in IL"
-- beats "Samsung TVs in IL" beats "Samsung TVs globally".
-- --------------------------------------------------------------------------

create table warranties (
  id                uuid primary key default gen_random_uuid(),
  brand_id          uuid references organisations(id) on delete cascade,
  category_id       uuid references product_categories(id) on delete set null,
  -- SQL LIKE pattern matched against a product's model, e.g. 'QN90D%'.
  model_pattern     text,
  country_code      char(2),
  duration_months   int check (duration_months between 1 and 600),
  -- Some categories warrant parts and labour differently.
  parts_months      int,
  labour_months     int,
  coverage_summary  text,
  exclusions_summary text,
  -- Who actually honours the claim in this country. Often the importer, not the brand.
  warranty_provider_id uuid references organisations(id) on delete set null,
  source_id         uuid references warranty_sources(id) on delete set null,
  -- The window during which this policy applied. A product bought in 2024 must be
  -- judged by the 2024 terms, not by whatever the manufacturer publishes today.
  valid_from        date,
  valid_to          date,
  verified_at       timestamptz,
  verification      verification_state not null default 'unverified',
  confidence        confidence_level not null default 'low',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint warranties_country_upper check (
    country_code is null or country_code = upper(country_code)
  ),
  constraint warranties_valid_range check (
    valid_from is null or valid_to is null or valid_to >= valid_from
  )
);

create index warranties_lookup_idx on warranties(brand_id, country_code, category_id);
create index warranties_model_pattern_idx on warranties(model_pattern);

create trigger warranties_set_updated_at
  before update on warranties
  for each row execute function set_updated_at();

comment on table warranties is
  'Structured warranty policies. Never populated by an LLM without a human or document behind it — see the verification column and AI.md.';

-- --------------------------------------------------------------------------
-- Warranty clauses
--
-- Individual clauses, chunked and embedded. This is the retrieval corpus for
-- coverage analysis: we search clauses, not documents, so only a few hundred tokens
-- of genuinely relevant text ever reach a model.
-- --------------------------------------------------------------------------

create table warranty_terms (
  id                uuid primary key default gen_random_uuid(),
  warranty_id       uuid not null references warranties(id) on delete cascade,
  section           text,
  ordinal           int not null default 0,
  clause_text       text not null,
  -- 'coverage' | 'exclusion' | 'condition' | 'procedure' | 'duration' | 'other'
  clause_type       text not null default 'other',
  -- Free-form tags for filtering before vector search, e.g. 'display', 'battery'.
  coverage_categories text[] not null default '{}',
  language          text not null default 'en',
  -- 1536 dims matches the small embedding models we start with; changing dimension
  -- requires a rebuild, which is tracked in AI.md.
  embedding         vector(1536),
  created_at        timestamptz not null default now(),

  constraint warranty_terms_type_known check (
    clause_type in ('coverage', 'exclusion', 'condition', 'procedure', 'duration', 'other')
  )
);

create index warranty_terms_warranty_idx on warranty_terms(warranty_id);
create index warranty_terms_categories_idx on warranty_terms using gin (coverage_categories);

-- IVFFlat needs the table populated before the list count is meaningful; this is
-- rebuilt by a maintenance job as the corpus grows (see AI.md).
create index warranty_terms_embedding_idx
  on warranty_terms using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- --------------------------------------------------------------------------
-- Warranty resolution
--
-- Picks the best policy for a product. Specificity beats recency: an exact model
-- match for the right country always wins over a generic brand-wide rule.
-- --------------------------------------------------------------------------

create or replace function resolve_warranty_policy(
  p_brand_id uuid,
  p_category_id uuid,
  p_model text,
  p_country_code char(2),
  p_purchase_date date
)
returns setof warranties
language sql
stable
as $$
  select w.*
  from warranties w
  where (p_brand_id is null or w.brand_id is null or w.brand_id = p_brand_id)
    and (w.category_id is null or w.category_id = p_category_id)
    and (w.country_code is null or w.country_code = p_country_code)
    and (
      w.model_pattern is null
      or (p_model is not null and p_model ilike w.model_pattern)
    )
    -- Honour the terms that were in force when the product was bought.
    and (w.valid_from is null or p_purchase_date is null or w.valid_from <= p_purchase_date)
    and (w.valid_to is null or p_purchase_date is null or w.valid_to >= p_purchase_date)
  order by
    (w.model_pattern is not null and p_model is not null) desc,
    (w.country_code is not null) desc,
    (w.category_id is not null) desc,
    case w.verification
      when 'official' then 0
      when 'verified' then 1
      when 'community_submitted' then 2
      when 'ai_extracted' then 3
      else 4
    end,
    case w.confidence when 'high' then 0 when 'medium' then 1 else 2 end,
    w.verified_at desc nulls last
  limit 5;
$$;

comment on function resolve_warranty_policy is
  'Returns up to 5 candidate policies, most specific and best-verified first. Callers take the first row and surface its source to the user.';
