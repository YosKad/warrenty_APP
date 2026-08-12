-- ---------------------------------------------------------------------------
-- Identity, profiles, workspaces and preferences
--
-- `auth.users` (managed by Supabase Auth) holds credentials. Passwords are hashed
-- by GoTrue and never touch our schema. Everything the product needs about a person
-- lives in `user_profiles`, keyed by the same uuid.
-- ---------------------------------------------------------------------------

create table user_profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  display_name        text,
  email               citext not null,
  -- ISO 3166-1 alpha-2. Drives which country's warranty rules apply.
  country_code        char(2) not null default 'US',
  region              text,
  -- BCP 47 language tag. 'en' and 'he' at launch.
  preferred_language  text not null default 'en',
  -- IANA timezone. Reminders are scheduled against this, never against UTC.
  time_zone           text not null default 'UTC',
  -- User's own currency preference for display; each product still stores its own.
  preferred_currency  char(3) not null default 'USD',
  marketing_opt_in    boolean not null default false,
  analytics_opt_in    boolean not null default true,
  biometric_lock      boolean not null default false,
  onboarding_completed_at timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,

  constraint user_profiles_country_upper check (country_code = upper(country_code)),
  constraint user_profiles_currency_upper check (preferred_currency = upper(preferred_currency))
);

comment on table user_profiles is
  'Product-facing user record. Credentials live in auth.users and are never mirrored here.';

create trigger user_profiles_set_updated_at
  before update on user_profiles
  for each row execute function set_updated_at();

-- --------------------------------------------------------------------------
-- Workspaces
--
-- Every product belongs to a workspace, and every user gets a personal workspace on
-- signup. Today that is a one-to-one relationship and the app never shows the
-- concept. It exists now because retrofitting shared ownership onto a user_id column
-- later means migrating every product, document, claim and RLS policy in the system.
-- --------------------------------------------------------------------------

create table workspaces (
  id          uuid primary key default gen_random_uuid(),
  kind        workspace_kind not null default 'personal',
  name        text not null,
  owner_id    uuid not null references user_profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index workspaces_owner_idx on workspaces(owner_id) where deleted_at is null;

create trigger workspaces_set_updated_at
  before update on workspaces
  for each row execute function set_updated_at();

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id      uuid not null references user_profiles(id) on delete cascade,
  role         workspace_role not null default 'owner',
  invited_by   uuid references user_profiles(id) on delete set null,
  joined_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_idx on workspace_members(user_id);

-- --------------------------------------------------------------------------
-- Notification preferences
-- --------------------------------------------------------------------------

create table user_notification_settings (
  user_id                uuid primary key references user_profiles(id) on delete cascade,
  push_enabled           boolean not null default true,
  email_enabled          boolean not null default false,
  -- Days before expiry to notify. Defaults mirror DEFAULT_REMINDER_OFFSETS_DAYS.
  expiry_offsets_days    int[] not null default array[90, 30, 7, 1],
  -- Local hour of day for scheduled sends. 9am, never the middle of the night.
  preferred_hour_local   int not null default 9,
  quiet_hours_start      int not null default 21,
  quiet_hours_end        int not null default 8,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint notification_hour_range check (preferred_hour_local between 0 and 23),
  constraint quiet_start_range check (quiet_hours_start between 0 and 23),
  constraint quiet_end_range check (quiet_hours_end between 0 and 23),
  constraint expiry_offsets_bounded check (
    array_length(expiry_offsets_days, 1) between 1 and 6
  )
);

create trigger user_notification_settings_set_updated_at
  before update on user_notification_settings
  for each row execute function set_updated_at();

-- Push tokens. One row per device so a user with a phone and a tablet gets both.
create table user_devices (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references user_profiles(id) on delete cascade,
  push_token    text not null,
  platform      text not null check (platform in ('ios', 'android')),
  app_version   text,
  locale        text,
  time_zone     text,
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz,

  unique (push_token)
);

create index user_devices_user_idx on user_devices(user_id) where revoked_at is null;

-- --------------------------------------------------------------------------
-- Provisioning a new user
--
-- Runs as SECURITY DEFINER on auth.users insert so a signup atomically produces a
-- profile, a personal workspace, a membership row and default notification settings.
-- Doing this client-side would leave half-provisioned accounts whenever the app is
-- killed mid-signup.
-- --------------------------------------------------------------------------

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_workspace_id uuid;
  resolved_name text;
begin
  resolved_name := coalesce(
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    split_part(new.email, '@', 1)
  );

  insert into user_profiles (id, email, display_name, preferred_language, country_code)
  values (
    new.id,
    new.email,
    resolved_name,
    coalesce(new.raw_user_meta_data ->> 'preferred_language', 'en'),
    upper(coalesce(new.raw_user_meta_data ->> 'country_code', 'US'))
  )
  on conflict (id) do nothing;

  insert into workspaces (kind, name, owner_id)
  values ('personal', coalesce(resolved_name, 'My warranties'), new.id)
  returning id into new_workspace_id;

  insert into workspace_members (workspace_id, user_id, role)
  values (new_workspace_id, new.id, 'owner');

  insert into user_notification_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into subscriptions (user_id, plan, status, provider)
  values (new.id, 'free', 'none', null)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- The trigger itself is created in the subscriptions migration, once every table it
-- writes to exists.
