# Database

Postgres via Supabase. Migrations in `supabase/migrations/`, applied in filename
order.

## Conventions

- **UUID primary keys everywhere.** Sequential ids leak volume and invite
  enumeration.
- **Calendar facts are `date`; events are `timestamptz` in UTC.** A purchase date
  and a warranty end are calendar facts — they must not shift by a day when the
  device changes timezone. A `created_at` is an instant.
- **Money is an amount plus an ISO 4217 code**, never a bare number. Enforced by
  the `products_price_needs_currency` check.
- **Soft delete** (`deleted_at`) on user-owned tables; RLS hides soft-deleted
  rows so "deleted" behaves like deleted while the audit trail survives.
- **`created_at` / `updated_at`** on every mutable table, maintained by the
  `set_updated_at` trigger.

## Table map

### Identity

| Table | Purpose |
| --- | --- |
| `auth.users` | Managed by Supabase Auth. Passwords are bcrypt-hashed by GoTrue and never mirrored into our schema. |
| `user_profiles` | Everything the product needs about a person: country, language, timezone, currency, consent flags. |
| `workspaces` | Owns products. One personal workspace per user today; family/business later. |
| `workspace_members` | Membership + role (`owner`/`admin`/`member`/`viewer`). |
| `user_notification_settings` | Reminder offsets, preferred hour, quiet hours. |
| `user_devices` | Push tokens, one row per device, with the device's timezone. |

`handle_new_user()` runs as `SECURITY DEFINER` on `auth.users` insert and
provisions the profile, workspace, membership, notification settings and a free
subscription row in one transaction. Doing this client-side would leave
half-provisioned accounts whenever the app is killed mid-signup.

### Reference data

| Table | Notes |
| --- | --- |
| `product_categories` | Rows, not an enum — the taxonomy grows without an app release. Labels are a JSONB map (`{"en": …, "he": …}`) so a new category is usable in every language immediately. |
| `organisations` | Brands, importers, retailers, warranty providers and repairers in one table with a `roles` array. |
| `service_locations` | Physical branches, with coarse coordinates for "nearest" ranking. Precise GPS is never needed. |
| `feature_flags` | Server-driven rollout: enabled, percentage, plan restriction, min app version. |

Modelling organisations by role rather than by type is deliberate. For one TV in
Israel there may be Samsung (manufacturer), Samsung Israel (importer + warranty
provider + service), and KSP (retailer). Flattening those into "brand" would make
the app tell users to contact the wrong company.

### Warranty knowledge

| Table | Notes |
| --- | --- |
| `warranty_sources` | Where a policy came from: URL, document title, version, content hash, when it was last verified, and its editorial state. |
| `warranties` | A policy scoped by brand + model pattern + category + country, with a `valid_from`/`valid_to` window. |
| `warranty_terms` | Individual clauses with `clause_type`, coverage tags and a `vector(1536)` embedding. The RAG corpus. |

`resolve_warranty_policy(brand, category, model, country, purchase_date)` returns
up to five candidates ordered by specificity first, then verification state, then
confidence. Specificity beating recency matters: an exact model match for the
right country should win over a newer but generic brand-wide rule.

The `valid_from`/`valid_to` window is what preserves historical accuracy. A
product bought in 2024 is judged by the 2024 terms even after the manufacturer
publishes new ones in 2027.

### User data

| Table | Notes |
| --- | --- |
| `products` | The core record. `owner_id` is denormalised from the workspace for RLS performance and kept truthful by the `products_check_owner` trigger. |
| `product_documents` | Metadata index over the private Storage bucket. Holds `content_hash` for duplicate detection and `extracted_text` from OCR. |
| `claims` | A problem report and its lifecycle. Carries a `snapshot` JSONB of the facts at claim time. |
| `claim_messages` | Timeline entries. Users may only author `'user'` messages — `'system'` and `'provider'` are backend-only. |
| `ai_analyses` | Append-only record of every coverage assessment, with model version, prompt version and the clause ids retrieved. |
| `ai_usage_counters` | Rolling per-user usage for fair-use limits. |
| `ocr_jobs` | Extraction jobs with per-field candidates and confidences. |
| `notifications` | Server-scheduled reminders with a unique `idempotency_key`. |
| `subscriptions` | One row per user. Service-role writable only. |
| `subscription_events` | Every store notification, appended before it mutates state, unique on the store's own event id. |
| `audit_logs` | Sensitive operations. Never contains document contents. |

### V2: service, cases, activity and protection layers

Added by `20260201000000_v2_service_cases_activity.sql`. The reuse decisions
behind it are in [V2_AUDIT.md](V2_AUDIT.md) §D: three existing tables were
extended rather than duplicated, and four proposed tables were dropped because
something already modelled the concept.

| Table | Notes |
| --- | --- |
| `service_capabilities` | How an organisation actually delivers service — home visit, pickup, mail-in, walk-in, phone, online — optionally narrowed to one location. Availability is three-valued (`available`/`unavailable`/`unknown`) and defaults to `unknown`. |
| `provider_contact_methods` | Several ways in per provider, each with its own hours, languages and priority. They are not interchangeable: the WhatsApp number gets answered, the web form does not. |
| `product_protection_layers` | Manufacturer, importer, retailer extension, extended plan, credit card, insurance, statutory — each with its own dates and provider. `products.warranty_end` remains the primary window, so nothing reading it today changes behaviour. |
| `activity_events` | Permanent history, server-written. Distinct from `notifications`, which is delivery: deleting what we told you must never erase what happened. |
| `checkup_templates` / `product_checkups` / `checkup_answers` | Pre-expiry checkups. Schema only in V2 Core; the flow lands in V2.1. |
| `recall_notices` / `recall_matches` | Recall data and conservative per-product matches. Schema only. A match requires a model hit, never a brand hit — a false "your product is recalled" is worse than a missed one. |

Extensions to existing tables:

| Table | Added |
| --- | --- |
| `claims` | `case_number`, `channel`, `contact_method_id`, `appointment_at`, `appointment_location_id`, `estimated_cost`, `actual_cost`, `currency`, `opened_at`, `last_activity_at`. A warranty case is a claim plus how it is being handled, so extending keeps one history rather than splitting a repair across two tables by version. |
| `claim_messages` | `kind` (typed event), `metadata`, `occurred_at`. The timeline becomes an event stream instead of free text with a role. |
| `product_documents` | `claim_id`, so a receipt attached to a case is the same object as the receipt on the product. |

`product_protection_completeness(product_id)` returns the claim-readiness score
and its unsatisfied factors, mirroring `src/domain/protection.ts` weight for
weight so a `pg_cron` reminder and the number on Home cannot disagree. It is a
function, not a column: it is a pure function of data already present, and
storing it would create a cache to invalidate on every product or document edit.
The parity is pinned by tests in `src/domain/__tests__/protection.test.ts`.

## Products table

```sql
id, workspace_id, owner_id,
name, category_id, brand_id, brand_name, model, serial_number,
purchase_date, purchase_price, currency, retailer_id, retailer_name, country_code,
warranty_start, warranty_end, warranty_duration_months, extension_months,
warranty_source, warranty_id, warranty_provider_id, service_provider_id,
warranty_verified_by_user,
image_path, notes, lifecycle,
created_at, updated_at, deleted_at
```

Notable columns:

- `warranty_source` — how the warranty data got there (`user_entered`,
  `manufacturer`, `document_extraction`, `ai_inferred`, …). Drives the
  provenance line in the UI.
- `warranty_verified_by_user` — false until the user has actually looked at
  auto-detected data and confirmed it. Set only by an explicit tap.
- `warranty_id` — the policy that applied at purchase, pinned so later policy
  changes do not rewrite history.
- `lifecycle` — separate from warranty status, because a product can be under an
  open claim while still covered, or sold while cover remains.

Both `brand_id`/`brand_name` and `retailer_id`/`retailer_name` exist so a user is
never blocked by a brand missing from the taxonomy. An admin can promote the free
text to a real organisation later.

## Derived warranty status

Computed in SQL as well as TypeScript, because the reminder scheduler runs
server-side and must agree with the app exactly.

```sql
product_warranty_end(p)      -- explicit end, else start + duration + extension
product_warranty_status(p, as_of, ending_soon_days default 30)
```

`product_warranty_overview` is a `security_invoker` view joining brand and
category for list screens, so the caller's RLS still applies.

## RPCs

| Function | Used by |
| --- | --- |
| `get_warranty_summary()` | Home dashboard counts in one round trip. |
| `get_product_quota()` | Quota check before opening the add form. |
| `soft_delete_product(id)` | Delete as one auditable operation. |
| `resolve_warranty_policy(...)` | Warranty lookup. |
| `match_warranty_terms(warranty_id, embedding, count)` | Clause retrieval for coverage analysis. |
| `effective_plan(user_id)` | Entitlement resolution, honouring grace periods. |
| `increment_ai_usage(...)` | Atomic usage accounting. |
| `product_protection_completeness(id)` | Claim-readiness score and its gaps, mirroring `src/domain/protection.ts`. |

`match_warranty_terms` scopes to a single policy *before* ranking. Scoping first
keeps retrieval cheap and stops clauses from an unrelated brand leaking into an
answer.

## Row Level Security

Enabled on every table; default deny. See
`20260101000700_row_level_security.sql`, and
`20260201000000_v2_service_cases_activity.sql` for the V2 tables, which follow
exactly the same three shapes.

Shape of the policies:

- **Own data** (`products`, `product_documents`, `claims`) — full CRUD scoped by
  workspace membership or `owner_id = auth.uid()`.
- **Reference data** (`product_categories`, `organisations`, `warranties`,
  `warranty_terms`) — SELECT for `authenticated`, no write policy.
- **Backend-owned** (`subscriptions`, `ai_analyses`, `notifications`,
  `ocr_jobs`, `activity_events`, `recall_matches`) — SELECT for the owner, and
  *no INSERT policy at all*. This is what
  makes entitlements and AI verdicts non-client-authoritative: service-role
  bypasses RLS, so Edge Functions can still write them.
- **`subscription_events`** — no policies whatsoever. Store payloads are
  service-role only.

Column-level grants close the remaining gap:

```sql
revoke update (owner_id, workspace_id, created_at) on products from authenticated;
revoke update on notifications from authenticated;
grant  update (read_at) on notifications to authenticated;
revoke update on recall_matches from authenticated;
grant  update (dismissed_at) on recall_matches to authenticated;
revoke update (case_number, opened_at) on claims from authenticated;
revoke update on claim_messages from authenticated;
```

An activity record a client could forge would be worthless as history, and a
recall match a client could create would be a way to make the app lie to its own
user. Dismissing a match is the one thing about it that belongs to the user.

Without those, a hand-crafted PostgREST call could pass the row policy and still
rewrite a field the server owns.

## Storage

Two private buckets: `documents` (25 MB, PDF/JPEG/PNG/HEIC/WebP) and
`product-images` (10 MB, images only).

Object paths are `<ownerId>/<productId>/<fileUuid>.<ext>` and the Storage
policies authorise on `(storage.foldername(name))[1] = auth.uid()::text`. The
path *is* the access control, applied identically to read, write and delete —
so guessing another user's path fails at the storage layer, not merely in the
metadata table.

Files are reached only through signed URLs (5 minutes for documents, 1 hour for
images). Nothing is public.

## Scheduled jobs

`pg_cron` + `pg_net`, configured in `20260101000900_scheduling_and_usage.sql`:

| Schedule | Job |
| --- | --- |
| `5 * * * *` | `send-reminders` — hourly, because users span every timezone and a daily run would miss the 09:00-local slot for most of them. |
| `15 * * * *` | Expire subscriptions past their date when no store notification arrived (safety net for a missed webhook, with 24h of slack). |
| `30 3 * * *` | Prune rate-limit rows. |
| `0 4 * * *` | Purge soft-deleted products past the 30-day retention window. |

## Local development

```bash
supabase start
supabase db reset          # applies migrations + seed.sql
supabase functions serve
```

Regenerate types after a schema change:

```bash
supabase gen types typescript --local > apps/mobile/src/types/database.ts
```

Until a local stack is running, `src/types/database.ts` is hand-maintained and
must be updated alongside any migration.
