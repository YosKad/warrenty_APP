-- ---------------------------------------------------------------------------
-- Subscriptions and entitlements
--
-- Subscription state is server-authoritative. The app may *ask* what plan a user is
-- on, but it can never assert one: `subscriptions` is writable only by service-role
-- (the store-notification handlers), and RLS grants users read access to their own
-- row and nothing more.
-- ---------------------------------------------------------------------------

create table subscriptions (
  user_id                 uuid primary key references user_profiles(id) on delete cascade,
  plan                    plan_id not null default 'free',
  status                  subscription_status not null default 'none',
  provider                store_provider,
  -- The store's product identifier, e.g. 'mywarranty_plus_monthly'. Prices are never
  -- stored here: they come from StoreKit / Play Billing at display time.
  store_product_id        text,
  -- Apple: originalTransactionId. Google: purchaseToken's linked subscription id.
  -- The stable identity of the subscription across renewals, upgrades and refunds.
  original_transaction_id text,
  latest_transaction_id   text,
  started_at              timestamptz,
  current_period_start    timestamptz,
  expires_at              timestamptz,
  auto_renew              boolean not null default false,
  cancelled_at            timestamptz,
  grace_period_expires_at timestamptz,
  is_trial                boolean not null default false,
  environment             text not null default 'production'
                            check (environment in ('sandbox', 'production')),
  last_verified_at        timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint subscriptions_paid_needs_provider check (
    plan = 'free' or provider is not null
  )
);

create unique index subscriptions_original_txn_idx
  on subscriptions(provider, original_transaction_id)
  where original_transaction_id is not null;

create index subscriptions_expiring_idx on subscriptions(expires_at)
  where status in ('active', 'in_trial', 'in_grace_period', 'in_billing_retry');

create trigger subscriptions_set_updated_at
  before update on subscriptions
  for each row execute function set_updated_at();

-- --------------------------------------------------------------------------
-- Store lifecycle events
--
-- Every App Store Server Notification and Play RTDN is appended here before it
-- mutates `subscriptions`. Idempotent on the store's own event id, because both
-- stores retry and will happily deliver the same notification twice.
-- --------------------------------------------------------------------------

create table subscription_events (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references user_profiles(id) on delete set null,
  provider        store_provider not null,
  -- Apple notificationUUID / Google message id. The idempotency anchor.
  event_id        text not null,
  event_type      text not null,
  subtype         text,
  original_transaction_id text,
  payload         jsonb not null,
  processed_at    timestamptz,
  processing_error text,
  received_at     timestamptz not null default now(),

  unique (provider, event_id)
);

create index subscription_events_txn_idx
  on subscription_events(provider, original_transaction_id);
create index subscription_events_unprocessed_idx
  on subscription_events(received_at) where processed_at is null;

-- --------------------------------------------------------------------------
-- Entitlement resolution
--
-- One function, used by both the API and the product-limit trigger. Keeping the
-- plan→limit mapping in the database (rather than only in the app) is what makes
-- the limit unbypassable by a modified client.
-- --------------------------------------------------------------------------

create or replace function effective_plan(p_user_id uuid)
returns plan_id
language sql
stable
security definer
set search_path = public
as $$
  select case
    when s.status in ('active', 'in_trial', 'in_grace_period', 'in_billing_retry')
      then s.plan
    else 'free'::plan_id
  end
  from subscriptions s
  where s.user_id = p_user_id;
$$;

comment on function effective_plan is
  'Grace period and billing retry still entitle the user. A failed card must not lock someone out of their own warranty records.';

create or replace function product_limit_for_plan(p_plan plan_id)
returns int
language sql
immutable
as $$
  select case p_plan
    when 'free' then 3
    when 'plus' then 20
    when 'pro' then null       -- unlimited
  end;
$$;

-- --------------------------------------------------------------------------
-- Server-side enforcement of the product limit
--
-- The app checks the quota to show a paywall at the right moment. This trigger is
-- what actually enforces it. Note it fires on INSERT only: an existing product is
-- never blocked, so a user who downgrades keeps full read/write access to
-- everything they already own.
-- --------------------------------------------------------------------------

create or replace function enforce_product_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan plan_id;
  v_limit int;
  v_count int;
begin
  v_plan := coalesce(effective_plan(new.owner_id), 'free');
  v_limit := product_limit_for_plan(v_plan);

  if v_limit is null then
    return new;  -- Pro: unlimited
  end if;

  select count(*) into v_count
  from products
  where owner_id = new.owner_id and deleted_at is null;

  if v_count >= v_limit then
    raise exception 'product_limit_reached'
      using errcode = '53400',
            detail = format('plan=%s limit=%s current=%s', v_plan, v_limit, v_count),
            hint = 'Upgrade the subscription or remove an existing product.';
  end if;

  return new;
end;
$$;

create trigger products_enforce_limit
  before insert on products
  for each row execute function enforce_product_limit();

-- Now that subscriptions exists, wire up user provisioning.
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
