-- ---------------------------------------------------------------------------
-- Phase G — Warranty Intelligence
--
-- Everything here is additive. `warranty_terms.clause_text` keeps its meaning as
-- the verbatim text taken from the document and is never rewritten by anything in
-- this migration or by the extraction pipeline: a summary that replaces its own
-- source is a summary nobody can check.
--
-- The audit behind these choices is docs/V2_PHASE_G.md. Two tables are added,
-- three extended, and four proposed tables were dropped because `warranties`,
-- `warranty_terms` and `warranty_sources` already model them.
--
-- `resolve_warranty_policy()` is deliberately left alone. The add-product flow
-- and the warranty-lookup function both depend on its signature, so the richer
-- matching lands beside it as `match_warranty_policies()` rather than as a
-- redefinition.
-- ---------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- Clause structure
--
-- A clause needs to be three things at once: a citable piece of a real document,
-- a classified fact the UI can group, and a sentence a person can read. V1 had
-- only the first. These columns add the other two without disturbing it.
-- --------------------------------------------------------------------------

alter table warranty_terms
  -- A short label: "Display panel", "Impact damage". Not a paraphrase of the
  -- clause — a name for it, so a list of twelve clauses is scannable.
  add column title           text,
  -- One plain sentence. May be model-written; `clause_text` remains the source
  -- of truth and is what the user is shown when they tap "view source".
  add column summary         text,
  -- Where in the document. `section` already exists and holds the heading;
  -- these narrow it to something a user can find on the page.
  add column source_section  text,
  add column source_page     int check (source_page is null or source_page > 0),
  add column confidence      confidence_level not null default 'low',
  add column verification    verification_state not null default 'unverified',
  -- Which extraction produced the derived fields, so a prompt change can
  -- invalidate exactly the clauses it affected rather than all of them.
  add column extraction_version text,
  add column extracted_by    text,
  add column extracted_at    timestamptz,
  add column created_by      uuid references user_profiles(id) on delete set null;

-- Three new types the phase brief calls for. `service_fee` in particular is the
-- difference between "covered" and "covered, but the technician visit is 250".
alter table warranty_terms drop constraint warranty_terms_type_known;
alter table warranty_terms add constraint warranty_terms_type_known check (
  clause_type in (
    'coverage', 'exclusion', 'condition', 'procedure', 'duration', 'other',
    'service_fee', 'claim_requirement', 'geographic_restriction'
  )
);

create index warranty_terms_type_idx on warranty_terms(warranty_id, clause_type);

comment on column warranty_terms.clause_text is
  'Verbatim from the source document. Never rewritten. This is what "view source" shows.';
comment on column warranty_terms.summary is
  'Plain-language restatement, possibly model-written. Never authoritative on its own — see extraction_version and confidence.';

-- --------------------------------------------------------------------------
-- Policy matching inputs
--
-- Matching on brand alone is how an app ends up telling someone their imported
-- television carries the manufacturer's US terms. These columns let a policy say
-- who it actually applies to.
-- --------------------------------------------------------------------------

alter table warranties
  -- A policy honoured by a specific importer, or sold through a specific
  -- retailer, applies only to products bought that way.
  add column importer_id      uuid references organisations(id) on delete set null,
  add column retailer_id      uuid references organisations(id) on delete set null,
  -- SQL LIKE patterns against the serial, for recall-style production ranges.
  add column serial_patterns  text[] not null default '{}',
  -- The publisher's own version string, kept so an analysis stays explainable
  -- after the manufacturer reissues the document.
  add column policy_version   text,
  add column last_checked_at  timestamptz,
  add column special_conditions_summary text;

create index warranties_importer_idx on warranties(importer_id) where importer_id is not null;

-- A user-uploaded warranty PDF is a source like any other, and treating it as
-- one is what lets the same UI cite it.
alter table warranty_sources
  add column document_id   uuid references product_documents(id) on delete set null,
  add column effective_from date,
  add column effective_to   date,
  add column page_count    int check (page_count is null or page_count > 0);

create index warranty_sources_document_idx on warranty_sources(document_id)
  where document_id is not null;

-- The importer is the fifth role in the chain and the one most often confused
-- with the manufacturer. It was in the org_role enum but had nowhere to live on
-- a product.
alter table products
  add column importer_id uuid references organisations(id) on delete set null;

create index products_importer_idx on products(importer_id)
  where importer_id is not null and deleted_at is null;

-- --------------------------------------------------------------------------
-- The resolved match
--
-- One row per product. Holds which policy applies, the signals that led there,
-- and when it was worked out — so Product Detail does not re-resolve (or worse,
-- re-extract) on every open, and so a stale match is visible as stale rather
-- than silently trusted.
-- --------------------------------------------------------------------------

create table product_warranty_matches (
  id                uuid primary key default gen_random_uuid(),
  product_id        uuid not null references products(id) on delete cascade,
  owner_id          uuid not null references user_profiles(id) on delete cascade,
  warranty_id       uuid references warranties(id) on delete set null,

  -- Deterministic, 0-100, computed from the signals below by
  -- src/domain/warrantyIntelligence.ts. Never a model's opinion of itself.
  match_score       int not null default 0 check (match_score between 0 and 100),
  -- 'verified' | 'strong' | 'needs_confirmation' | 'unknown'. Text rather than an
  -- enum because the band thresholds are product policy and will move.
  match_state       text not null default 'unknown' check (
    match_state in ('verified', 'strong', 'needs_confirmation', 'unknown')
  ),
  -- Which signals fired: {"model": true, "country": true, "importer": false, ...}
  signals           jsonb not null default '{}'::jsonb,

  -- Set when two candidate policies disagree about something the user would
  -- notice — a duration, a provider. The app shows the disagreement and asks;
  -- it never picks one and presents it as settled.
  has_conflict      boolean not null default false,
  conflict_summary  jsonb not null default '[]'::jsonb,
  /* Candidate policy ids considered, best first. Kept so "why did it pick that?"
     is answerable months later. */
  candidate_ids     uuid[] not null default '{}',

  -- Freshness. `resolved_at` is when we last ran matching; `source_checked_at` is
  -- when the underlying document was last confirmed to be current.
  resolved_at       timestamptz not null default now(),
  source_checked_at timestamptz,
  -- Bumped when the matching algorithm changes, which invalidates every row
  -- without needing to know which products were affected.
  resolver_version  text not null default 'g1',

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint product_warranty_matches_one_per_product unique (product_id)
);

create index product_warranty_matches_owner_idx on product_warranty_matches(owner_id);
create index product_warranty_matches_stale_idx on product_warranty_matches(resolved_at);

create trigger product_warranty_matches_set_updated_at
  before update on product_warranty_matches
  for each row execute function set_updated_at();

-- --------------------------------------------------------------------------
-- User corrections
--
-- A user who knows their importer is right even when our official-looking record
-- says otherwise. Their correction is stored beside the matched value rather than
-- on top of it, and is labelled as user-provided — so nothing that was verified
-- can be silently downgraded to a guess, and nothing a user entered can be
-- mistaken for verified data.
-- --------------------------------------------------------------------------

create table product_warranty_overrides (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references products(id) on delete cascade,
  owner_id     uuid not null references user_profiles(id) on delete cascade,
  field        text not null check (field in (
    'importer', 'warranty_provider', 'service_provider', 'retailer',
    'duration_months', 'warranty_end', 'policy'
  )),
  -- The user's value. Typed loosely on purpose: an organisation id for a
  -- provider, an integer for a duration, a date for an end date.
  value        jsonb not null,
  -- What we had before they changed it, so the correction is reversible and the
  -- disagreement is inspectable.
  previous_value jsonb,
  reason       text check (reason is null or length(reason) <= 500),
  created_at   timestamptz not null default now(),

  constraint product_warranty_overrides_one_per_field unique (product_id, field)
);

create index product_warranty_overrides_product_idx on product_warranty_overrides(product_id);

comment on table product_warranty_overrides is
  'User corrections, kept separate from matched data. An override always reads as user-provided, never as verified.';

-- --------------------------------------------------------------------------
-- Richer policy matching
--
-- Returns candidates with the signals that fired, and leaves the scoring to
-- src/domain/warrantyIntelligence.ts so the weights are unit-testable and the
-- same in both languages. SQL decides *which* policies are eligible; TypeScript
-- decides how sure we are.
--
-- Eligibility is strict about the one thing that must never be guessed: if a
-- policy names a country, an importer or a retailer, the product has to match it.
-- A policy that names none of those is generic and stays eligible.
-- --------------------------------------------------------------------------

create or replace function match_warranty_policies(p_product_id uuid)
returns table (
  warranty_id      uuid,
  duration_months  int,
  verification     verification_state,
  confidence       confidence_level,
  source_kind      warranty_source_kind,
  provider_id      uuid,
  policy_version   text,
  valid_from       date,
  valid_to         date,
  matched_brand    boolean,
  matched_model    boolean,
  matched_category boolean,
  matched_country  boolean,
  matched_importer boolean,
  matched_retailer boolean,
  matched_serial   boolean,
  within_validity  boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with p as (
    select * from products where id = p_product_id and deleted_at is null
  )
  select
    w.id,
    w.duration_months,
    w.verification,
    w.confidence,
    coalesce(s.kind, 'internal_db'::warranty_source_kind),
    w.warranty_provider_id,
    w.policy_version,
    w.valid_from,
    w.valid_to,
    (w.brand_id is not null and w.brand_id = p.brand_id),
    (w.model_pattern is not null and p.model is not null and p.model ilike w.model_pattern),
    (w.category_id is not null and w.category_id = p.category_id),
    (w.country_code is not null and w.country_code = p.country_code),
    (w.importer_id is not null and w.importer_id = p.importer_id),
    (w.retailer_id is not null and w.retailer_id = p.retailer_id),
    (
      cardinality(w.serial_patterns) > 0
      and p.serial_number is not null
      and exists (
        select 1 from unnest(w.serial_patterns) as pattern
        where p.serial_number ilike pattern
      )
    ),
    (
      p.purchase_date is null
      or ((w.valid_from is null or w.valid_from <= p.purchase_date)
          and (w.valid_to is null or w.valid_to >= p.purchase_date))
    )
  from p
  cross join warranties w
  left join warranty_sources s on s.id = w.source_id
  where
    -- Brand must match when both sides state one. A policy with no brand is a
    -- category-wide rule and stays eligible.
    (w.brand_id is null or p.brand_id is null or w.brand_id = p.brand_id)
    and (w.category_id is null or w.category_id = p.category_id)
    -- Country, importer and retailer are exclusions, not preferences: a policy
    -- that names one and does not match is the wrong policy, not a weak match.
    and (w.country_code is null or w.country_code = p.country_code)
    and (w.importer_id is null or w.importer_id = p.importer_id)
    and (w.retailer_id is null or w.retailer_id = p.retailer_id)
    and (
      w.model_pattern is null
      or (p.model is not null and p.model ilike w.model_pattern)
    )
    -- Honour the terms in force at purchase. A policy published after the
    -- product was bought is never the applicable one.
    and (w.valid_from is null or p.purchase_date is null or w.valid_from <= p.purchase_date)
    and (w.valid_to is null or p.purchase_date is null or w.valid_to >= p.purchase_date)
  order by
    (w.model_pattern is not null) desc,
    (w.importer_id is not null) desc,
    (w.country_code is not null) desc,
    case w.verification
      when 'official' then 0 when 'verified' then 1
      when 'community_submitted' then 2 when 'ai_extracted' then 3 else 4
    end,
    case w.confidence when 'high' then 0 when 'medium' then 1 else 2 end,
    w.verified_at desc nulls last
  limit 8;
$$;

comment on function match_warranty_policies(uuid) is
  'Eligible policies for a product with the match signals that fired. Scoring lives in src/domain/warrantyIntelligence.ts.';

-- --------------------------------------------------------------------------
-- Grouped clauses for the "What''s covered" screen
--
-- One round trip instead of four, and it never selects `embedding` — vectors
-- have no client use and shipping them is pure waste.
-- --------------------------------------------------------------------------

create or replace function get_warranty_clauses(p_warranty_id uuid)
returns table (
  id             uuid,
  clause_type    text,
  title          text,
  summary        text,
  clause_text    text,
  section        text,
  source_section text,
  source_page    int,
  coverage_categories text[],
  confidence     confidence_level,
  verification   verification_state,
  ordinal        int
)
language sql
stable
security invoker
set search_path = public
as $$
  select t.id, t.clause_type, t.title, t.summary, t.clause_text, t.section,
         t.source_section, t.source_page, t.coverage_categories,
         t.confidence, t.verification, t.ordinal
  from warranty_terms t
  where t.warranty_id = p_warranty_id
  order by
    case t.clause_type
      when 'coverage' then 0
      when 'exclusion' then 1
      when 'duration' then 2
      when 'service_fee' then 3
      when 'condition' then 4
      when 'claim_requirement' then 5
      when 'geographic_restriction' then 6
      else 7
    end,
    t.ordinal;
$$;

-- --------------------------------------------------------------------------
-- Row Level Security
-- --------------------------------------------------------------------------

alter table product_warranty_matches enable row level security;

create policy warranty_matches_select_own on product_warranty_matches
  for select using (owner_id = auth.uid());

-- The client may ask for a re-resolve, but the match itself is written by the
-- resolver. A user who could write their own match could make the app assert a
-- warranty that does not exist — to themselves, which is the whole product.
-- service_role bypasses RLS, so the Edge Function still writes it.

alter table product_warranty_overrides enable row level security;

create policy warranty_overrides_select_own on product_warranty_overrides
  for select using (owner_id = auth.uid());

create policy warranty_overrides_insert_own on product_warranty_overrides
  for insert with check (
    owner_id = auth.uid()
    and exists (
      select 1 from products p
      where p.id = product_id and p.owner_id = auth.uid() and p.deleted_at is null
    )
  );

create policy warranty_overrides_update_own on product_warranty_overrides
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy warranty_overrides_delete_own on product_warranty_overrides
  for delete using (owner_id = auth.uid());

-- Column-level hardening: an override records what the user said and what we had
-- before. Rewriting the "before" would erase the disagreement it exists to show.
revoke update (owner_id, product_id, field, previous_value, created_at)
  on product_warranty_overrides from authenticated;
