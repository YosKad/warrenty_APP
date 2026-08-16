-- ---------------------------------------------------------------------------
-- ISRAEL CORPUS PILOT — chain fixtures for three brands
--
-- ⚠️  PILOT FIXTURES. NOT RESEARCHED, NOT REAL.
--
-- This file completes the *shape* of the chain for Samsung, Apple and Dyson in
-- Israel so the pilot can measure what a complete chain costs and what it buys.
-- It does not contain researched facts: the organisations, phone numbers and
-- URLs come from `seed_demo_*.sql`, which are documentation-range numbers on
-- `example.invalid`, and every row here is written as `data_environment = 'demo'`.
--
-- That marking is structural, not a naming convention: `visible_environments()`
-- returns production only, so nothing here is reachable from a real deployment
-- unless a developer deliberately opts their own database in.
--
-- What the pilot measures with this file is real: how many records one brand
-- needs before the resolver can answer, how the Full Resolution Rate moves as
-- each part of the chain arrives, and how long the mechanical half of the work
-- takes. What it cannot measure is how long a person takes to *find* the
-- facts — see docs/ISRAEL_CORPUS_PILOT.md, which says so plainly rather than
-- quoting a number nobody produced.
--
-- Apply after supabase/seed.sql, seed_demo_warranty.sql and seed_demo_service.sql.
-- ---------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- Relationships — the layer Phase I added and the corpus did not have
--
-- This is the fact the product turns on and the one no previous phase could
-- express: not "Samline is an importer" but "Samline imports for Samsung, in
-- Israel, from March 2024".
-- --------------------------------------------------------------------------

insert into organisation_relationships
  (subject_id, object_id, kind, country_code, effective_from,
   verification, publication_status, data_environment, note)
select s.id, o.id, k.kind::org_relationship_kind, 'IL', k.from_date,
       'unverified', 'published', 'demo', 'PILOT FIXTURE — chain shape only, not researched'
  from (values
    ('samline',            'samsung', 'imports_for',            date '2024-01-01'),
    ('samline',            'samsung', 'warranty_provider_for',  date '2024-01-01'),
    ('samsung-service-il', 'samsung', 'authorized_service_for', date '2024-01-01'),

    ('idigital',           'apple',   'imports_for',            date '2023-01-01'),
    ('idigital',           'apple',   'warranty_provider_for',  date '2023-01-01'),
    ('idigital',           'apple',   'services_for',           date '2023-01-01'),

    ('dyson-il',           'dyson',   'imports_for',            date '2022-01-01'),
    ('dyson-il',           'dyson',   'services_for',           date '2022-01-01')
  ) as k(subject_slug, object_slug, kind, from_date)
  join organisations s on s.slug = k.subject_slug
  join organisations o on o.slug = k.object_slug
 where not exists (
   select 1 from organisation_relationships existing
    where existing.subject_id = s.id
      and existing.object_id = o.id
      and existing.kind = k.kind::org_relationship_kind
 );

-- --------------------------------------------------------------------------
-- The gaps the pilot is meant to expose
--
-- Deliberately left empty rather than filled in:
--
--   · Dyson's policy has no country scope, so an Israeli purchase matches a
--     global rule. That is a real corpus weakness and the pilot should report
--     it, not paper over it.
--   · Apple's chain has one company in four roles. Correct for that market, and
--     the case where a resolver that collapses the chain looks right by luck.
--   · No brand has a `warranty_sources` row with a snapshot, because there is
--     nothing to snapshot without web access.
-- --------------------------------------------------------------------------

select
  (select count(*) from organisation_relationships where data_environment = 'demo')
    as pilot_relationships,
  (select count(*) from warranties where data_environment = 'demo')
    as pilot_policies,
  (select count(*) from provider_contact_methods where data_environment = 'demo')
    as pilot_contacts;
