-- ---------------------------------------------------------------------------
-- DEMO DATA — warranty intelligence fixtures
--
-- ⚠️  THIS IS DEMONSTRATION DATA, NOT REAL WARRANTY TERMS.
--
-- Every source row below is marked `verification = 'unverified'` with a
-- `document_title` that says so, and every clause carries
-- `extracted_by = 'demo-fixture'`. Nothing here was taken from a real Samsung,
-- Apple or Dyson warranty document, and none of it should ever reach a
-- production database. It exists so the Warranty Intelligence screens can be
-- built and reviewed against realistically *shaped* data — an importer that is
-- not the manufacturer, clauses that cite sections and pages, a component with
-- a longer term than the product, a service fee, and an expired policy.
--
-- Apply after supabase/seed.sql:
--   psql "$DATABASE_URL" -f supabase/seed_demo_warranty.sql
-- ---------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- Organisations — the provider chain, kept as distinct entities
-- --------------------------------------------------------------------------

insert into organisations (slug, name, legal_name, roles, country_code, website, support_phone, is_verified)
values
  -- Samsung's Israeli chain: the manufacturer, a separate importer who is also
  -- the warranty provider, and a separate repair network. This is the case the
  -- whole "never collapse into one provider" rule exists for.
  ('samline', 'Samline', 'סמליין בע״מ',
   array['importer','warranty_provider']::org_role[], 'IL',
   'https://example.invalid/samline', '03-5555000', false),
  ('samsung-service-il', 'Samsung Authorised Service',
   'שירות מורשה סמסונג', array['service_provider']::org_role[], 'IL',
   'https://example.invalid/samsung-service', '03-5555100', false),

  ('apple', 'Apple', 'Apple Inc.', array['manufacturer']::org_role[], null,
   'https://example.invalid/apple', null, false),
  ('idigital', 'iDigital', 'איי-דיגיטל בע״מ',
   array['importer','retailer','warranty_provider','service_provider']::org_role[], 'IL',
   'https://example.invalid/idigital', '03-5555200', false),

  ('dyson', 'Dyson', 'Dyson Ltd.', array['manufacturer','warranty_provider']::org_role[], null,
   'https://example.invalid/dyson', null, false),
  ('dyson-il', 'Dyson Israel', 'דייסון ישראל',
   array['importer','service_provider']::org_role[], 'IL',
   'https://example.invalid/dyson-il', '03-5555300', false)
on conflict (slug) do nothing;

-- --------------------------------------------------------------------------
-- Sources
--
-- Each one names the document, its version, when it was retrieved and when it
-- was last confirmed current. The UI shows all of this under "where this came
-- from"; a policy the user cannot trace is a policy they should not act on.
-- --------------------------------------------------------------------------

insert into warranty_sources
  (id, kind, organisation_id, source_url, document_title, document_version,
   country_code, language, retrieved_at, last_verified_at, verification,
   effective_from, page_count, notes)
values
  ('a0000000-0000-4000-8000-000000000001', 'manufacturer',
   (select id from organisations where slug = 'samline'),
   'https://example.invalid/samline/warranty-tv.pdf',
   'DEMO — Samline television warranty terms', '2024-03',
   'IL', 'en', now() - interval '30 days', now() - interval '2 days', 'unverified',
   '2024-01-01', 6, 'DEMO FIXTURE. Not a real warranty document.'),

  ('a0000000-0000-4000-8000-000000000002', 'manufacturer',
   (select id from organisations where slug = 'apple'),
   'https://example.invalid/apple/limited-warranty.pdf',
   'DEMO — Apple one-year limited warranty', '2024-09',
   null, 'en', now() - interval '60 days', now() - interval '10 days', 'unverified',
   '2024-09-01', 4, 'DEMO FIXTURE. Not a real warranty document.'),

  ('a0000000-0000-4000-8000-000000000003', 'manufacturer',
   (select id from organisations where slug = 'dyson'),
   'https://example.invalid/dyson/warranty.pdf',
   'DEMO — Dyson cordless vacuum warranty', '2023-05',
   null, 'en', now() - interval '400 days', now() - interval '380 days', 'unverified',
   '2023-01-01', 3, 'DEMO FIXTURE. Not a real warranty document.'),

  -- A second, conflicting Samsung-family source, so the conflict UI has
  -- something real to render: a generic manufacturer page saying 12 months
  -- against the importer document saying 24.
  ('a0000000-0000-4000-8000-000000000004', 'internal_db',
   (select id from organisations where slug = 'samsung'),
   'https://example.invalid/samsung/global-warranty',
   'DEMO — Samsung global support page', '2024-01',
   null, 'en', now() - interval '90 days', null, 'unverified',
   '2024-01-01', null, 'DEMO FIXTURE. Deliberately disagrees with the Samline document.')
on conflict (id) do nothing;

-- --------------------------------------------------------------------------
-- Policies
-- --------------------------------------------------------------------------

insert into warranties
  (id, brand_id, category_id, model_pattern, country_code, importer_id,
   duration_months, parts_months, labour_months,
   coverage_summary, exclusions_summary, special_conditions_summary,
   warranty_provider_id, source_id, valid_from, valid_to,
   verification, confidence, policy_version, last_checked_at, verified_at)
values
  -- Samsung OLED, imported by Samline. Specific model pattern, specific country,
  -- specific importer — this should win decisively over the generic policy below.
  ('b0000000-0000-4000-8000-000000000001',
   (select id from organisations where slug = 'samsung'),
   (select id from product_categories where slug = 'electronics'),
   'QE%S95%', 'IL',
   (select id from organisations where slug = 'samline'),
   24, 24, 24,
   'Manufacturing defects in the panel, main board and power supply.',
   'Impact damage, liquid ingress, unauthorised repair, incorrect installation.',
   'Panel and main product 24 months. On-site service included for screens over 55 inches; a call-out fee applies below that.',
   (select id from organisations where slug = 'samline'),
   'a0000000-0000-4000-8000-000000000001',
   '2024-01-01', null,
   'unverified', 'high', 'SAMLINE-TV-2024.03', now() - interval '2 days', now() - interval '2 days'),

  -- The generic Samsung rule. Same brand, no importer, shorter duration —
  -- the conflicting candidate.
  ('b0000000-0000-4000-8000-000000000004',
   (select id from organisations where slug = 'samsung'),
   (select id from product_categories where slug = 'electronics'),
   null, null, null,
   12, 12, 12,
   'Manufacturing defects.', 'Accidental damage.', null,
   (select id from organisations where slug = 'samsung'),
   'a0000000-0000-4000-8000-000000000004',
   '2024-01-01', null,
   'unverified', 'low', 'SAMSUNG-GLOBAL-2024.01', null, null),

  -- MacBook: a different provider chain — Apple is the manufacturer, iDigital is
  -- importer, retailer, warranty provider and service provider all at once.
  ('b0000000-0000-4000-8000-000000000002',
   (select id from organisations where slug = 'apple'),
   (select id from product_categories where slug = 'computers'),
   'M4%', 'IL',
   (select id from organisations where slug = 'idigital'),
   12, 12, 12,
   'Defects in materials and workmanship in the computer and included accessories.',
   'Cosmetic damage, liquid damage, damage from unauthorised service, consumable wear.',
   'Battery service coverage applies only when capacity falls below 80% of the original specification.',
   (select id from organisations where slug = 'idigital'),
   'a0000000-0000-4000-8000-000000000002',
   '2024-09-01', null,
   'unverified', 'medium', 'APPLE-LW-2024.09', now() - interval '10 days', now() - interval '10 days'),

  -- Dyson: expired by the time the demo products are seeded, and with a
  -- component term longer than the product term.
  ('b0000000-0000-4000-8000-000000000003',
   (select id from organisations where slug = 'dyson'),
   (select id from product_categories where slug = 'appliances'),
   'SV%', null, null,
   24, 24, 24,
   'Parts and labour for manufacturing defects in the machine and its motor.',
   'Filters and other consumables, blockages caused by use, accidental damage.',
   'Machine 24 months. Digital motor 60 months from purchase.',
   (select id from organisations where slug = 'dyson'),
   'a0000000-0000-4000-8000-000000000003',
   '2023-01-01', null,
   'unverified', 'medium', 'DYSON-CORDLESS-2023.05', now() - interval '380 days', now() - interval '380 days')
on conflict (id) do nothing;

-- --------------------------------------------------------------------------
-- Clauses
--
-- `clause_text` is the citable source text; `title` and `summary` are the
-- readable layer above it. Both are stored, and the UI shows the source text
-- verbatim when the user taps through — a summary that cannot be checked against
-- its source is exactly what this product must not ship.
-- --------------------------------------------------------------------------

insert into warranty_terms
  (warranty_id, section, source_section, source_page, ordinal, clause_type,
   title, summary, clause_text, coverage_categories, language,
   confidence, verification, extraction_version, extracted_by, extracted_at)
values
  -- ---- Samline television ------------------------------------------------
  ('b0000000-0000-4000-8000-000000000001', 'Section 4 — What is covered',
   'Section 4.1', 2, 10, 'coverage',
   'Manufacturing defects',
   'Faults present in the product when it left the factory are covered for the full term.',
   'Samline warrants that the product will be free from defects in materials and workmanship under normal domestic use for a period of twenty-four (24) months from the date of purchase.',
   array['general'], 'en', 'high', 'unverified', 'demo-1', 'demo-fixture', now()),

  ('b0000000-0000-4000-8000-000000000001', 'Section 4 — What is covered',
   'Section 4.2', 2, 20, 'coverage',
   'Display panel',
   'Panel faults such as lines, dead rows or uneven backlight are covered when they are not caused by impact.',
   'Cover includes the display panel assembly, including defects presenting as persistent horizontal or vertical lines, non-uniform backlighting, or clusters of inoperative pixels exceeding the manufacturer''s published threshold, where such defects arise other than from external force.',
   array['display','panel'], 'en', 'high', 'unverified', 'demo-1', 'demo-fixture', now()),

  ('b0000000-0000-4000-8000-000000000001', 'Section 4 — What is covered',
   'Section 4.3', 2, 30, 'coverage',
   'Internal electronics',
   'The main board, power supply and internal connections are covered.',
   'Cover includes the main board, power supply unit, tuner assembly and internal wiring looms.',
   array['electronics','power'], 'en', 'high', 'unverified', 'demo-1', 'demo-fixture', now()),

  ('b0000000-0000-4000-8000-000000000001', 'Section 5 — What is not covered',
   'Section 5.1', 3, 40, 'exclusion',
   'Impact damage',
   'Damage from a knock, drop or pressure on the screen is not covered.',
   'This warranty does not apply to damage caused by impact, external pressure, dropping, or any other external force applied to the product, whether accidental or otherwise.',
   array['display','panel','physical'], 'en', 'high', 'unverified', 'demo-1', 'demo-fixture', now()),

  ('b0000000-0000-4000-8000-000000000001', 'Section 5 — What is not covered',
   'Section 5.2', 3, 50, 'exclusion',
   'Liquid damage',
   'Any contact with liquid voids cover for the affected parts.',
   'Damage resulting from contact with liquids, moisture, humidity beyond the stated operating range, or corrosive substances is excluded.',
   array['liquid'], 'en', 'high', 'unverified', 'demo-1', 'demo-fixture', now()),

  ('b0000000-0000-4000-8000-000000000001', 'Section 5 — What is not covered',
   'Section 5.4', 3, 60, 'exclusion',
   'Unauthorised repair',
   'Cover ends if the product has been opened or repaired by anyone other than an authorised service centre.',
   'Cover is void where the product has been disassembled, modified or repaired by any party not authorised in writing by Samline.',
   array['service'], 'en', 'high', 'unverified', 'demo-1', 'demo-fixture', now()),

  ('b0000000-0000-4000-8000-000000000001', 'Section 5 — What is not covered',
   'Section 5.5', 3, 70, 'exclusion',
   'Improper installation',
   'Damage caused by incorrect wall mounting or power supply is not covered.',
   'Damage arising from installation not performed in accordance with the supplied instructions, including wall mounting and connection to a non-compliant power supply, is excluded.',
   array['installation'], 'en', 'medium', 'unverified', 'demo-1', 'demo-fixture', now()),

  ('b0000000-0000-4000-8000-000000000001', 'Section 6 — Term',
   'Section 6.1', 4, 80, 'duration',
   'Main product — 24 months',
   'The whole product is covered for 24 months from the purchase date.',
   'The warranty period is twenty-four (24) months from the date of purchase as evidenced by the original proof of purchase.',
   array['general'], 'en', 'high', 'unverified', 'demo-1', 'demo-fixture', now()),

  ('b0000000-0000-4000-8000-000000000001', 'Section 7 — Service',
   'Section 7.2', 5, 90, 'service_fee',
   'Technician visit',
   'On-site service is included for screens over 55 inches; below that a call-out fee may apply.',
   'On-site service is provided without charge for products with a screen size exceeding 55 inches. For smaller products a call-out fee, published in the current service tariff, may be charged where the fault is found not to be covered.',
   array['service'], 'en', 'medium', 'unverified', 'demo-1', 'demo-fixture', now()),

  ('b0000000-0000-4000-8000-000000000001', 'Section 8 — Making a claim',
   'Section 8.1', 5, 100, 'claim_requirement',
   'Proof of purchase',
   'You need the original receipt or invoice to make a claim.',
   'Claims must be accompanied by the original proof of purchase showing the date and place of purchase and the product model.',
   array['claim'], 'en', 'high', 'unverified', 'demo-1', 'demo-fixture', now()),

  ('b0000000-0000-4000-8000-000000000001', 'Section 9 — Territory',
   'Section 9.1', 6, 110, 'geographic_restriction',
   'Israel only',
   'This warranty is honoured in Israel.',
   'This warranty is valid only for products imported and sold in Israel by Samline and is honoured within the territory of the State of Israel.',
   array['territory'], 'en', 'high', 'unverified', 'demo-1', 'demo-fixture', now()),

  -- ---- Apple / iDigital ---------------------------------------------------
  ('b0000000-0000-4000-8000-000000000002', 'Section 2 — Coverage',
   'Section 2.1', 1, 10, 'coverage',
   'Materials and workmanship',
   'Defects in the computer and its included accessories are covered for one year.',
   'Apple warrants the included hardware product and accessories against defects in materials and workmanship for one (1) year from the date of original retail purchase.',
   array['general'], 'en', 'high', 'unverified', 'demo-1', 'demo-fixture', now()),

  ('b0000000-0000-4000-8000-000000000002', 'Section 3 — Exclusions',
   'Section 3.2', 2, 20, 'exclusion',
   'Liquid damage',
   'Liquid contact is not covered.',
   'This warranty does not apply to damage caused by contact with liquid, fire, earthquake or other external cause.',
   array['liquid'], 'en', 'high', 'unverified', 'demo-1', 'demo-fixture', now()),

  ('b0000000-0000-4000-8000-000000000002', 'Section 3 — Exclusions',
   'Section 3.4', 2, 30, 'exclusion',
   'Cosmetic damage',
   'Scratches, dents and worn ports are not covered.',
   'Cosmetic damage, including but not limited to scratches, dents and broken plastic on ports, is excluded unless it resulted from a defect in materials or workmanship.',
   array['cosmetic'], 'en', 'high', 'unverified', 'demo-1', 'demo-fixture', now()),

  ('b0000000-0000-4000-8000-000000000002', 'Section 4 — Battery',
   'Section 4.1', 3, 40, 'condition',
   'Battery capacity',
   'Battery service applies only once capacity falls below 80% of the original.',
   'Service coverage for the built-in rechargeable battery applies where the battery''s capacity to hold an electrical charge has fallen below eighty percent (80%) of its original specification.',
   array['battery'], 'en', 'medium', 'unverified', 'demo-1', 'demo-fixture', now()),

  ('b0000000-0000-4000-8000-000000000002', 'Section 5 — Term',
   'Section 5.1', 3, 50, 'duration',
   'Hardware — 12 months',
   'Hardware cover runs for 12 months from purchase.',
   'The warranty period is twelve (12) months from the date of original retail purchase.',
   array['general'], 'en', 'high', 'unverified', 'demo-1', 'demo-fixture', now()),

  -- ---- Dyson --------------------------------------------------------------
  ('b0000000-0000-4000-8000-000000000003', 'Section 1 — Cover',
   'Section 1.1', 1, 10, 'coverage',
   'Parts and labour',
   'Manufacturing faults in the machine are covered, parts and labour.',
   'Dyson warrants the machine against faults in materials and manufacture, covering both parts and labour, for the applicable warranty period.',
   array['general'], 'en', 'high', 'unverified', 'demo-1', 'demo-fixture', now()),

  ('b0000000-0000-4000-8000-000000000003', 'Section 1 — Cover',
   'Section 1.3', 1, 20, 'duration',
   'Digital motor — 60 months',
   'The digital motor carries a longer term than the rest of the machine.',
   'The Dyson digital motor is covered for sixty (60) months from the date of purchase. All other parts of the machine are covered for twenty-four (24) months.',
   array['motor'], 'en', 'high', 'unverified', 'demo-1', 'demo-fixture', now()),

  ('b0000000-0000-4000-8000-000000000003', 'Section 2 — Not covered',
   'Section 2.1', 2, 30, 'exclusion',
   'Consumables',
   'Filters, brush bars and batteries consumed by normal use are not covered.',
   'This guarantee does not cover parts subject to normal wear, including filters, brush bar bristles and, where the fault is attributable to normal use, the battery pack.',
   array['consumable'], 'en', 'high', 'unverified', 'demo-1', 'demo-fixture', now()),

  ('b0000000-0000-4000-8000-000000000003', 'Section 2 — Not covered',
   'Section 2.2', 2, 40, 'exclusion',
   'Blockages',
   'Loss of suction caused by a blockage is not a fault.',
   'Reduced performance resulting from a blockage caused by use is not a manufacturing fault and is not covered by this guarantee.',
   array['suction'], 'en', 'high', 'unverified', 'demo-1', 'demo-fixture', now());

-- --------------------------------------------------------------------------
-- The conflicting generic Samsung policy gets one clause, so the conflict state
-- is reachable with a real (if thin) document behind it.
-- --------------------------------------------------------------------------

insert into warranty_terms
  (warranty_id, section, source_section, ordinal, clause_type, title, summary,
   clause_text, coverage_categories, language, confidence, verification,
   extraction_version, extracted_by, extracted_at)
values
  ('b0000000-0000-4000-8000-000000000004', 'Support page', 'Warranty', 10, 'duration',
   'Standard term — 12 months',
   'The manufacturer''s global page states a 12-month term.',
   'Samsung products carry a standard twelve (12) month manufacturer warranty unless a longer period is provided by the local importer.',
   array['general'], 'en', 'low', 'unverified', 'demo-1', 'demo-fixture', now());
