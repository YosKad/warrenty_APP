-- ---------------------------------------------------------------------------
-- Resolution quality
--
-- Three metrics that a Full Resolution Rate on its own cannot express:
--
--   Auto Resolution Rate   resolved without a person being asked anything
--   Ambiguity Rate         several credible answers, so we asked instead
--   False Resolution Rate  resolved confidently, and wrong
--
-- The last one is the one that matters. A case we could not resolve costs the
-- user a search; a case we resolved wrongly costs them a wasted trip to a
-- service centre that was never going to honour their warranty. Optimising the
-- headline rate without watching this number is how a product becomes
-- confidently useless.
-- ---------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- Failure reasons the data team can act on
--
-- Each new value names a *fix*, not a symptom. "model_alias_missing" tells an
-- operator to add an alias; "model_pattern_too_broad" tells a reviewer to
-- narrow a pattern before it mismatches something.
-- --------------------------------------------------------------------------

alter type resolution_failure add value if not exists 'model_alias_missing';
alter type resolution_failure add value if not exists 'model_ambiguous';
alter type resolution_failure add value if not exists 'model_pattern_too_broad';
alter type resolution_failure add value if not exists 'model_pattern_no_match';
alter type resolution_failure add value if not exists 'importer_conflict';
alter type resolution_failure add value if not exists 'policy_date_conflict';
alter type resolution_failure add value if not exists 'service_capability_missing';
alter type resolution_failure add value if not exists 'location_missing';

-- --------------------------------------------------------------------------
-- What a run now records
-- --------------------------------------------------------------------------

alter table resolution_runs
  add column model_id        uuid references product_models(id) on delete set null,
  add column model_state     text,
  add column model_stage     text,
  add column candidate_count int not null default 0,

  /* Cleared every stage without asking the user for anything. */
  add column auto_resolved   boolean not null default false,
  /* Several credible candidates, so the app asked rather than chose. */
  add column ambiguous       boolean not null default false,

  /*
   * Set by a person during review, never by the resolver. A run cannot know it
   * was wrong; somebody has to check it against the real warranty and say so.
   */
  add column false_resolution boolean,
  add column false_resolution_note text,
  add column reviewed_by     uuid references user_profiles(id) on delete set null,
  add column reviewed_at     timestamptz;

create index resolution_runs_false_idx on resolution_runs(false_resolution)
  where false_resolution is true;

comment on column resolution_runs.false_resolution is
  'A confident answer that turned out to be wrong. Recorded by a reviewer — the resolver cannot know.';

-- --------------------------------------------------------------------------
-- Rates
--
-- `false_resolution_rate` is deliberately measured over *reviewed* runs only.
-- Dividing by every run would drive the number towards zero simply by running
-- the suite more often, which is a metric that rewards not looking.
-- --------------------------------------------------------------------------

-- The signature grows, so the old function has to go first: PostgreSQL treats
-- OUT parameters as part of the return type and `create or replace` cannot
-- change it. Dropping a reporting function loses nothing — the runs are the
-- data, this only reads them.
drop function if exists resolution_rates(text);

create or replace function resolution_rates(p_suite text default null)
returns table (
  total                        bigint,
  product_identification_rate  numeric,
  warranty_resolution_rate     numeric,
  provider_resolution_rate     numeric,
  service_route_resolution_rate numeric,
  full_resolution_rate         numeric,
  auto_resolution_rate         numeric,
  ambiguity_rate               numeric,
  reviewed                     bigint,
  false_resolution_rate        numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with runs as (
    select * from resolution_runs
     where p_suite is null or suite = p_suite
  )
  select
    count(*),
    -- Zero runs produce zero rates, never a vacuous 100%.
    coalesce(avg(product_identified::int), 0),
    coalesce(avg(warranty_resolved::int), 0),
    coalesce(avg(provider_resolved::int), 0),
    coalesce(avg(service_route_resolved::int), 0),
    coalesce(avg((product_identified and warranty_resolved and provider_resolved
                  and service_route_resolved and contact_actionable)::int), 0),
    coalesce(avg(auto_resolved::int), 0),
    coalesce(avg(ambiguous::int), 0),
    count(*) filter (where false_resolution is not null),
    case
      when count(*) filter (where false_resolution is not null) = 0 then 0
      else (count(*) filter (where false_resolution))::numeric
           / count(*) filter (where false_resolution is not null)
    end
  from runs;
$$;

comment on function resolution_rates(text) is
  'Every rate over a suite. False resolution is measured over reviewed runs only — dividing by all runs would reward not looking.';
