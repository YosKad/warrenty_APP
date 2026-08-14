-- ---------------------------------------------------------------------------
-- get_service_route() and find_service_locations() — behaviour tests
--
-- Run against a database with the migrations, supabase/seed.sql,
-- supabase/seed_demo_warranty.sql and supabase/seed_demo_service.sql applied:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/service_route_test.sql
--
-- Runs in a transaction and rolls back.
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
  v_tv uuid;
  v_mac uuid;
  v_count int;
  v_name text;
  v_role text;
begin
  select id into v_owner from user_profiles limit 1;
  select id into v_workspace from workspaces limit 1;
  update subscriptions set plan = 'pro', status = 'active', provider = 'apple'
   where user_id = v_owner;

  -- ---- Samsung: importer honours cover, a separate company repairs ---------
  insert into products (workspace_id, owner_id, category_id, name, model, serial_number,
                        brand_id, importer_id, retailer_id, service_provider_id,
                        country_code, purchase_date, warranty_duration_months, warranty_id)
  select v_workspace, v_owner, c.id, 'Samsung OLED S95D', 'QE65S95D', 'RZ8N40FKT9L',
         (select id from organisations where slug = 'samsung'),
         (select id from organisations where slug = 'samline'),
         (select id from organisations where slug = 'ksp'),
         (select id from organisations where slug = 'samsung-service-il'),
         'IL', '2024-08-20', 24, 'b0000000-0000-4000-8000-000000000001'
    from product_categories c where c.slug = 'electronics'
  returning id into v_tv;

  select count(*) into v_count from get_service_route(v_tv);
  perform assert(v_count = 5, 'all five roles are returned, not collapsed in SQL');

  select name into v_name from get_service_route(v_tv) where role = 'warranty_provider';
  perform assert(v_name = 'Samline',
    'the importer honours the warranty, not the manufacturer');

  select name into v_name from get_service_route(v_tv) where role = 'service_provider';
  perform assert(v_name = 'Samsung Authorised Service',
    'a separate company does the repairs');

  select jsonb_array_length(contacts) into v_count
    from get_service_route(v_tv) where role = 'warranty_provider';
  perform assert(v_count = 6, 'the warranty provider carries all of its channels');

  -- The spare-parts and general lines are present in the data on purpose. The
  -- ranking that keeps them out of the recommendation lives in TypeScript.
  select count(*) into v_count
    from get_service_route(v_tv) r,
         jsonb_array_elements(r.contacts) c
   where r.role = 'warranty_provider' and c->>'purpose' = 'spare_parts';
  perform assert(v_count = 1, 'the spare-parts line is returned for the UI to rank down');

  select jsonb_array_length(capabilities) into v_count
    from get_service_route(v_tv) where role = 'service_provider';
  perform assert(v_count = 4, 'the repairer carries its capabilities');

  -- ---- the correct centre beats the closest centre -------------------------
  select count(*) into v_count from find_service_locations(v_tv);
  perform assert(v_count = 2,
    'only the two branches that service televisions are offered');

  select count(*) into v_count from find_service_locations(v_tv)
   where name = 'Dizengoff phone bar';
  perform assert(v_count = 0,
    'the closer branch that only handles phones is excluded, not merely ranked lower');

  select count(*) into v_count from find_service_locations(v_tv, 'IL', 'Haifa');
  perform assert(v_count = 1, 'a manual region narrows the search without any GPS');

  select count(*) into v_count from find_service_locations(v_tv, 'IL', null, 'Tel Aviv');
  perform assert(v_count = 1, 'a manual city narrows the search without any GPS');

  -- ---- a closed branch disappears -----------------------------------------
  update service_locations set closed_at = now() where name = 'Haifa service centre';
  select count(*) into v_count from find_service_locations(v_tv);
  perform assert(v_count = 1, 'a closed branch is no longer offered');
  update service_locations set closed_at = null where name = 'Haifa service centre';

  -- ---- one company, every role --------------------------------------------
  insert into products (workspace_id, owner_id, category_id, name, model,
                        brand_id, importer_id, retailer_id, service_provider_id,
                        warranty_provider_id, country_code, purchase_date,
                        warranty_duration_months, warranty_id)
  select v_workspace, v_owner, c.id, 'MacBook Pro 14"', 'M4 Pro',
         (select id from organisations where slug = 'apple'),
         (select id from organisations where slug = 'idigital'),
         (select id from organisations where slug = 'idigital'),
         (select id from organisations where slug = 'idigital'),
         (select id from organisations where slug = 'idigital'),
         'IL', '2025-02-01', 12, 'b0000000-0000-4000-8000-000000000002'
    from product_categories c where c.slug = 'computers'
  returning id into v_mac;

  select count(distinct organisation_id) into v_count from get_service_route(v_mac);
  perform assert(v_count = 2,
    'a chain where one company holds four roles is two companies, not five');

  select role into v_role from get_service_route(v_mac) where role = 'service_provider';
  perform assert(v_role = 'service_provider',
    'the retailer doubling as the repairer still reports that role');

  select count(*) into v_count from find_service_locations(v_mac);
  perform assert(v_count = 1, 'the computer is routed to the computer branch');

  raise notice '--- all service route assertions passed ---';
end;
$$;

rollback;
