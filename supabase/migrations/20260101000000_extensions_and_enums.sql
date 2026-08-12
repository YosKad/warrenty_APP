-- ---------------------------------------------------------------------------
-- MY Warranty — extensions, enums and shared helpers
--
-- Conventions used throughout the schema:
--   * every primary key is a uuid (never a sequential id — see SECURITY.md)
--   * every table carries created_at / updated_at, maintained by trigger
--   * user-owned tables carry deleted_at for soft delete, and RLS hides soft-deleted
--     rows so "deleted" behaves like deleted without losing the audit trail
--   * calendar facts (purchase_date, warranty_end) are `date`; event instants are
--     `timestamptz` and always stored in UTC
-- ---------------------------------------------------------------------------

create extension if not exists "pgcrypto";      -- gen_random_uuid()
create extension if not exists "pg_trgm";       -- fuzzy product/brand search
create extension if not exists "vector";        -- warranty clause embeddings (RAG)
create extension if not exists "citext";        -- case-insensitive email

-- --------------------------------------------------------------------------
-- Enums
-- --------------------------------------------------------------------------

create type warranty_status as enum ('active', 'ending_soon', 'expired', 'unknown');

create type product_lifecycle as enum (
  'active', 'claim_open', 'repair_in_progress', 'replaced', 'sold', 'disposed'
);

-- Where a piece of warranty information came from. Drives the trust layer in the UI.
create type warranty_source_kind as enum (
  'user_entered', 'manufacturer', 'retailer', 'internal_db', 'document_extraction', 'ai_inferred'
);

create type confidence_level as enum ('high', 'medium', 'low');

-- Editorial state of a warranty record in our own database.
create type verification_state as enum (
  'unverified', 'ai_extracted', 'community_submitted', 'verified', 'official'
);

create type plan_id as enum ('free', 'plus', 'pro');

create type subscription_status as enum (
  'active', 'in_trial', 'in_grace_period', 'in_billing_retry', 'expired', 'revoked', 'none'
);

create type store_provider as enum ('apple', 'google');

create type document_kind as enum (
  'receipt', 'invoice', 'warranty_certificate', 'service_document', 'product_photo', 'other'
);

create type claim_status as enum (
  'draft', 'analysing', 'ready_to_contact', 'submitted', 'in_progress', 'resolved', 'rejected', 'cancelled'
);

create type notification_kind as enum (
  'warranty_expiring', 'warranty_expired', 'claim_update', 'document_ready', 'subscription'
);

create type notification_delivery as enum ('pending', 'sent', 'failed', 'suppressed');

create type job_status as enum ('queued', 'processing', 'succeeded', 'failed');

create type coverage_verdict as enum (
  'likely_covered', 'possibly_covered', 'likely_not_covered', 'insufficient_information'
);

-- Organisations play different roles and are frequently *not* the same company.
-- The manufacturer of a TV, the importer who honours the warranty in a given
-- country, the shop that sold it and the workshop that repairs it are four
-- separate entities, and conflating them is why warranty support is confusing.
create type org_role as enum (
  'manufacturer', 'importer', 'retailer', 'warranty_provider', 'service_provider'
);

-- Prepares for family / business workspaces without building them now.
create type workspace_kind as enum ('personal', 'family', 'business');
create type workspace_role as enum ('owner', 'admin', 'member', 'viewer');

-- --------------------------------------------------------------------------
-- Shared trigger helpers
-- --------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function set_updated_at is
  'Maintains updated_at on write. Attached to every mutable table.';
