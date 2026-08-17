-- ---------------------------------------------------------------------------
-- Reading the model corpus
--
-- Three small functions rather than one large one, because they answer three
-- different questions and the console asks them at different moments:
--
--   probe_models              what products do we know for this brand?
--   probe_policies_for_model  what terms are attached to one of them?
--   resolve_receipt_names     who are the companies this receipt mentions?
--
-- None of them decides anything. Matching a string to a model is
-- `resolveModel` in `@mw/domain`, and keeping the decision in one language is
-- what stops the console, the app and the tester disagreeing about which
-- television somebody owns.
-- ---------------------------------------------------------------------------

/**
 * Every canonical model a brand has, with its approved spellings.
 *
 * The alias rows carry their own publication state and it is *not* filtered
 * here: an admin needs to see proposals in the Model Resolver, and the domain
 * decides which ones may resolve. Filtering them out of the payload would make
 * "there is a candidate alias waiting for you" invisible at exactly the moment
 * it is useful.
 */
create or replace function probe_models(
  p_brand_name   text default null,
  p_country_code char(2) default null,
  p_category_id  uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with brand as (
    select id, name from organisations
     where p_brand_name is not null
       and org_name_key(name) = org_name_key(p_brand_name)
       and publication_status = 'published'
       and data_environment = any (visible_environments())
     limit 1
  ),
  models as (
    select m.*
      from product_models m
      left join brand b on true
     where m.data_environment = any (visible_environments())
       and (m.publication_status = 'published' or is_admin())
       and (p_brand_name is null or m.manufacturer_id = b.id)
       and (p_category_id is null or m.category_id is null or m.category_id = p_category_id)
       and (p_country_code is null or m.country_code is null or m.country_code = p_country_code)
     limit 500
  )
  select jsonb_build_object(
    'brand', (select jsonb_build_object('id', id, 'name', name) from brand),
    'models', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',               m.id,
        'canonicalModel',   m.canonical_model,
        'manufacturerName', o.name,
        'family',           m.family,
        'variant',          m.variant,
        'regionalModel',    m.regional_model,
        'categoryId',       m.category_id,
        'publicationStatus', m.publication_status,
        'verification',     m.verification,
        'aliases', coalesce((
          select jsonb_agg(jsonb_build_object(
            'value',             a.value,
            'kind',              a.kind,
            'verification',      a.verification,
            'publicationStatus', a.publication_status,
            'sourceId',          a.source_id
          ) order by a.value)
          from model_aliases a
         where a.model_id = m.id
           and a.data_environment = any (visible_environments())
        ), '[]'::jsonb)
      ) order by m.canonical_model)
      from models m
      left join organisations o on o.id = m.manufacturer_id
    ), '[]'::jsonb),
    -- The pre-existing mechanism, offered to the matcher as stage E.
    'patterns', coalesce((
      select jsonb_agg(jsonb_build_object('warrantyId', w.id, 'pattern', w.model_pattern))
        from warranties w
        left join brand b on true
       where w.model_pattern is not null
         and w.publication_status = 'published'
         and w.data_environment = any (visible_environments())
         and (p_brand_name is null or w.brand_id = b.id)
         and (p_country_code is null or w.country_code is null or w.country_code = p_country_code)
    ), '[]'::jsonb)
  );
$$;

comment on function probe_models(text, char, uuid) is
  'The model corpus for one brand. Matching happens in @mw/domain; this only supplies what to match against.';

/**
 * The policies attached to a resolved model, with the provider facts for each.
 *
 * Same shape as `probe_resolution` returns, so the tester can evaluate either
 * path with one code path. `model_id` is the precise link; a policy that has
 * none but whose pattern covers the model is included too, because the corpus
 * will contain both for a long time.
 */
create or replace function probe_policies_for_model(
  p_model_id      uuid,
  p_country_code  char(2) default 'IL',
  p_purchase_date date default null,
  p_importer_id   uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_brand    uuid;
  v_model    text;
  v_result   jsonb := '[]'::jsonb;
  v_providers jsonb := '{}'::jsonb;
  r record;
begin
  select manufacturer_id, canonical_model into v_brand, v_model
    from product_models where id = p_model_id;

  for r in
    select w.*, coalesce(s.kind::text, 'internal_db') as source_kind, p.name as provider_name
      from warranties w
      left join warranty_sources s on s.id = w.source_id
      left join organisations p on p.id = w.warranty_provider_id
     where w.publication_status = 'published'
       and w.data_environment = any (visible_environments())
       and (
         w.model_id = p_model_id
         or (w.model_id is null and w.model_pattern is null and w.brand_id = v_brand)
       )
       and (w.country_code is null or w.country_code = p_country_code)
       and (w.importer_id is null or p_importer_id is null or w.importer_id = p_importer_id)
       and (w.valid_from is null or p_purchase_date is null or w.valid_from <= p_purchase_date)
       and (w.valid_to is null or p_purchase_date is null or w.valid_to >= p_purchase_date)
     limit 8
  loop
    v_result := v_result || jsonb_build_array(jsonb_build_object(
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
      'modelId',        r.model_id,
      'signals', jsonb_strip_nulls(jsonb_build_object(
        -- The model signal is set here because the caller already resolved it;
        -- everything else is a database fact.
        'model',          case when r.model_id = p_model_id then true else null end,
        'brand',          nullif(r.brand_id is not null and r.brand_id = v_brand, false),
        'country',        nullif(r.country_code is not null and r.country_code = p_country_code, false),
        'importer',       nullif(r.importer_id is not null and r.importer_id = p_importer_id, false),
        'validity',       nullif(
                            p_purchase_date is null
                            or ((r.valid_from is null or r.valid_from <= p_purchase_date)
                                and (r.valid_to is null or r.valid_to >= p_purchase_date)), false),
        'officialSource', nullif(r.verification in ('official', 'verified'), false)
      ))
    ));

    v_providers := v_providers || jsonb_build_object(
      r.id::text,
      provider_reachability(r.warranty_provider_id, v_brand, p_country_code)
    );
  end loop;

  return jsonb_build_object(
    'model', v_model,
    'candidates', v_result,
    'providers', v_providers
  );
end;
$$;

/**
 * The companies a receipt mentions.
 *
 * Aliases included, because "איי דיגיטל" on a Hebrew receipt and "iDigital" in
 * the corpus are the same company and only an alias row knows that. Which
 * organisation each name belongs to is decided in `@mw/domain` — this returns
 * candidates, not answers, so two companies with the same name come back as
 * two rows rather than as whichever one sorted first.
 */
create or replace function resolve_receipt_names(
  p_names        text[],
  p_country_code char(2) default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with keys as (
    select distinct org_name_key(name) as key from unnest(p_names) as name
     where name is not null and length(trim(name)) > 0
  )
  select coalesce(jsonb_agg(row) , '[]'::jsonb) from (
    select jsonb_build_object(
      'id',          o.id,
      'name',        o.name,
      'legalName',   o.legal_name,
      'countryCode', o.country_code,
      'roles',       to_jsonb(o.roles),
      'aliases', coalesce((
        select jsonb_agg(jsonb_build_object(
          'value',             a.value,
          'kind',              a.kind,
          'verification',      a.verification,
          'publicationStatus', a.publication_status
        ))
        from organisation_aliases a
       where a.organisation_id = o.id
         and a.data_environment = any (visible_environments())
      ), '[]'::jsonb)
    ) as row
    from organisations o
   where o.publication_status = 'published'
     and o.data_environment = any (visible_environments())
     and (p_country_code is null or o.country_code is null or o.country_code = p_country_code)
     and (
       org_name_key(o.name) in (select key from keys)
       or org_name_key(coalesce(o.legal_name, '')) in (select key from keys)
       or exists (
         select 1 from organisation_aliases a
          where a.organisation_id = o.id
            and a.publication_status = 'published'
            and a.data_environment = any (visible_environments())
            and org_name_key(a.value) in (select key from keys)
       )
     )
   limit 50
  ) matches;
$$;

comment on function resolve_receipt_names(text[], char) is
  'Candidate organisations for the names on a receipt. Two companies with one name come back as two rows.';
