-- ---------------------------------------------------------------------------
-- DEMO DATA — service concierge fixtures
--
-- ⚠️  DEMONSTRATION DATA. Every phone number below is in a reserved
-- documentation range or an obviously fake pattern, every URL is on
-- `example.invalid`, and every record is `verification = 'unverified'` or
-- `'community_submitted'`. None of it describes how Samsung, Apple or Dyson
-- actually handle service anywhere.
--
-- It exists because the three products need three genuinely *different* service
-- shapes to build against:
--
--   Samsung  — importer honours the warranty, a separate company repairs it,
--              home technician for large screens, WhatsApp, two branches.
--   MacBook  — one company is importer, retailer, warranty provider and
--              service provider at once. The chain must collapse, not repeat.
--   Dyson    — warranty expired. Support exists, repair is chargeable, and the
--              route has to stay honest about that.
--
-- Apply after supabase/seed.sql and supabase/seed_demo_warranty.sql.
-- ---------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- Contact methods
--
-- Note the purposes. Samline publishes a general line and a warranty line; the
-- recommendation engine must pick the warranty line, which is the entire reason
-- `purpose` exists.
-- --------------------------------------------------------------------------

insert into provider_contact_methods
  (organisation_id, kind, purpose, value, label, language_codes, country_code,
   hours, hours_note, priority, source, verification, verified_at, source_url)
values
  -- ---- Samline (importer + warranty provider) ---------------------------
  ((select id from organisations where slug = 'samline'), 'web_form', 'warranty_claims',
   'https://example.invalid/samline/warranty-claim', 'Warranty service request',
   array['he','en'], 'IL', null, null, 10,
   'manufacturer', 'community_submitted', now() - interval '5 days',
   'https://example.invalid/samline/support'),

  ((select id from organisations where slug = 'samline'), 'whatsapp', 'warranty_claims',
   '+972-3-5555000', 'Warranty service on WhatsApp',
   array['he'], 'IL', null, 'Sun–Thu 09:00–17:00', 20,
   'manufacturer', 'community_submitted', now() - interval '5 days',
   'https://example.invalid/samline/support'),

  ((select id from organisations where slug = 'samline'), 'phone', 'warranty_claims',
   '03-5555000', 'Warranty service line',
   array['he','en'], 'IL',
   '{"sun":["09:00","17:00"],"mon":["09:00","17:00"],"tue":["09:00","17:00"],"wed":["09:00","17:00"],"thu":["09:00","17:00"],"fri":["09:00","13:00"]}'::jsonb,
   null, 30, 'manufacturer', 'community_submitted', now() - interval '5 days',
   'https://example.invalid/samline/support'),

  -- The general line exists and must NOT be the recommendation. This row is the
  -- test case for purpose-aware ranking.
  ((select id from organisations where slug = 'samline'), 'phone', 'customer_service',
   '03-5555099', 'General enquiries',
   array['he'], 'IL', null, null, 40,
   'manufacturer', 'unverified', null, null),

  ((select id from organisations where slug = 'samline'), 'phone', 'spare_parts',
   '03-5555077', 'Spare parts',
   array['he'], 'IL', null, null, 50,
   'internal_db', 'unverified', null, null),

  ((select id from organisations where slug = 'samline'), 'email', 'warranty_claims',
   'service@example.invalid', 'Warranty service email',
   array['he','en'], 'IL', null, null, 35,
   'manufacturer', 'community_submitted', now() - interval '5 days', null),

  -- ---- Samsung Authorised Service (the repairer) ------------------------
  ((select id from organisations where slug = 'samsung-service-il'), 'phone', 'appointments',
   '03-5555100', 'Book a repair',
   array['he'], 'IL',
   '{"sun":["08:00","16:00"],"mon":["08:00","16:00"],"tue":["08:00","16:00"],"wed":["08:00","16:00"],"thu":["08:00","16:00"]}'::jsonb,
   null, 20, 'internal_db', 'unverified', null, null),

  -- ---- iDigital (everything at once) ------------------------------------
  ((select id from organisations where slug = 'idigital'), 'phone', 'technical_support',
   '03-5555200', 'Technical support',
   array['he','en'], 'IL',
   '{"sun":["09:00","19:00"],"mon":["09:00","19:00"],"tue":["09:00","19:00"],"wed":["09:00","19:00"],"thu":["09:00","19:00"]}'::jsonb,
   null, 10, 'retailer', 'community_submitted', now() - interval '20 days', null),

  ((select id from organisations where slug = 'idigital'), 'web_form', 'appointments',
   'https://example.invalid/idigital/book', 'Book a service appointment',
   array['he','en'], 'IL', null, null, 15,
   'retailer', 'community_submitted', now() - interval '20 days', null),

  -- ---- Dyson (expired warranty, paid route) -----------------------------
  -- Deliberately old. This is the fixture that exercises "potentially stale".
  ((select id from organisations where slug = 'dyson'), 'phone', 'customer_service',
   '1-800-555-0100', 'Customer support',
   array['en'], null, null, null, 20,
   'manufacturer', 'unverified', now() - interval '400 days', null),

  ((select id from organisations where slug = 'dyson-il'), 'phone', 'technical_support',
   '03-5555300', 'Israel support',
   array['he'], 'IL', null, 'Sun–Thu 09:00–16:00', 15,
   'internal_db', 'unverified', now() - interval '380 days', null);

-- --------------------------------------------------------------------------
-- Service capabilities
--
-- `unknown` is used where a real catalogue would genuinely not know, so the UI
-- has to render "availability not confirmed" rather than a silent absence.
-- --------------------------------------------------------------------------

insert into service_capabilities
  (organisation_id, kind, availability, country_code, typical_lead_time_days,
   fee_note, source, verification, verified_at, notes)
values
  -- Samsung service network
  ((select id from organisations where slug = 'samsung-service-il'), 'home_technician',
   'available', 'IL', 3,
   'No charge for screens over 55 inches under warranty.',
   'manufacturer', 'community_submitted', now() - interval '5 days',
   'DEMO FIXTURE'),
  ((select id from organisations where slug = 'samsung-service-il'), 'appointment_required',
   'available', 'IL', null, null, 'manufacturer', 'community_submitted',
   now() - interval '5 days', 'DEMO FIXTURE'),
  ((select id from organisations where slug = 'samsung-service-il'), 'walk_in',
   'available', 'IL', null, null, 'internal_db', 'unverified', null, 'DEMO FIXTURE'),
  ((select id from organisations where slug = 'samsung-service-il'), 'courier',
   'unknown', 'IL', null, null, 'internal_db', 'unverified', null,
   'DEMO FIXTURE — deliberately unknown so the UI has to say so.'),
  ((select id from organisations where slug = 'samline'), 'phone_diagnostics',
   'available', 'IL', null, null, 'manufacturer', 'community_submitted',
   now() - interval '5 days', 'DEMO FIXTURE'),

  -- iDigital: drop-off and courier, no home visits
  ((select id from organisations where slug = 'idigital'), 'drop_off',
   'available', 'IL', 5, null, 'retailer', 'community_submitted',
   now() - interval '20 days', 'DEMO FIXTURE'),
  ((select id from organisations where slug = 'idigital'), 'courier',
   'available', 'IL', 7, 'Collection charged separately outside warranty.',
   'retailer', 'community_submitted', now() - interval '20 days', 'DEMO FIXTURE'),
  ((select id from organisations where slug = 'idigital'), 'home_technician',
   'unavailable', 'IL', null, null, 'retailer', 'community_submitted',
   now() - interval '20 days', 'DEMO FIXTURE'),
  ((select id from organisations where slug = 'idigital'), 'appointment_required',
   'available', 'IL', null, null, 'retailer', 'community_submitted',
   now() - interval '20 days', 'DEMO FIXTURE'),

  -- Dyson: mail-in only, and chargeable now that cover has ended
  ((select id from organisations where slug = 'dyson-il'), 'mail_in',
   'available', 'IL', 14, 'Chargeable outside the guarantee period.',
   'internal_db', 'unverified', now() - interval '380 days', 'DEMO FIXTURE'),
  ((select id from organisations where slug = 'dyson-il'), 'spare_parts',
   'available', 'IL', null, 'Parts sold directly.',
   'internal_db', 'unverified', now() - interval '380 days', 'DEMO FIXTURE');

-- --------------------------------------------------------------------------
-- Service locations
--
-- Two Samsung branches at different distances, one of which does NOT service
-- televisions — the fixture that proves the correct centre beats the closest.
-- --------------------------------------------------------------------------

insert into service_locations
  (organisation_id, name, country_code, region, city, address_line, postal_code,
   phone, latitude, longitude, opening_hours, time_zone, appointment_required,
   serviced_brand_ids, serviced_category_ids, source, verification, verified_at, source_url)
values
  ((select id from organisations where slug = 'samsung-service-il'),
   'Tel Aviv service centre', 'IL', 'Tel Aviv', 'Tel Aviv',
   'רחוב הרכבת 58', '6777016', '03-5555101',
   32.0640, 34.7800,
   '{"sun":["08:30","17:00"],"mon":["08:30","17:00"],"tue":["08:30","17:00"],"wed":["08:30","17:00"],"thu":["08:30","15:00"]}'::jsonb,
   'Asia/Jerusalem', true,
   array[(select id from organisations where slug = 'samsung')],
   array[(select id from product_categories where slug = 'electronics')],
   'manufacturer', 'community_submitted', now() - interval '5 days',
   'https://example.invalid/samsung-service/locations'),

  -- Closer to central Tel Aviv but phones only. If this one is ever offered for
  -- a television, the compatibility filter has failed.
  ((select id from organisations where slug = 'samsung-service-il'),
   'Dizengoff phone bar', 'IL', 'Tel Aviv', 'Tel Aviv',
   'דיזנגוף 50', '6433222', '03-5555102',
   32.0750, 34.7750,
   '{"sun":["10:00","19:00"],"mon":["10:00","19:00"],"tue":["10:00","19:00"],"wed":["10:00","19:00"],"thu":["10:00","19:00"]}'::jsonb,
   'Asia/Jerusalem', false,
   array[(select id from organisations where slug = 'samsung')],
   array[(select id from product_categories where slug = 'phones')],
   'internal_db', 'unverified', null, null),

  ((select id from organisations where slug = 'samsung-service-il'),
   'Haifa service centre', 'IL', 'Haifa', 'Haifa',
   'שדרות ההסתדרות 120', '3298830', '04-5555103',
   32.8100, 35.0000,
   '{"sun":["08:00","16:00"],"mon":["08:00","16:00"],"tue":["08:00","16:00"],"wed":["08:00","16:00"],"thu":["08:00","14:00"]}'::jsonb,
   'Asia/Jerusalem', true,
   array[(select id from organisations where slug = 'samsung')],
   array[(select id from product_categories where slug = 'electronics')],
   'manufacturer', 'community_submitted', now() - interval '5 days', null),

  ((select id from organisations where slug = 'idigital'),
   'iDigital Ramat Aviv', 'IL', 'Tel Aviv', 'Tel Aviv',
   'איינשטיין 40', '6901220', '03-5555201',
   32.1120, 34.8050,
   '{"sun":["10:00","21:00"],"mon":["10:00","21:00"],"tue":["10:00","21:00"],"wed":["10:00","21:00"],"thu":["10:00","21:00"],"fri":["09:00","14:00"]}'::jsonb,
   'Asia/Jerusalem', true,
   array[(select id from organisations where slug = 'apple')],
   array[(select id from product_categories where slug = 'computers')],
   'retailer', 'community_submitted', now() - interval '20 days', null);

-- --------------------------------------------------------------------------
-- Mark it as demo data — structurally
--
-- Same reason as in seed_demo_warranty.sql: the warning in the header is a
-- comment, and this is the part a query can see. Every contact, capability and
-- branch below belongs to a demonstration organisation, so the whole set is
-- marked by that membership rather than one row at a time.
-- --------------------------------------------------------------------------

with demo_orgs as (
  select id from organisations
   where slug in ('samline', 'samsung-service-il', 'apple', 'idigital', 'dyson', 'dyson-il')
)
update provider_contact_methods
   set data_environment = 'demo', publication_status = 'published'
 where organisation_id in (select id from demo_orgs);

with demo_orgs as (
  select id from organisations
   where slug in ('samline', 'samsung-service-il', 'apple', 'idigital', 'dyson', 'dyson-il')
)
update service_capabilities
   set data_environment = 'demo', publication_status = 'published'
 where organisation_id in (select id from demo_orgs);

with demo_orgs as (
  select id from organisations
   where slug in ('samline', 'samsung-service-il', 'apple', 'idigital', 'dyson', 'dyson-il')
)
update service_locations
   set data_environment = 'demo', publication_status = 'published'
 where organisation_id in (select id from demo_orgs);
