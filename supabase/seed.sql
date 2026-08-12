-- ---------------------------------------------------------------------------
-- Development seed data
--
-- Reference data only — categories, a few organisations and feature flags. No user
-- data: development accounts are created by signing up against the local stack.
-- ---------------------------------------------------------------------------

insert into product_categories (slug, labels, icon, sort_order, typical_warranty_months)
values
  ('electronics', '{"en":"Electronics","he":"אלקטרוניקה"}', 'tv', 10, 24),
  ('appliances', '{"en":"Appliances","he":"מוצרי חשמל"}', 'washing-machine', 20, 24),
  ('computers', '{"en":"Computers","he":"מחשבים"}', 'laptop', 30, 12),
  ('phones', '{"en":"Phones","he":"טלפונים"}', 'phone', 40, 12),
  ('furniture', '{"en":"Furniture","he":"רהיטים"}', 'sofa', 50, 60),
  ('tools', '{"en":"Tools","he":"כלי עבודה"}', 'wrench', 60, 24),
  ('automotive', '{"en":"Automotive Accessories","he":"אביזרי רכב"}', 'car', 70, 12),
  ('home-equipment', '{"en":"Home Equipment","he":"ציוד לבית"}', 'home', 80, 24),
  ('baby', '{"en":"Baby Products","he":"מוצרי תינוקות"}', 'stroller', 90, 24),
  ('jewelry', '{"en":"Jewelry","he":"תכשיטים"}', 'gem', 100, 12),
  ('watches', '{"en":"Watches","he":"שעונים"}', 'watch', 110, 24),
  ('other', '{"en":"Other","he":"אחר"}', 'box', 999, null)
on conflict (slug) do nothing;

insert into feature_flags (key, description, enabled, rollout_percent, plans)
values
  ('barcode_scan', 'Barcode/EAN lookup in the add-product flow', false, 0, null),
  ('receipt_ocr', 'Receipt scanning and field extraction', true, 100, array['plus','pro']::plan_id[]),
  ('ai_coverage', 'AI warranty coverage analysis', true, 100, array['plus','pro']::plan_id[]),
  ('provider_discovery', 'Nearest authorised service centre lookup', false, 0, array['plus','pro']::plan_id[]),
  ('claim_assistant', 'Guided claim preparation', true, 100, array['plus','pro']::plan_id[]),
  ('email_import', 'Forward receipts to a personal import address', false, 0, null),
  ('family_sharing', 'Shared family workspaces', false, 0, null),
  ('biometric_lock', 'Face ID / fingerprint app lock', true, 100, null)
on conflict (key) do nothing;

-- A minimal organisation graph showing the four distinct roles for one product.
with brand as (
  insert into organisations (slug, name, roles, website, is_verified)
  values ('samsung', 'Samsung', array['manufacturer']::org_role[], 'https://www.samsung.com', true)
  on conflict (slug) do update set name = excluded.name
  returning id
), importer as (
  insert into organisations (slug, name, legal_name, roles, country_code, website, is_verified)
  values (
    'samsung-il', 'Samsung Israel', 'Samsung Electronics Israel Ltd.',
    array['importer','warranty_provider','service_provider']::org_role[],
    'IL', 'https://www.samsung.com/il/', true
  )
  on conflict (slug) do update set name = excluded.name
  returning id
)
insert into organisations (slug, name, roles, country_code, is_verified)
values ('ksp', 'KSP', array['retailer']::org_role[], 'IL', true)
on conflict (slug) do nothing;
