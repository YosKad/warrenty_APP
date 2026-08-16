-- ---------------------------------------------------------------------------
-- Admin authorization — behaviour tests
--
-- The security core of Phase I. The console makes global warranty and provider
-- data writable for the first time, and the only thing standing between a
-- normal consumer and that data is these policies.
--
-- Run against a database with the migrations applied. It seeds its own users:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/admin_authorization_test.sql
--
-- The tests impersonate real requests: `set local role authenticated` plus the
-- same JWT claim GoTrue sets, so `auth.uid()` and RLS behave exactly as they do
-- in production. Everything rolls back.
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

/**
 * Runs a statement as a signed-in user and reports whether it actually took
 * effect.
 *
 * Row count matters as much as the absence of an error: an UPDATE that matches
 * no rows under RLS does not raise, it silently changes nothing. Treating that
 * as "permitted" would make every one of these tests pass against a database
 * with no policies at all.
 */
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

/** How many rows a signed-in user can see through a query. */
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

/** `is_admin()` as a specific user would see it. */
create or replace function is_admin_for(p_user uuid)
returns boolean language plpgsql as $$
declare v boolean;
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  execute 'set local role authenticated';
  select is_admin() into v;
  execute 'reset role';
  return v;
end;
$$;

do $$
declare
  v_user  uuid := '11111111-1111-1111-1111-111111111111';
  v_admin uuid := '22222222-2222-2222-2222-222222222222';
  v_org      uuid;
  v_importer uuid;
  v_count    int;
begin
  -- The profile rows follow from the `auth.users` trigger, same as in production.
  insert into auth.users (id, email)
  values (v_user, 'user@authorization.test'), (v_admin, 'admin@authorization.test');

  insert into organisations (slug, name, roles, country_code)
  values ('test-brand', 'Test Brand', array['manufacturer']::org_role[], 'IL')
  returning id into v_org;

  insert into organisations (slug, name, roles, country_code)
  values ('test-importer', 'Test Importer', array['importer']::org_role[], 'IL')
  returning id into v_importer;

  -- ---- default deny --------------------------------------------------------
  perform assert(not permitted(v_user,
    format('update organisations set name = ''Hijacked'' where id = %L', v_org)),
    'a normal user cannot rename an organisation');

  perform assert(not permitted(v_user,
    'insert into organisations (slug, name, roles) values (''evil'', ''Evil'', array[''manufacturer'']::org_role[])'),
    'a normal user cannot create an organisation');

  perform assert(not permitted(v_user,
    'insert into warranties (duration_months, verification) values (999, ''official'')'),
    'a normal user cannot publish a warranty policy');

  perform assert(not permitted(v_user,
    format('insert into provider_contact_methods (organisation_id, kind, value) values (%L, ''phone'', ''000'')', v_org)),
    'a normal user cannot add a provider phone number');

  perform assert(not permitted(v_user,
    format('insert into organisation_relationships (subject_id, object_id, kind) values (%L, %L, ''imports_for'')',
           v_importer, v_org)),
    'a normal user cannot assert an importer relationship');

  -- The escalation that matters most: granting yourself admin.
  perform assert(not permitted(v_user,
    format('insert into admin_members (user_id, role) values (%L, ''admin'')', v_user)),
    'a normal user cannot make themselves an admin');

  perform assert(not is_admin_for(v_user), 'a user with no membership row is not an admin');

  -- ---- reads stay as they were --------------------------------------------
  perform assert(visible_count(v_user, 'select count(*)::int from organisations') > 0,
    'a normal user can still read reference data');

  perform assert(visible_count(v_user, 'select count(*)::int from admin_members') = 0,
    'a normal user cannot enumerate the admin list');

  -- ---- admin -------------------------------------------------------------
  insert into admin_members (user_id, role) values (v_admin, 'admin');

  perform assert(is_admin_for(v_admin), 'a member row makes an admin');

  perform assert(permitted(v_admin,
    format('update organisations set name = ''Renamed'' where id = %L', v_org)),
    'an admin can edit an organisation');

  perform assert(permitted(v_admin,
    format('insert into organisation_relationships (subject_id, object_id, kind, country_code)
            values (%L, %L, ''imports_for'', ''IL'')', v_importer, v_org)),
    'an admin can assert a scoped importer relationship');

  -- A queue row to test the read/write split against. Inserted directly so the
  -- assertions below are about who may *see* and *change* it, not who made it.
  insert into extraction_jobs (source_url, organisation_id, country_code)
  values ('https://example.test/warranty.pdf', v_org, 'IL');

  -- ---- role ladder --------------------------------------------------------
  update admin_members set role = 'viewer' where user_id = v_admin;

  perform assert(not permitted(v_admin,
    format('update organisations set name = ''Viewer edit'' where id = %L', v_org)),
    'a viewer can read but cannot write');

  perform assert(visible_count(v_admin, 'select count(*)::int from extraction_jobs') = 1,
    'a viewer sees the work queues');

  perform assert(not permitted(v_admin,
    'update extraction_jobs set status = ''reviewed'''),
    'a viewer cannot clear a queue item');

  perform assert(visible_count(v_user, 'select count(*)::int from extraction_jobs') = 0,
    'a normal user sees no queue at all');

  update admin_members set role = 'data_editor' where user_id = v_admin;
  perform assert(permitted(v_admin,
    format('update organisations set name = ''Editor edit'' where id = %L', v_org)),
    'a data editor can write');

  -- ---- revocation ends access, without deleting the record ----------------
  update admin_members set role = 'admin', revoked_at = now() where user_id = v_admin;
  perform assert(not is_admin_for(v_admin), 'revoked membership is not membership');
  select count(*) into v_count from admin_members where user_id = v_admin;
  perform assert(v_count = 1, 'the revoked row survives for the audit trail');

  raise notice '--- all admin authorization assertions passed ---';
end;
$$;

rollback;
