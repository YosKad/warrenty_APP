-- ---------------------------------------------------------------------------
-- Model identity — behaviour tests
--
-- The corpus tables that let a receipt be recognised as a product. Matching
-- itself is `@mw/domain` and is tested there; what is tested here is that the
-- database hands the matcher the right things and refuses the wrong people.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/model_identity_test.sql
-- ---------------------------------------------------------------------------

begin;

set local app.include_demo_data = 'on';

create or replace function assert(p_condition boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_condition then
    raise notice 'ok   — %', p_label;
  else
    raise exception 'FAIL — %', p_label;
  end if;
end;
$$;

create or replace function permitted(p_user uuid, p_sql text)
returns boolean language plpgsql as $$
declare affected int;
begin
  begin
    perform set_config('request.jwt.claim.sub', p_user::text, true);
    execute 'set local role authenticated';
    execute p_sql;
    get diagnostics affected = row_count;
    execute 'reset role';
    return affected > 0;
  exception when others then
    execute 'reset role';
    return false;
  end;
end;
$$;

create or replace function visible_count(p_user uuid, p_sql text)
returns int language plpgsql as $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  execute 'set local role authenticated';
  execute p_sql into n;
  execute 'reset role';
  return n;
end;
$$;

do $$
declare
  v_user     uuid := '55555555-5555-5555-5555-555555555555';
  v_editor   uuid := '66666666-6666-6666-6666-666666666666';
  v_reviewer uuid := '77777777-7777-7777-7777-777777777777';
  v_apple    uuid;
  v_model    uuid;
  v_probe    jsonb;
  v_count    int;
  v_status   publication_status;
begin
  insert into auth.users (id, email) values
    (v_user, 'user@model.test'),
    (v_editor, 'editor@model.test'),
    (v_reviewer, 'reviewer@model.test');
  insert into admin_members (user_id, role) values
    (v_editor, 'data_editor'), (v_reviewer, 'reviewer');

  select id into v_apple from organisations where slug = 'apple';
  select id into v_model from product_models
   where id = 'd0000000-0000-4000-8000-000000000002';

  -- ---- the corpus the matcher needs ---------------------------------------
  v_probe := probe_models('Apple', 'IL');

  perform assert(jsonb_array_length(v_probe->'models') >= 1,
    'the probe returns the models a brand has');

  perform assert(
    exists (
      select 1
        from jsonb_array_elements(v_probe->'models') m,
             jsonb_array_elements(m->'aliases') a
       where a->>'value' = 'MBA M4'
    ),
    'the abbreviation an Apple receipt might carry comes back with the model');

  perform assert(
    (select m->>'canonicalModel'
       from jsonb_array_elements(v_probe->'models') m
      limit 1) = 'MacBook Air M4',
    'the canonical name is the one a reviewer chose');

  -- ---- policies reachable through the model, not through a pattern --------
  v_probe := probe_policies_for_model(v_model, 'IL', date '2025-01-20', null);
  perform assert(jsonb_array_length(v_probe->'candidates') >= 1,
    'a policy linked by model_id is reachable without any pattern at all');

  perform assert(
    (v_probe->'candidates'->0->'signals'->>'model')::boolean,
    'that policy reports the model signal as fired');

  -- ---- receipt names ------------------------------------------------------
  perform assert(
    exists (
      select 1 from jsonb_array_elements(resolve_receipt_names(array['איי דיגיטל'], 'IL')) o
       where o->>'name' = 'iDigital'
    ),
    'a Hebrew receipt name resolves through an organisation alias');

  perform assert(
    jsonb_array_length(resolve_receipt_names(array['Some Corner Shop'], 'IL')) = 0,
    'a shop nobody recorded returns nothing rather than a guess');

  -- ---- who may touch any of it -------------------------------------------
  perform assert(not permitted(v_user,
    format('update product_models set canonical_model = ''Hijacked'' where id = %L', v_model)),
    'a normal user cannot rename a product');

  perform assert(not permitted(v_user,
    format('insert into model_aliases (model_id, value, normalized_key)
            values (%L, ''Free Warranty Edition'', ''FREEWARRANTYEDITION'')', v_model)),
    'a normal user cannot invent an alias');

  perform assert(permitted(v_editor,
    format('insert into model_aliases (model_id, value, normalized_key)
            values (%L, ''MacBookAir M4'', ''MACBOOKAIRM4'')', v_model)),
    'a data editor can propose an alias');

  select publication_status into v_status
    from model_aliases where value = 'MacBookAir M4';
  perform assert(v_status = 'candidate',
    'a proposed alias is a candidate, so it cannot resolve anybody''s warranty yet');

  perform assert(not permitted(v_editor,
    'update model_aliases set publication_status = ''published'' where value = ''MacBookAir M4'''),
    'a data editor cannot publish their own alias');

  perform assert(permitted(v_reviewer,
    'update model_aliases set publication_status = ''verified'' where value = ''MacBookAir M4'''),
    'a reviewer can approve it');

  -- ---- what a consumer can read ------------------------------------------
  -- The pilot fixtures are marked demo, and demo rows are invisible to
  -- consumers by construction — so this needs a production row of its own.
  insert into product_models
    (manufacturer_id, canonical_model, normalized_key, publication_status, data_environment)
  values (v_apple, 'Test Production Model', 'TESTPRODUCTIONMODEL', 'published', 'production');

  perform assert(visible_count(v_user,
    'select count(*)::int from product_models') = 1,
    'a normal user reads published production models, and only those');

  perform assert(visible_count(v_user,
    'select count(*)::int from product_models where data_environment = ''demo''') = 0,
    'the pilot fixtures stay invisible to consumers');

  select count(*) into v_count from model_aliases where publication_status = 'candidate';
  perform assert(
    visible_count(v_user, 'select count(*)::int from model_aliases
                             where publication_status = ''candidate''') = 0,
    'a normal user cannot see proposals waiting for review');

  -- ---- serial rules are empty until somebody researches one --------------
  select count(*) into v_count from warranty_serial_rules;
  perform assert(v_count = 0,
    'no serial rules exist, because an inferred serial rule is invented coverage');

  raise notice '--- all model identity assertions passed ---';
end;
$$;

rollback;
