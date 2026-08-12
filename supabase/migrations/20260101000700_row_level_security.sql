-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- The rule for this schema: RLS is enabled on every table, and the default is deny.
-- Frontend filtering is a convenience, never a control. User A must not be able to
-- read User B's product even with a valid session and a guessed uuid — which is why
-- ids are uuids and why every policy below keys off auth.uid().
--
-- Tables writable only by the backend (subscriptions, notifications, ai_analyses,
-- audit_logs) get SELECT policies for their owner and no INSERT/UPDATE policy at
-- all. service_role bypasses RLS, so Edge Functions can still write them.
-- ---------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- Helpers
-- --------------------------------------------------------------------------

-- Workspace membership check, used by the product policies. SECURITY DEFINER so the
-- policy can read workspace_members without recursing into its own RLS.
create or replace function is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = auth.uid()
  );
$$;

create or replace function can_write_workspace(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin', 'member')   -- 'viewer' is read-only
  );
$$;

-- --------------------------------------------------------------------------
-- Identity
-- --------------------------------------------------------------------------

alter table user_profiles enable row level security;

create policy user_profiles_select_own on user_profiles
  for select using (id = auth.uid() and deleted_at is null);

create policy user_profiles_update_own on user_profiles
  for update using (id = auth.uid() and deleted_at is null)
  with check (id = auth.uid());

-- No INSERT policy: profiles are created by handle_new_user() on signup.
-- No DELETE policy: account deletion goes through the delete-account Edge Function
-- so it can also purge Storage objects and write an audit record.

alter table workspaces enable row level security;

create policy workspaces_select_member on workspaces
  for select using (is_workspace_member(id) and deleted_at is null);

create policy workspaces_update_owner on workspaces
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

alter table workspace_members enable row level security;

create policy workspace_members_select_self on workspace_members
  for select using (user_id = auth.uid() or is_workspace_member(workspace_id));

alter table user_notification_settings enable row level security;

create policy notification_settings_select_own on user_notification_settings
  for select using (user_id = auth.uid());

create policy notification_settings_upsert_own on user_notification_settings
  for insert with check (user_id = auth.uid());

create policy notification_settings_update_own on user_notification_settings
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table user_devices enable row level security;

create policy user_devices_select_own on user_devices
  for select using (user_id = auth.uid());

create policy user_devices_insert_own on user_devices
  for insert with check (user_id = auth.uid());

create policy user_devices_update_own on user_devices
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy user_devices_delete_own on user_devices
  for delete using (user_id = auth.uid());

-- --------------------------------------------------------------------------
-- Shared reference data — readable by any signed-in user, writable by nobody
-- except service-role and the future admin console.
-- --------------------------------------------------------------------------

alter table product_categories enable row level security;
create policy categories_read on product_categories
  for select to authenticated using (is_active);

alter table organisations enable row level security;
create policy organisations_read on organisations
  for select to authenticated using (true);

alter table service_locations enable row level security;
create policy service_locations_read on service_locations
  for select to authenticated using (is_active);

alter table feature_flags enable row level security;
create policy feature_flags_read on feature_flags
  for select to authenticated using (true);

alter table warranties enable row level security;
create policy warranties_read on warranties
  for select to authenticated using (true);

alter table warranty_sources enable row level security;
create policy warranty_sources_read on warranty_sources
  for select to authenticated using (true);

-- Clause text is readable so the app can show "view the actual clause". The
-- embedding column is excluded from the app's column selection; it has no value to
-- a client and shipping vectors over the wire is pure waste.
alter table warranty_terms enable row level security;
create policy warranty_terms_read on warranty_terms
  for select to authenticated using (true);

-- --------------------------------------------------------------------------
-- Products
-- --------------------------------------------------------------------------

alter table products enable row level security;

create policy products_select_own on products
  for select using (is_workspace_member(workspace_id) and deleted_at is null);

create policy products_insert_own on products
  for insert with check (
    owner_id = auth.uid() and can_write_workspace(workspace_id)
  );

create policy products_update_own on products
  for update using (can_write_workspace(workspace_id) and deleted_at is null)
  with check (can_write_workspace(workspace_id));

-- Soft delete is an UPDATE (setting deleted_at); hard DELETE is reserved for the
-- account-deletion function, so a mis-tapped button can never destroy history.
create policy products_delete_own on products
  for delete using (owner_id = auth.uid());

alter table product_documents enable row level security;

create policy documents_select_own on product_documents
  for select using (owner_id = auth.uid() and deleted_at is null);

create policy documents_insert_own on product_documents
  for insert with check (
    owner_id = auth.uid()
    and exists (
      select 1 from products p
      where p.id = product_id and p.owner_id = auth.uid() and p.deleted_at is null
    )
  );

create policy documents_update_own on product_documents
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy documents_delete_own on product_documents
  for delete using (owner_id = auth.uid());

-- --------------------------------------------------------------------------
-- Claims
-- --------------------------------------------------------------------------

alter table claims enable row level security;

create policy claims_select_own on claims
  for select using (owner_id = auth.uid() and deleted_at is null);

create policy claims_insert_own on claims
  for insert with check (
    owner_id = auth.uid()
    and exists (
      select 1 from products p
      where p.id = product_id and p.owner_id = auth.uid() and p.deleted_at is null
    )
  );

create policy claims_update_own on claims
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

alter table claim_messages enable row level security;

create policy claim_messages_select_own on claim_messages
  for select using (owner_id = auth.uid());

create policy claim_messages_insert_own on claim_messages
  for insert with check (
    owner_id = auth.uid()
    and author = 'user'   -- only the backend may author 'system' or 'provider'
    and exists (select 1 from claims c where c.id = claim_id and c.owner_id = auth.uid())
  );

-- --------------------------------------------------------------------------
-- Backend-written tables: read-only to their owner
-- --------------------------------------------------------------------------

alter table ai_analyses enable row level security;
create policy ai_analyses_select_own on ai_analyses
  for select using (owner_id = auth.uid());
-- Deliberately no INSERT policy. An analysis is only valid if the server produced
-- it; letting a client write one would let it fabricate a favourable verdict.

alter table ai_usage_counters enable row level security;
create policy ai_usage_select_own on ai_usage_counters
  for select using (owner_id = auth.uid());

alter table ocr_jobs enable row level security;
create policy ocr_jobs_select_own on ocr_jobs
  for select using (owner_id = auth.uid());

alter table notifications enable row level security;
create policy notifications_select_own on notifications
  for select using (owner_id = auth.uid());
-- Users may mark their own notifications read; nothing else about them is mutable.
create policy notifications_mark_read on notifications
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

alter table subscriptions enable row level security;
create policy subscriptions_select_own on subscriptions
  for select using (user_id = auth.uid());
-- No INSERT/UPDATE policy: subscription state is set exclusively by the verified
-- store-notification handlers. This is what makes entitlements non-client-authoritative.

alter table subscription_events enable row level security;
-- No policies at all: store payloads are service-role only.

alter table audit_logs enable row level security;
create policy audit_logs_select_own on audit_logs
  for select using (actor_id = auth.uid());

-- --------------------------------------------------------------------------
-- Column-level hardening
--
-- Even with row policies, a user should not be able to hand-craft a PostgREST call
-- that rewrites fields the server owns.
-- --------------------------------------------------------------------------

revoke update (owner_id, workspace_id, created_at) on products from authenticated;
revoke update (owner_id, product_id, storage_path, content_hash) on product_documents from authenticated;
revoke update (owner_id, product_id, snapshot) on claims from authenticated;

-- Notifications: only read_at may be touched by a client.
revoke update on notifications from authenticated;
grant update (read_at) on notifications to authenticated;
