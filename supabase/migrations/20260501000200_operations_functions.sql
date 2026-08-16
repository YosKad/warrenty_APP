-- ---------------------------------------------------------------------------
-- Functions the operations console reads and writes through
--
-- The console talks to the database as the signed-in reviewer, never with the
-- service role, so anything it needs that RLS cannot express has to be a
-- `security definer` function with its own authorization check. There are three
-- of those here and each one starts by asking whether the caller is allowed.
-- ---------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- Audit
--
-- `audit_logs` is readable by admins and writable by nobody: a client that can
-- write the audit trail can rewrite the record of what it did. This function is
-- the only path in, it stamps the actor from the session rather than trusting a
-- parameter, and it refuses callers who are not admins in the first place.
-- --------------------------------------------------------------------------

create or replace function log_admin_action(
  p_action       text,
  p_entity_type  text,
  p_entity_id    uuid default null,
  p_before       jsonb default null,
  p_after        jsonb default null,
  p_reason       text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin('data_editor') then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  insert into audit_logs (actor_id, action, entity_type, entity_id, before_state, after_state, reason)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, p_before, p_after, p_reason);
end;
$$;

comment on function log_admin_action(text, text, uuid, jsonb, jsonb, text) is
  'The only write path into audit_logs. The actor comes from the session, not from a parameter.';

revoke execute on function log_admin_action(text, text, uuid, jsonb, jsonb, text) from anon;

-- --------------------------------------------------------------------------
-- The review queue
--
-- One list across every table that carries a publication status, so a reviewer
-- works through a queue rather than remembering which tables to check. Ordered
-- oldest first: the point of a queue is that nothing sits in it forever.
-- --------------------------------------------------------------------------

create or replace view review_queue
with (security_invoker = true) as
  -- `organisations` carries a boolean rather than the five-state enum the other
  -- tables use. Mapped rather than widened: changing that column's type would
  -- touch the consumer app for no benefit to this queue.
  select 'organisation'::text as record_type, o.id, o.name as label,
         o.publication_status,
         (case when o.is_verified then 'verified' else 'unverified' end)::text,
         o.data_environment, o.created_at, o.updated_at
    from organisations o
   where o.publication_status in ('candidate', 'needs_review', 'needs_reverification')
  union all
  select 'relationship', r.id,
         coalesce(subject.name, '?') || ' ' || r.kind || ' ' || coalesce(object.name, '?'),
         r.publication_status, r.verification::text, r.data_environment, r.created_at, r.updated_at
    from organisation_relationships r
    left join organisations subject on subject.id = r.subject_id
    left join organisations object on object.id = r.object_id
   where r.publication_status in ('candidate', 'needs_review', 'needs_reverification')
  union all
  select 'warranty', w.id,
         coalesce(b.name, 'Unbranded') || ' · ' || coalesce(w.model_pattern, 'all models')
           || coalesce(' · ' || w.country_code, ''),
         w.publication_status, w.verification::text, w.data_environment, w.created_at, w.updated_at
    from warranties w
    left join organisations b on b.id = w.brand_id
   where w.publication_status in ('candidate', 'needs_review', 'needs_reverification')
  union all
  select 'contact', c.id,
         coalesce(o.name, '?') || ' · ' || c.kind || ' · ' || c.value,
         c.publication_status, c.verification::text, c.data_environment, c.created_at, c.updated_at
    from provider_contact_methods c
    left join organisations o on o.id = c.organisation_id
   where c.publication_status in ('candidate', 'needs_review', 'needs_reverification')
  union all
  select 'location', l.id,
         coalesce(o.name, '?') || ' · ' || coalesce(l.name, coalesce(l.city, '?')),
         l.publication_status, l.verification::text, l.data_environment, l.created_at, l.updated_at
    from service_locations l
    left join organisations o on o.id = l.organisation_id
   where l.publication_status in ('candidate', 'needs_review', 'needs_reverification');

comment on view review_queue is
  'Everything awaiting a person, across every table that has a publication status.';

-- --------------------------------------------------------------------------
-- Per-brand corpus coverage
--
-- Which brand to work on next. Counts published production records only —
-- a brand with forty candidate rows and nothing published is not covered, it is
-- a backlog.
-- --------------------------------------------------------------------------

create or replace function brand_corpus_coverage(p_country_code char(2) default 'IL')
returns table (
  brand_id      uuid,
  brand_name    text,
  policies      bigint,
  clauses       bigint,
  relationships bigint,
  contacts      bigint,
  locations     bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with brands as (
    select o.id, o.name
      from organisations o
     where 'manufacturer' = any (o.roles)
       and o.data_environment = 'production'
  )
  select
    b.id,
    b.name,
    (select count(*) from warranties w
      where w.brand_id = b.id
        and w.publication_status = 'published' and w.data_environment = 'production'
        and (w.country_code is null or w.country_code = p_country_code)),
    (select count(*) from warranty_terms t
       join warranties w2 on w2.id = t.warranty_id
      where w2.brand_id = b.id
        and t.publication_status = 'published' and t.data_environment = 'production'),
    (select count(*) from organisation_relationships r
      where r.object_id = b.id
        and r.publication_status = 'published' and r.data_environment = 'production'
        and (r.country_code is null or r.country_code = p_country_code)),
    -- Contacts and branches belong to the companies that act for the brand, not
    -- to the brand itself. Counting the brand's own would report zero for every
    -- imported product, which is the whole market this is built for.
    (select count(*) from provider_contact_methods c
      where c.publication_status = 'published' and c.data_environment = 'production'
        and c.organisation_id in (
          select r.subject_id from organisation_relationships r
           where r.object_id = b.id
             and r.publication_status = 'published'
             and (r.country_code is null or r.country_code = p_country_code)
          union select b.id
        )),
    (select count(*) from service_locations l
      where l.publication_status = 'published' and l.data_environment = 'production'
        and l.closed_at is null
        and l.organisation_id in (
          select r.subject_id from organisation_relationships r
           where r.object_id = b.id
             and r.publication_status = 'published'
             and (r.country_code is null or r.country_code = p_country_code)
          union select b.id
        ))
  from brands b
  order by b.name;
$$;

comment on function brand_corpus_coverage(char) is
  'Published production records per brand. A brand with a policy and no reachable provider is not covered.';
