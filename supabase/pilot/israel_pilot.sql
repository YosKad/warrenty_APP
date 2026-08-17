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

-- --------------------------------------------------------------------------
-- Canonical models and their spellings
--
-- ⚠️  Still pilot fixtures. The *products* are real and their names are public
-- knowledge; what is not researched here is which warranty terms apply to them
-- in Israel, and that is why every row stays `data_environment = 'demo'`.
--
-- The normalised keys are what `parseModel` in `@mw/domain` produces. They are
-- written out rather than computed in SQL on purpose: one implementation of the
-- algorithm, in the language the app and the console both run.
-- --------------------------------------------------------------------------

insert into product_models
  (id, manufacturer_id, canonical_model, family, variant, regional_model,
   country_code, normalized_key, verification, publication_status, data_environment, note)
values
  ('d0000000-0000-4000-8000-000000000001',
   (select id from organisations where slug = 'samsung'),
   'Samsung S95D', 'S95', 'OLED', 'QE65S95DATXXH', 'IL', 'S95D',
   'unverified', 'published', 'demo', 'PILOT FIXTURE — product identity only'),

  ('d0000000-0000-4000-8000-000000000002',
   (select id from organisations where slug = 'apple'),
   'MacBook Air M4', 'MacBook Air', '13-inch', null, 'IL', 'MACBOOKAIRM4',
   'unverified', 'published', 'demo', 'PILOT FIXTURE — product identity only'),

  ('d0000000-0000-4000-8000-000000000003',
   (select id from organisations where slug = 'dyson'),
   'Dyson V15 Detect', 'V15', 'Detect', 'SV22', 'IL', 'V15DETECT',
   'unverified', 'published', 'demo', 'PILOT FIXTURE — product identity only')
on conflict (id) do nothing;

insert into model_aliases
  (model_id, value, normalized_key, kind, verification, publication_status, data_environment)
values
  -- The Israeli and European part numbers for the same television.
  ('d0000000-0000-4000-8000-000000000001', 'QE65S95D',   'S95D',     'regional_code', 'verified', 'published', 'demo'),
  ('d0000000-0000-4000-8000-000000000001', 'QE55S95D',   'S95D',     'regional_code', 'verified', 'published', 'demo'),
  ('d0000000-0000-4000-8000-000000000001', 'S95D OLED',  'S95DOLED', 'trading_name',  'verified', 'published', 'demo'),

  -- The abbreviation is the reason aliases exist: no amount of structure gets
  -- from "MBA M4" to "MacBook Air M4", because that is a fact about Apple.
  ('d0000000-0000-4000-8000-000000000002', 'MBA M4',                 'MBAM4',        'abbreviation', 'verified', 'published', 'demo'),
  ('d0000000-0000-4000-8000-000000000002', 'MacBook Air 13-inch M4', 'MACBOOKAIRM4', 'trading_name', 'verified', 'published', 'demo'),
  ('d0000000-0000-4000-8000-000000000002', 'Mac Book Air M4',        'MACBOOKAIRM4', 'retailer_name','verified', 'published', 'demo'),

  ('d0000000-0000-4000-8000-000000000003', 'SV22',              'SV22',     'regional_code', 'verified', 'published', 'demo'),
  ('d0000000-0000-4000-8000-000000000003', 'V15 Detect Absolute','V15DETECTABSOLUTE', 'trading_name', 'verified', 'published', 'demo')
on conflict (model_id, value) do nothing;

-- Point the existing demo policies at the models they cover. This is what makes
-- stage A reachable at all: without it every policy is still only a pattern.
update warranties set model_id = 'd0000000-0000-4000-8000-000000000001'
 where id = 'b0000000-0000-4000-8000-000000000001';
update warranties set model_id = 'd0000000-0000-4000-8000-000000000002'
 where id = 'b0000000-0000-4000-8000-000000000002';
update warranties set model_id = 'd0000000-0000-4000-8000-000000000003'
 where id = 'b0000000-0000-4000-8000-000000000003';

-- The organisation aliases a Hebrew receipt would carry.
insert into organisation_aliases
  (organisation_id, value, normalized_key, kind, country_code,
   verification, publication_status, data_environment)
select o.id, v.value, v.key, v.kind::organisation_alias_kind, 'IL',
       'verified', 'published', 'demo'
  from (values
    ('samline',  'סמליין',              'סמליין',            'transliteration'),
    ('idigital', 'איי דיגיטל',           'איי דיגיטל',        'transliteration'),
    ('idigital', 'iDigital Israel',      'idigital israel',   'trading_name'),
    ('dyson-il', 'דייסון ישראל',         'דייסון ישראל',      'transliteration')
  ) as v(slug, value, key, kind)
  join organisations o on o.slug = v.slug
on conflict (organisation_id, normalized_key) do nothing;
