-- ---------------------------------------------------------------------------
-- Private storage buckets and the RPCs the app calls
-- ---------------------------------------------------------------------------

-- Both buckets are private. Files are reached only through short-lived signed URLs
-- minted for the owner. A public bucket would make every uploaded receipt — which
-- carries names, addresses and card fragments — readable by anyone with the URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('documents', 'documents', false, 26214400,
   array['application/pdf','image/jpeg','image/png','image/heic','image/heif','image/webp']),
  ('product-images', 'product-images', false, 10485760,
   array['image/jpeg','image/png','image/heic','image/heif','image/webp'])
on conflict (id) do nothing;

-- Object paths are '<owner_uuid>/<product_uuid>/<file_uuid>.<ext>'. Authorisation is
-- the first path segment matching the caller — the same rule for read, write and
-- delete, so guessing another user's path fails at the storage layer, not just in
-- the metadata table.
create policy documents_read_own on storage.objects
  for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy documents_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy documents_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy documents_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy product_images_read_own on storage.objects
  for select to authenticated
  using (bucket_id = 'product-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy product_images_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy product_images_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- --------------------------------------------------------------------------
-- RPCs
-- --------------------------------------------------------------------------

-- Home dashboard counts in a single round trip. Doing this client-side would mean
-- fetching every product just to count them.
create or replace function get_warranty_summary()
returns table (
  active_count bigint,
  ending_soon_count bigint,
  expired_count bigint,
  unknown_count bigint,
  total_count bigint,
  next_expiry_product_id uuid,
  next_expiry_date date
)
language sql
stable
security invoker
as $$
  with scoped as (
    select p.*, product_warranty_status(p, current_date) as st,
           product_warranty_end(p) as w_end
    from products p
    where p.deleted_at is null
      and p.lifecycle not in ('sold', 'disposed')
  )
  select
    count(*) filter (where st = 'active'),
    count(*) filter (where st = 'ending_soon'),
    count(*) filter (where st = 'expired'),
    count(*) filter (where st = 'unknown'),
    count(*),
    (select id from scoped where st in ('active','ending_soon') order by w_end limit 1),
    (select w_end from scoped where st in ('active','ending_soon') order by w_end limit 1)
  from scoped;
$$;

-- The quota check the add-product flow calls before opening the form, so the paywall
-- appears at a sensible moment rather than after the user has typed everything in.
create or replace function get_product_quota()
returns table (plan plan_id, product_limit int, current_count int, can_add boolean)
language sql
stable
security invoker
as $$
  select
    p.plan,
    product_limit_for_plan(p.plan),
    c.cnt::int,
    product_limit_for_plan(p.plan) is null or c.cnt < product_limit_for_plan(p.plan)
  from (select effective_plan(auth.uid()) as plan) p,
       (select count(*) as cnt from products
        where owner_id = auth.uid() and deleted_at is null) c;
$$;

-- Soft delete. Exposed as an RPC so "delete" is one auditable operation rather than
-- an UPDATE the client could half-apply.
create or replace function soft_delete_product(p_product_id uuid)
returns void
language plpgsql
security invoker
as $$
begin
  update products
  set deleted_at = now()
  where id = p_product_id and deleted_at is null;

  if not found then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;

  insert into audit_logs (actor_id, action, entity_type, entity_id)
  values (auth.uid(), 'product.soft_delete', 'product', p_product_id);
end;
$$;

-- --------------------------------------------------------------------------
-- Clause retrieval for coverage analysis (the R in RAG)
--
-- Runs inside Postgres so only the handful of clauses that matter ever leave the
-- database. Returns clause text plus its provenance, because the app must be able to
-- show the user the exact wording behind any assessment.
-- --------------------------------------------------------------------------
create or replace function match_warranty_terms(
  p_warranty_id uuid,
  p_embedding vector(1536),
  p_match_count int default 6,
  p_min_similarity float default 0.25
)
returns table (
  id uuid,
  section text,
  clause_text text,
  clause_type text,
  similarity float
)
language sql
stable
security invoker
as $$
  select
    t.id,
    t.section,
    t.clause_text,
    t.clause_type,
    1 - (t.embedding <=> p_embedding) as similarity
  from warranty_terms t
  where t.warranty_id = p_warranty_id
    and t.embedding is not null
    and 1 - (t.embedding <=> p_embedding) >= p_min_similarity
  order by t.embedding <=> p_embedding
  limit greatest(1, least(p_match_count, 12));
$$;

comment on function match_warranty_terms is
  'Vector search scoped to a single warranty policy. Scoping first, then ranking, keeps retrieval cheap and prevents clauses from an unrelated brand leaking into an answer.';
