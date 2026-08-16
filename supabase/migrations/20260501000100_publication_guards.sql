-- ---------------------------------------------------------------------------
-- Publication guards
--
-- The previous migration added `publication_status` with a default of
-- 'published', so that adding the column changed nothing about rows that
-- already existed. That default is right exactly once — during the backfill.
-- Left in place it means every *new* row is born live, including whatever an
-- extractor writes, which is the failure the whole review workflow exists to
-- prevent.
--
-- This migration flips the default forward, makes promotion a reviewer's act at
-- the database level rather than a convention in the console, and stops the
-- resolver reading anything that is not published production data.
-- ---------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- 1. New rows start as candidates
--
-- Only the default changes. Existing rows keep the status they were backfilled
-- with, so nothing live goes dark.
-- --------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'warranties', 'warranty_terms', 'warranty_sources',
    'provider_contact_methods', 'service_locations', 'service_capabilities',
    'organisations'
  ] loop
    execute format('alter table %I alter column publication_status set default ''candidate''', t);
  end loop;
end;
$$;

-- --------------------------------------------------------------------------
-- 2. Promotion is a reviewer's act
--
-- RLS already says a viewer may not write. It does not say that a data editor
-- may not write the word 'published', and without this trigger the workflow is
-- enforced only by which buttons the console renders — which is not
-- enforcement.
--
-- Applies to requests arriving as a signed-in user. The service role is inside
-- the trust boundary by construction: it is how migrations, seeds and Edge
-- Functions write, and what those write is governed by review of their code,
-- not by a policy they could bypass anyway.
-- --------------------------------------------------------------------------

create or replace function enforce_publication_promotion()
returns trigger
language plpgsql
-- Deliberately *not* `security definer`: that would rewrite `current_user` to
-- the function's owner and the role check below would never see the caller.
-- `is_admin()` is the security definer, and it is the only part that needs to be.
security invoker
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if new.publication_status in ('verified', 'published')
     and (tg_op = 'INSERT' or old.publication_status is distinct from new.publication_status)
     and not is_admin('reviewer') then
    raise exception
      'only a reviewer may mark data as % (table %)', new.publication_status, tg_table_name
      using errcode = 'insufficient_privilege';
  end if;

  -- A row promoted without a reviewer recorded is a row with no accountable
  -- person behind it, which defeats the point of the audit trail.
  if new.publication_status in ('verified', 'published')
     and (tg_op = 'INSERT' or old.publication_status is distinct from new.publication_status) then
    new.reviewed_by := coalesce(new.reviewed_by, auth.uid());
    new.reviewed_at := coalesce(new.reviewed_at, now());
  end if;

  return new;
end;
$$;

comment on function enforce_publication_promotion() is
  'Candidate to verified to published is a workflow, not a suggestion. Machines may propose; only a reviewer may promote.';

do $$
declare t text;
begin
  foreach t in array array[
    'warranties', 'warranty_terms', 'warranty_sources',
    'provider_contact_methods', 'service_locations', 'service_capabilities',
    'organisations', 'organisation_relationships'
  ] loop
    execute format(
      'create trigger %I before insert or update on %I
         for each row execute function enforce_publication_promotion()',
      t || '_publication_guard', t);
  end loop;
end;
$$;

-- --------------------------------------------------------------------------
-- 3. What the resolver may read
--
-- Demo fixtures are excluded structurally rather than by naming convention.
-- A development database that wants them can opt in for itself:
--
--   alter database postgres set app.include_demo_data = 'on';
--
-- Unset — which is every production deployment, because it takes a deliberate
-- statement to set it — the resolver sees production data only.
-- --------------------------------------------------------------------------

create or replace function visible_environments()
returns data_environment[]
language sql
stable
set search_path = public
as $$
  select case
    when coalesce(current_setting('app.include_demo_data', true), 'off') = 'on'
      then array['production', 'demo']::data_environment[]
      else array['production']::data_environment[]
  end;
$$;

comment on function visible_environments() is
  'Which data environments this database serves. Production only unless a developer opts in.';

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
    -- New in this migration: an unreviewed extraction and a demo fixture are
    -- both ineligible, whatever else they match on.
    w.publication_status = 'published'
    and w.data_environment = any (visible_environments())
    -- Brand must match when both sides state one. A policy with no brand is a
    -- category-wide rule and stays eligible.
    and (w.brand_id is null or p.brand_id is null or w.brand_id = p.brand_id)
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
  'Eligible policies for a product. Eligibility is exclusion-based, and only published production rows are eligible at all.';
