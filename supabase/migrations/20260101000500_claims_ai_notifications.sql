-- ---------------------------------------------------------------------------
-- Problem reports, claims, AI analyses, OCR jobs and notifications
-- ---------------------------------------------------------------------------

create table claims (
  id                uuid primary key default gen_random_uuid(),
  product_id        uuid not null references products(id) on delete cascade,
  owner_id          uuid not null references user_profiles(id) on delete cascade,
  status            claim_status not null default 'draft',
  -- What the user told us, in their words. Treated strictly as data downstream.
  issue_description text not null check (length(btrim(issue_description)) between 1 and 4000),
  issue_category    text,
  -- Snapshot of the facts at claim time. A claim must stay explainable even if the
  -- product is later edited or the warranty policy is updated.
  snapshot          jsonb not null default '{}'::jsonb,
  service_provider_id uuid references organisations(id) on delete set null,
  service_location_id uuid references service_locations(id) on delete set null,
  reference_number  text,
  resolution_notes  text,
  resolved_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

create index claims_product_idx on claims(product_id) where deleted_at is null;
create index claims_owner_idx on claims(owner_id) where deleted_at is null;

create trigger claims_set_updated_at
  before update on claims
  for each row execute function set_updated_at();

-- Timeline entries: user notes, status changes, provider correspondence.
create table claim_messages (
  id          uuid primary key default gen_random_uuid(),
  claim_id    uuid not null references claims(id) on delete cascade,
  owner_id    uuid not null references user_profiles(id) on delete cascade,
  author      text not null check (author in ('user', 'system', 'provider')),
  body        text not null check (length(body) <= 4000),
  attachments uuid[] not null default '{}',
  created_at  timestamptz not null default now()
);

create index claim_messages_claim_idx on claim_messages(claim_id, created_at);

-- --------------------------------------------------------------------------
-- AI coverage analyses
--
-- Every analysis records what it was based on: the model version, the warranty
-- policy, the specific clauses retrieved and the document version. Without this we
-- could not explain, months later, why the app said what it said.
-- --------------------------------------------------------------------------

create table ai_analyses (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references user_profiles(id) on delete cascade,
  product_id        uuid not null references products(id) on delete cascade,
  claim_id          uuid references claims(id) on delete set null,

  verdict           coverage_verdict not null,
  confidence        numeric(4,3) not null check (confidence between 0 and 1),
  summary           text not null,
  reasoning_summary text,
  recommended_action text,
  exclusions        text[] not null default '{}',

  -- Auditability: exactly which clauses were retrieved, and from which policy.
  warranty_id       uuid references warranties(id) on delete set null,
  retrieved_term_ids uuid[] not null default '{}',
  document_version  text,
  model_version     text not null,
  prompt_version    text not null,
  -- Cost tracking, for the fair-use limits described in AI.md.
  input_tokens      int,
  output_tokens     int,
  latency_ms        int,
  grounded_in_documents boolean not null default false,

  created_at        timestamptz not null default now()
);

create index ai_analyses_product_idx on ai_analyses(product_id, created_at desc);
create index ai_analyses_owner_month_idx on ai_analyses(owner_id, created_at desc);

comment on table ai_analyses is
  'Immutable record of every coverage analysis shown to a user, including its inputs. Append-only by design.';

-- Rolling per-user AI usage, so fair-use limits can be enforced server-side without
-- scanning ai_analyses on every request.
create table ai_usage_counters (
  owner_id      uuid not null references user_profiles(id) on delete cascade,
  period_start  date not null,
  analyses_count int not null default 0,
  ocr_count      int not null default 0,
  input_tokens   bigint not null default 0,
  output_tokens  bigint not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (owner_id, period_start)
);

-- --------------------------------------------------------------------------
-- OCR jobs
--
-- Extraction is asynchronous and always ends in a review step. The `fields` column
-- holds candidate values with per-field confidence; nothing is written to a product
-- until the user confirms it on the review screen.
-- --------------------------------------------------------------------------

create table ocr_jobs (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references user_profiles(id) on delete cascade,
  document_id   uuid references product_documents(id) on delete cascade,
  status        job_status not null default 'queued',
  provider      text not null default 'internal',
  -- { "purchaseDate": { "value": "2026-05-20", "confidence": 0.94 }, ... }
  fields        jsonb not null default '{}'::jsonb,
  error_code    text,
  attempts      int not null default 0,
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index ocr_jobs_owner_idx on ocr_jobs(owner_id, created_at desc);
create index ocr_jobs_status_idx on ocr_jobs(status) where status in ('queued', 'processing');

create trigger ocr_jobs_set_updated_at
  before update on ocr_jobs
  for each row execute function set_updated_at();

-- --------------------------------------------------------------------------
-- Notifications
--
-- Rows are created by the server-side scheduler, not by the device. Local scheduling
-- alone loses reminders whenever the app is reinstalled or the user switches phones,
-- which for a product whose core promise is "never miss a warranty" is fatal.
-- --------------------------------------------------------------------------

create table notifications (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references user_profiles(id) on delete cascade,
  product_id      uuid references products(id) on delete cascade,
  claim_id        uuid references claims(id) on delete set null,
  kind            notification_kind not null,
  title_key       text not null,
  body_key        text not null,
  -- Interpolation values for the i18n strings, so the copy is rendered in the
  -- user's language at send time rather than frozen in English at schedule time.
  params          jsonb not null default '{}'::jsonb,
  scheduled_for   timestamptz not null,
  sent_at         timestamptz,
  read_at         timestamptz,
  delivery        notification_delivery not null default 'pending',
  failure_reason  text,
  -- '<product>:<kind>:<offset>:<warranty_end>' — makes scheduling idempotent so a
  -- re-run of the cron, or an edit that re-derives the schedule, cannot double-send.
  idempotency_key text not null unique,
  created_at      timestamptz not null default now()
);

create index notifications_owner_idx on notifications(owner_id, created_at desc);
create index notifications_due_idx on notifications(scheduled_for)
  where delivery = 'pending';
create index notifications_unread_idx on notifications(owner_id)
  where read_at is null and delivery = 'sent';

-- --------------------------------------------------------------------------
-- Audit log
--
-- Sensitive operations only: deletions, exports, subscription changes, admin edits
-- to warranty data. Never contains document contents.
-- --------------------------------------------------------------------------

create table audit_logs (
  id            bigserial primary key,
  actor_id      uuid references user_profiles(id) on delete set null,
  action        text not null,
  entity_type   text not null,
  entity_id     uuid,
  metadata      jsonb not null default '{}'::jsonb,
  ip_hash       text,
  created_at    timestamptz not null default now()
);

create index audit_logs_actor_idx on audit_logs(actor_id, created_at desc);
create index audit_logs_entity_idx on audit_logs(entity_type, entity_id);
