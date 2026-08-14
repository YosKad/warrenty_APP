-- ---------------------------------------------------------------------------
-- match_warranty_policies() — behaviour tests
--
-- Run against a database with the migrations, supabase/seed.sql and
-- supabase/seed_demo_warranty.sql applied:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/warranty_matching_test.sql
--
-- Every assertion here is a way the product could tell a user something false:
-- the wrong country's terms, a policy published after they bought the thing, or
-- a brand-wide rule presented as if it were about their exact model. The whole
-- file runs in a transaction and rolls back, so it leaves nothing behind.
-- ---------------------------------------------------------------------------

begin;

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

do $$
declare
  v_owner uuid;
  v_workspace uuid;
  v_category uuid;
  v_samsung uuid;
  v_samline uuid;
  v_ksp uuid;
  v_tv uuid;
  v_old uuid;
  v_us uuid;
  v_serial uuid;
  v_expired uuid;
  v_count int;
  v_version text;
  v_matched boolean;
begin
  select id into v_owner from user_profiles limit 1;
  select id into v_workspace from workspaces limit 1;
  if v_owner is null or v_workspace is null then
    raise exception 'seed a user before running these tests';
  end if;

  -- The free-plan product limit is a real trigger and it is right to exist; these
  -- tests just need more than three products to say anything about matching.
  -- A paid plan needs a store provider on the row; the constraint is there so a
  -- plan can never be granted without a purchase behind it.
  update subscriptions
     set plan = 'pro', status = 'active', provider = 'apple'
   where user_id = v_owner;

  select id into v_category from product_categories where slug = 'electronics';
  select id into v_samsung from organisations where slug = 'samsung';
  select id into v_samline from organisations where slug = 'samline';
  select id into v_ksp from organisations where slug = 'ksp';

  -- ---- the product the whole phase is designed around --------------------
  insert into products (workspace_id, owner_id, category_id, name, model, serial_number,
                        brand_id, importer_id, retailer_id, country_code, purchase_date)
  values (v_workspace, v_owner, v_category, 'Samsung OLED S95D', 'QE65S95D', 'RZ8N40FKT9L',
          v_samsung, v_samline, v_ksp, 'IL', '2024-08-20')
  returning id into v_tv;

  select policy_version into v_version from match_warranty_policies(v_tv) limit 1;
  perform assert(v_version = 'SAMLINE-TV-2024.03',
    'the importer-specific policy leads for a product bought from that importer');

  select matched_model and matched_country and matched_importer
    into v_matched from match_warranty_policies(v_tv) limit 1;
  perform assert(v_matched, 'model, country and importer signals all fire');

  select count(*) into v_count from match_warranty_policies(v_tv);
  perform assert(v_count = 2, 'the generic brand policy remains a candidate, not a winner');

  -- ---- policy validity honours the purchase date -------------------------
  insert into products (workspace_id, owner_id, category_id, name, model,
                        brand_id, importer_id, country_code, purchase_date)
  values (v_workspace, v_owner, v_category, 'Older Samsung', 'QE65S95D',
          v_samsung, v_samline, 'IL', '2023-06-01')
  returning id into v_old;

  select count(*) into v_count from match_warranty_policies(v_old);
  perform assert(v_count = 0,
    'a product bought before the policy came into force matches nothing rather than falling back');

  -- ---- country is an exclusion, not a preference -------------------------
  insert into products (workspace_id, owner_id, category_id, name, model,
                        brand_id, country_code, purchase_date)
  values (v_workspace, v_owner, v_category, 'US Samsung', 'QE65S95D',
          v_samsung, 'US', '2024-08-20')
  returning id into v_us;

  select count(*) into v_count from match_warranty_policies(v_us)
   where policy_version = 'SAMLINE-TV-2024.03';
  perform assert(v_count = 0,
    'an Israel-only policy is ineligible abroad, not merely ranked lower');

  select policy_version into v_version from match_warranty_policies(v_us) limit 1;
  perform assert(v_version = 'SAMSUNG-GLOBAL-2024.01',
    'the generic policy is what remains for a product outside the importer territory');

  -- ---- serial ranges ------------------------------------------------------
  update warranties set serial_patterns = array['RZ8N%']
   where policy_version = 'SAMLINE-TV-2024.03';

  select matched_serial into v_matched from match_warranty_policies(v_tv)
   where policy_version = 'SAMLINE-TV-2024.03';
  perform assert(v_matched, 'a serial inside the published range fires the serial signal');

  insert into products (workspace_id, owner_id, category_id, name, model, serial_number,
                        brand_id, importer_id, country_code, purchase_date)
  values (v_workspace, v_owner, v_category, 'Other batch', 'QE65S95D', 'XX00000000',
          v_samsung, v_samline, 'IL', '2024-08-20')
  returning id into v_serial;

  select matched_serial into v_matched from match_warranty_policies(v_serial)
   where policy_version = 'SAMLINE-TV-2024.03';
  perform assert(not v_matched, 'a serial outside the range does not fire it');

  -- ---- an expired warranty still has terms --------------------------------
  -- Cover ending does not make the document irrelevant: the user still needs to
  -- read what it said, and a service history is built on it.
  insert into products (workspace_id, owner_id, category_id, name, model,
                        brand_id, country_code, purchase_date, warranty_duration_months)
  select v_workspace, v_owner, c.id, 'Dyson V15 Detect', 'SV47',
         (select id from organisations where slug = 'dyson'), 'IL', '2023-02-01', 24
    from product_categories c where c.slug = 'appliances'
  returning id into v_expired;

  select policy_version into v_version from match_warranty_policies(v_expired) limit 1;
  perform assert(v_version = 'DYSON-CORDLESS-2023.05',
    'a policy still resolves for a product whose cover has already ended');

  -- ---- clause grouping ----------------------------------------------------
  select count(*) into v_count
    from get_warranty_clauses('b0000000-0000-4000-8000-000000000001')
   where clause_type = 'coverage';
  perform assert(v_count = 3, 'coverage clauses are returned as coverage');

  select count(*) into v_count
    from get_warranty_clauses('b0000000-0000-4000-8000-000000000001')
   where clause_type = 'exclusion';
  perform assert(v_count = 4, 'exclusions are returned as exclusions');

  select clause_type into v_version
    from get_warranty_clauses('b0000000-0000-4000-8000-000000000001') limit 1;
  perform assert(v_version = 'coverage',
    'coverage is ordered first, so "what is covered" leads the screen');

  -- ---- the summary never replaces the source ------------------------------
  select count(*) into v_count
    from warranty_terms
   where warranty_id = 'b0000000-0000-4000-8000-000000000001'
     and (clause_text is null or length(btrim(clause_text)) = 0);
  perform assert(v_count = 0, 'every clause retains its verbatim source text');

  raise notice '--- all warranty matching assertions passed ---';
end;
$$;

rollback;
