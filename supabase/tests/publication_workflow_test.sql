-- ---------------------------------------------------------------------------
-- Publication workflow — behaviour tests
--
-- Two claims are made elsewhere in this codebase and are only true if this file
-- passes:
--
--   "AI must not independently publish trusted global data."
--   "Demo fixtures must never surface as verified production data."
--
-- Both are claims about the database, not about the console, because a claim
-- that depends on which buttons a UI renders is not a guarantee.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/publication_workflow_test.sql
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

/** Runs a statement as a signed-in user; true only if it actually took effect. */
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

do $$
declare
  v_editor   uuid := '33333333-3333-3333-3333-333333333333';
  v_reviewer uuid := '44444444-4444-4444-4444-444444444444';
  v_brand    uuid;
  v_warranty uuid;
  v_status   publication_status;
  v_reviewed uuid;
  v_count    int;
begin
  insert into auth.users (id, email)
  values (v_editor, 'editor@publication.test'), (v_reviewer, 'reviewer@publication.test');

  insert into admin_members (user_id, role) values
    (v_editor, 'data_editor'), (v_reviewer, 'reviewer');

  insert into organisations (slug, name, roles, country_code)
  values ('guard-brand', 'Guard Brand', array['manufacturer']::org_role[], 'IL')
  returning id into v_brand;

  -- ---- new rows are born unpublished ---------------------------------------
  insert into warranties (brand_id, duration_months, country_code)
  values (v_brand, 24, 'IL')
  returning id, publication_status into v_warranty, v_status;

  perform assert(v_status = 'candidate',
    'a warranty created without a stated status is a candidate, not live');

  -- ---- an editor may write, but may not publish ----------------------------
  perform assert(permitted(v_editor,
    format('update warranties set duration_months = 36 where id = %L', v_warranty)),
    'a data editor can edit a candidate policy');

  perform assert(not permitted(v_editor,
    format('update warranties set publication_status = ''published'' where id = %L', v_warranty)),
    'a data editor cannot publish a policy');

  perform assert(not permitted(v_editor,
    format('update warranties set publication_status = ''verified'' where id = %L', v_warranty)),
    'a data editor cannot mark a policy verified');

  -- The one that matters: creating a row already published, skipping review.
  perform assert(not permitted(v_editor,
    format('insert into warranties (brand_id, duration_months, country_code, publication_status)
            values (%L, 12, ''IL'', ''published'')', v_brand)),
    'a data editor cannot create a policy that is published on arrival');

  select publication_status into v_status from warranties where id = v_warranty;
  perform assert(v_status = 'candidate', 'the policy is still a candidate after all that');

  -- ---- a reviewer may promote ----------------------------------------------
  perform assert(permitted(v_reviewer,
    format('update warranties set publication_status = ''verified'' where id = %L', v_warranty)),
    'a reviewer can verify a policy');

  select reviewed_by into v_reviewed from warranties where id = v_warranty;
  perform assert(v_reviewed = v_reviewer,
    'promotion records who did it, without the console having to remember');

  perform assert(permitted(v_reviewer,
    format('update warranties set publication_status = ''published'' where id = %L', v_warranty)),
    'a reviewer can publish a verified policy');

  -- ---- what the resolver may read ------------------------------------------
  select count(*) into v_count from published_warranties where id = v_warranty;
  perform assert(v_count = 1, 'a published production policy is visible to the resolver');

  update warranties set data_environment = 'demo' where id = v_warranty;
  select count(*) into v_count from published_warranties where id = v_warranty;
  perform assert(v_count = 0,
    'a demo fixture is excluded structurally, even while marked published');

  perform assert(visible_environments() = array['production']::data_environment[],
    'a database serves production data unless a developer opts in');

  raise notice '--- all publication workflow assertions passed ---';
end;
$$;

rollback;
