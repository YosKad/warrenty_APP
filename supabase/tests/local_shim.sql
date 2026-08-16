-- ---------------------------------------------------------------------------
-- Local test shim
--
-- Minimal stand-ins for what Supabase provides, so the migrations can run and —
-- more importantly — RLS can actually be exercised against a bare PostgreSQL.
-- Inspecting policy SQL tells you what someone intended; running a request as a
-- signed-in user tells you what the database will do.
--
-- Never applied to a real project. Supabase owns the `auth` and `storage`
-- schemas there.
--
--   createdb mw
--   psql -d mw -c 'create extension pgcrypto; create extension citext;'
--   psql -d mw -f supabase/tests/local_shim.sql
--   for f in supabase/migrations/*.sql; do psql -d mw -v ON_ERROR_STOP=1 -f "$f"; done
--
-- Two migrations need Supabase Storage, pg_cron and pg_net and are skipped
-- locally: `20260101000800_storage_and_rpc.sql` and
-- `20260101000900_scheduling_and_usage.sql`.
-- ---------------------------------------------------------------------------

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create schema if not exists auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb
);

-- Reads the same setting GoTrue sets, so `set_config('request.jwt.claim.sub', …)`
-- in a test impersonates a user exactly as a real request would.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select '{}'::jsonb
$$;

create schema if not exists storage;
create table storage.buckets (
  id text primary key, name text, public boolean,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text, name text, owner uuid
);
alter table storage.objects enable row level security;

-- Supabase grants the API roles schema and table privileges by default. Mirror
-- that, so the RLS policies are what actually decides — a test that passes only
-- because the role lacks table privileges proves nothing about the policies.
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to authenticated, anon, service_role;
alter default privileges in schema public grant all on sequences to authenticated, anon, service_role;
alter default privileges in schema public grant execute on functions to authenticated, anon, service_role;
