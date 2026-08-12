-- ---------------------------------------------------------------------------
-- Scheduled jobs and AI usage accounting
-- ---------------------------------------------------------------------------

create extension if not exists "pg_cron";
create extension if not exists "pg_net";

-- Atomic usage increment. Doing this in one statement (rather than read-modify-write
-- from the Edge Function) keeps the counter correct under concurrent analyses.
create or replace function increment_ai_usage(
  p_owner_id uuid,
  p_period_start date,
  p_input_tokens bigint default 0,
  p_output_tokens bigint default 0
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into ai_usage_counters (owner_id, period_start, analyses_count, input_tokens, output_tokens)
  values (p_owner_id, p_period_start, 1, p_input_tokens, p_output_tokens)
  on conflict (owner_id, period_start) do update
  set analyses_count = ai_usage_counters.analyses_count + 1,
      input_tokens   = ai_usage_counters.input_tokens + excluded.input_tokens,
      output_tokens  = ai_usage_counters.output_tokens + excluded.output_tokens,
      updated_at     = now();
$$;

-- --------------------------------------------------------------------------
-- Reminder scheduler
--
-- Hourly rather than daily: users span every timezone, and a daily run would deliver
-- some reminders up to 23 hours away from the 09:00-local slot they were promised.
-- The function itself is idempotent, so an extra run is harmless.
--
-- The Vault lookups mean the URL and shared secret are not stored in plain SQL.
-- Configure them once with:
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<random>', 'scheduler_secret');
-- --------------------------------------------------------------------------
select cron.schedule(
  'send-warranty-reminders',
  '5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-scheduler-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'scheduler_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- --------------------------------------------------------------------------
-- Housekeeping
-- --------------------------------------------------------------------------

-- Rate-limit rows are write-heavy and worthless after their window closes.
select cron.schedule(
  'prune-rate-limit-audit',
  '30 3 * * *',
  $$
  delete from audit_logs
  where action like 'ratelimit.%'
    and created_at < now() - interval '2 days';
  $$
);

-- Purge soft-deleted products after the retention window. The window exists so a
-- support request can undo an accidental deletion; after that the data genuinely goes.
select cron.schedule(
  'purge-soft-deleted-products',
  '0 4 * * *',
  $$
  delete from products
  where deleted_at is not null
    and deleted_at < now() - interval '30 days';
  $$
);

-- Mark subscriptions whose expiry has passed without a store notification arriving.
-- Store webhooks are the primary signal; this is the safety net for a missed one.
select cron.schedule(
  'expire-stale-subscriptions',
  '15 * * * *',
  $$
  update subscriptions
  set status = 'expired'
  where status in ('active', 'in_trial', 'in_grace_period', 'in_billing_retry')
    and expires_at is not null
    -- A day of slack, so a slightly late renewal notification doesn't briefly
    -- downgrade a paying user.
    and expires_at < now() - interval '24 hours';
  $$
);
