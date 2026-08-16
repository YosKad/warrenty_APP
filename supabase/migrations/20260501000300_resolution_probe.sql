-- ---------------------------------------------------------------------------
-- The resolution probe
--
-- Answers the resolver's question for a product that does not exist: "if
-- somebody scanned a receipt for this, what would we be able to tell them?"
--
-- It reads the same published production corpus the app reads and applies the
-- same eligibility rules. The scoring and the verdict stay in `@mw/domain`, so
-- the tester measures the resolver rather than a second implementation of it
-- that might be kinder to itself. That split is why this function returns
-- provider facts *per candidate policy* rather than for a leader it picked:
-- which policy leads is a scoring question, and scoring does not live here.
-- ---------------------------------------------------------------------------

/**
 * A comparison key for an organisation name.
 *
 * Deliberately cruder than the TypeScript `normaliseName` — it folds case,
 * punctuation and the Hebrew geresh/gershayim, and stops there. It exists so a
 * test case typed as "Samsung Electronics Israel Ltd." finds the row stored as
 * "Samsung Electronics Israel", not to be a general-purpose matcher.
 */
create or replace function org_name_key(p_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select trim(regexp_replace(
    regexp_replace(
      regexp_replace(lower(coalesce(p_name, '')), '[׳״''"`]', '', 'g'),
      '\s+(ltd|limited|inc|llc|gmbh|בעמ)\.?$', '', 'g'),
    '[^[:alnum:][:space:]֐-׿]', ' ', 'g'));
$$;

create index if not exists organisations_name_key_idx on organisations (org_name_key(name));

/**
 * Everything the service chain can tell us about one company.
 *
 * Split out so the probe can answer it for each candidate policy's provider
 * without repeating the query, and so the answer is testable on its own.
 */
create or replace function provider_reachability(
  p_provider_id  uuid,
  p_brand_id     uuid,
  p_country_code char(2)
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_servicer uuid;
  v_contacts int := 0;
  v_verified timestamptz;
  v_option   boolean := false;
begin
  if p_provider_id is null then
    return jsonb_build_object(
      'warrantyProviderKnown', false,
      'serviceProviderKnown', false,
      'serviceOptionKnown', false,
      'actionableContactCount', 0,
      'contactVerifiedAt', null
    );
  end if;

  select r.subject_id into v_servicer
    from organisation_relationships r
   where r.object_id = p_brand_id
     and r.kind in ('services_for', 'authorized_service_for')
     and r.publication_status = 'published'
     and r.data_environment = any (visible_environments())
     and (r.country_code is null or r.country_code = p_country_code)
   limit 1;

  -- A warranty provider who also repairs is the ordinary case in this market.
  -- Falling back to them is not a guess; it is what the roles on the record say.
  if v_servicer is null and exists (
    select 1 from organisations o
     where o.id = p_provider_id and 'service_provider' = any (o.roles)
  ) then
    v_servicer := p_provider_id;
  end if;

  -- Phase H's own mechanism: a repair network scopes each branch to the brands
  -- it handles. The probe has to read that too, or it reports the corpus as
  -- worse than the app actually finds it.
  if v_servicer is null then
    select loc.organisation_id into v_servicer
      from service_locations loc
     where p_brand_id = any (loc.serviced_brand_ids)
       and loc.publication_status = 'published'
       and loc.data_environment = any (visible_environments())
       and loc.closed_at is null
       and (loc.country_code is null or loc.country_code = p_country_code)
     limit 1;
  end if;

  select count(*), max(c.verified_at)
    into v_contacts, v_verified
    from provider_contact_methods c
   where c.organisation_id in (p_provider_id, v_servicer)
     and c.publication_status = 'published'
     and c.data_environment = any (visible_environments())
     and c.is_active
     -- Actionable means the user can act on it directly. An address is a fact
     -- about a company, not a way of reaching it.
     and c.kind in ('phone', 'whatsapp', 'email', 'web_form', 'chat');

  if v_servicer is not null then
    select exists (
      select 1 from service_capabilities cap
       where cap.organisation_id = v_servicer
         and cap.publication_status = 'published'
         and cap.data_environment = any (visible_environments())
         and cap.availability = 'available'
      union all
      select 1 from service_locations loc
       where loc.organisation_id = v_servicer
         and loc.publication_status = 'published'
         and loc.data_environment = any (visible_environments())
         and loc.closed_at is null
         and (cardinality(loc.serviced_brand_ids) = 0 or p_brand_id = any (loc.serviced_brand_ids))
    ) into v_option;
  end if;

  return jsonb_build_object(
    'warrantyProviderKnown', true,
    'serviceProviderKnown', v_servicer is not null,
    'serviceOptionKnown', v_option,
    'actionableContactCount', v_contacts,
    'contactVerifiedAt', v_verified
  );
end;
$$;

create or replace function probe_resolution(
  p_brand_name    text,
  p_model         text default null,
  p_category_id   uuid default null,
  p_country_code  char(2) default 'IL',
  p_purchase_date date default null,
  p_importer_name text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_brand      uuid;
  v_importer   uuid;
  v_candidates jsonb := '[]'::jsonb;
  v_providers  jsonb := '{}'::jsonb;
  v_model_seen boolean := false;
  v_rel_importer uuid;
  v_policy_importer uuid;
  r record;
begin
  -- A brand nobody has published is a brand the app cannot show. Requiring the
  -- same publication state here is what keeps the tester's answer equal to the
  -- app's rather than flattering.
  select id into v_brand
    from organisations
   where org_name_key(name) = org_name_key(p_brand_name)
     and publication_status = 'published'
     and data_environment = any (visible_environments())
   limit 1;

  if p_importer_name is not null then
    select id into v_importer
      from organisations
     where org_name_key(name) = org_name_key(p_importer_name)
       and publication_status = 'published'
       and data_environment = any (visible_environments())
     limit 1;
  end if;

  -- Does any published policy know this model at all? Distinct from whether one
  -- applies: "we have never heard of this model" and "we know the model and have
  -- no terms for it" are different failures with different fixes.
  select exists (
    select 1 from warranties w
     where w.publication_status = 'published'
       and w.data_environment = any (visible_environments())
       and w.model_pattern is not null
       and p_model is not null
       and p_model ilike w.model_pattern
  ) into v_model_seen;

  for r in
    select w.id,
           w.duration_months,
           w.warranty_provider_id,
           w.importer_id,
           w.policy_version,
           w.country_code,
           w.valid_from,
           w.valid_to,
           w.verification,
           w.confidence,
           w.model_pattern,
           w.brand_id,
           w.category_id,
           coalesce(s.kind::text, 'internal_db') as source_kind,
           p.name as provider_name
      from warranties w
      left join warranty_sources s on s.id = w.source_id
      left join organisations p on p.id = w.warranty_provider_id
     where w.publication_status = 'published'
       and w.data_environment = any (visible_environments())
       -- Same exclusion rules as the live resolver. A policy that names a
       -- country or an importer and does not match is the wrong policy, not a
       -- weak match.
       and (w.brand_id is null or v_brand is null or w.brand_id = v_brand)
       and (w.category_id is null or p_category_id is null or w.category_id = p_category_id)
       and (w.country_code is null or w.country_code = p_country_code)
       and (w.importer_id is null or v_importer is null or w.importer_id = v_importer)
       and (w.model_pattern is null or (p_model is not null and p_model ilike w.model_pattern))
       and (w.valid_from is null or p_purchase_date is null or w.valid_from <= p_purchase_date)
       and (w.valid_to is null or p_purchase_date is null or w.valid_to >= p_purchase_date)
     limit 8
  loop
    v_candidates := v_candidates || jsonb_build_array(jsonb_build_object(
      'warrantyId',     r.id,
      'durationMonths', r.duration_months,
      'providerId',     r.warranty_provider_id,
      'providerName',   r.provider_name,
      'policyVersion',  r.policy_version,
      'source',         r.source_kind,
      'verification',   r.verification,
      'confidence',     r.confidence,
      'validFrom',      r.valid_from,
      'validTo',        r.valid_to,
      'countryCode',    r.country_code,
      'importerId',     r.importer_id,
      'signals', jsonb_strip_nulls(jsonb_build_object(
        'model',          nullif(r.model_pattern is not null and p_model is not null and p_model ilike r.model_pattern, false),
        'brand',          nullif(r.brand_id is not null and r.brand_id = v_brand, false),
        'country',        nullif(r.country_code is not null and r.country_code = p_country_code, false),
        'importer',       nullif(r.importer_id is not null and r.importer_id = v_importer, false),
        'validity',       nullif(
                            p_purchase_date is null
                            or ((r.valid_from is null or r.valid_from <= p_purchase_date)
                                and (r.valid_to is null or r.valid_to >= p_purchase_date)), false),
        'category',       nullif(r.category_id is not null and r.category_id = p_category_id, false),
        'officialSource', nullif(r.verification in ('official', 'verified'), false)
      ))
    ));

    v_providers := v_providers || jsonb_build_object(
      r.id::text,
      provider_reachability(r.warranty_provider_id, v_brand, p_country_code)
    );

    v_policy_importer := coalesce(v_policy_importer, r.importer_id);
  end loop;

  -- The importer question, asked of the relationship graph when the test case
  -- did not name one and no policy carries one.
  select r2.subject_id into v_rel_importer
    from organisation_relationships r2
   where r2.object_id = v_brand
     and r2.kind = 'imports_for'
     and r2.publication_status = 'published'
     and r2.data_environment = any (visible_environments())
     and (r2.country_code is null or r2.country_code = p_country_code)
     and (r2.effective_from is null or p_purchase_date is null or r2.effective_from <= p_purchase_date)
     and (r2.effective_to is null or p_purchase_date is null or r2.effective_to >= p_purchase_date)
   limit 1;

  return jsonb_build_object(
    'brandResolvedToOrganisation', v_brand is not null,
    'modelRecognised',             v_model_seen,
    'candidates',                  v_candidates,
    'providers',                   v_providers,
    'importerKnown',               coalesce(v_importer, v_rel_importer, v_policy_importer) is not null
  );
end;
$$;

comment on function probe_resolution(text, text, uuid, char, date, text) is
  'What the resolver would find for a hypothetical product. Published production rows only; scoring stays in @mw/domain.';
