-- Platform layer: identity, tenancy, billing, jobs, audit. Applied by mfg_owner; the app connects as mfg_app.
create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text not null,
  password_hash text not null,
  email_verified_at timestamptz,
  totp_secret text,
  totp_enabled boolean not null default false,
  platform_role text check (platform_role in ('owner','billing','support','techops')),
  suspended boolean not null default false,
  failed_logins int not null default 0,
  locked_until timestamptz,
  notif_prefs jsonb not null default '{"email":true,"inapp":true}',
  created_at timestamptz not null default now()
);
create unique index users_email_uq on users (lower(email));

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  company_id uuid,
  mfa_ok boolean not null default false,
  user_agent text,
  ip text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index sessions_user on sessions(user_id);

create table auth_tokens (  -- email verification, password reset
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('verify','reset')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz
);

create table plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  active boolean not null default true
);
create table plan_versions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans(id),
  version int not null,
  effective_from date not null,
  price_monthly_paise bigint not null check (price_monthly_paise >= 0),
  price_yearly_paise bigint not null check (price_yearly_paise >= 0),
  max_users int not null, max_plants int not null, max_items int not null,
  features jsonb not null default '{}',
  unique (plan_id, version)
);

create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  gstin text, address text, billing_email text,
  status text not null default 'trial' check (status in ('trial','active','past_due','suspended','cancelled','closed')),
  trial_ends_at timestamptz,
  branding jsonb not null default '{}',
  onboarding jsonb not null default '{}',
  demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  user_id uuid not null references users(id),
  role text not null check (role in ('owner','manager','planner','buyer','storekeeper','supervisor','operator','quality','sales','finance','viewer','customer','supplier')),
  plant_ids uuid[] not null default '{}',   -- empty = all plants
  party_id uuid,                             -- customer/supplier id for portal roles
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, user_id)
);
create index memberships_user on memberships(user_id);

create table invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  email text not null,
  role text not null,
  plant_ids uuid[] not null default '{}',
  party_id uuid,
  token_hash text not null unique,
  invited_by uuid references users(id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  plan_version_id uuid not null references plan_versions(id),
  cycle text not null check (cycle in ('monthly','yearly')),
  status text not null check (status in ('trialing','active','past_due','cancelled','expired')),
  period_start timestamptz not null, period_end timestamptz not null,
  grace_until timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now()
);
create index subs_company on subscriptions(company_id);

create table platform_invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  subscription_id uuid references subscriptions(id),
  number text not null unique,
  plan_version_id uuid references plan_versions(id),   -- historical pricing preserved
  description text not null,
  amount_paise bigint not null,
  tax_paise bigint not null default 0,
  status text not null check (status in ('pending','paid','failed','refunded','disputed','void')),
  provider text, provider_ref text, reconciliation_ref text,
  refunded_paise bigint not null default 0,
  created_at timestamptz not null default now(), paid_at timestamptz
);
create unique index platform_invoice_provider_ref on platform_invoices(provider, provider_ref) where provider_ref is not null;

create table webhook_events (   -- idempotent payment callbacks
  id uuid primary key default gen_random_uuid(),
  provider text not null, event_id text not null,
  payload jsonb not null, signature_ok boolean not null,
  status text not null default 'received' check (status in ('received','processed','failed','ignored')),
  error text, attempts int not null default 0,
  received_at timestamptz not null default now(),
  unique (provider, event_id)
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  kind text not null,
  payload jsonb not null default '{}',
  dedupe_key text unique,
  status text not null default 'queued' check (status in ('queued','running','done','failed','dead')),
  attempts int not null default 0, max_attempts int not null default 5,
  run_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(), finished_at timestamptz
);
create index jobs_due on jobs(status, run_at);

create table email_outbox (
  id uuid primary key default gen_random_uuid(),
  company_id uuid, to_email text not null, subject text not null, body text not null,
  status text not null default 'queued' check (status in ('queued','sent','failed')),
  attempts int not null default 0, last_error text,
  created_at timestamptz not null default now(), sent_at timestamptz
);

create table audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  company_id uuid, user_id uuid, actor_label text,
  action text not null, entity text, entity_id text,
  reason text, detail jsonb not null default '{}',
  ip text
);
create index audit_company on audit_log(company_id, at desc);

create table coupons (
  id uuid primary key default gen_random_uuid(), code text unique not null,
  percent_off int not null check (percent_off between 1 and 100), active boolean not null default true,
  created_at timestamptz not null default now()
);
create table support_tickets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id), user_id uuid references users(id),
  subject text not null, body text not null,
  status text not null default 'open' check (status in ('open','pending','resolved')),
  reply text, created_at timestamptz not null default now()
);
create table support_access (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  requested_by uuid not null references users(id),
  approved_by uuid references users(id),
  reason text not null,
  status text not null default 'requested' check (status in ('requested','approved','denied','expired')),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create table announcements (
  id uuid primary key default gen_random_uuid(), title text not null, body text not null,
  active boolean not null default true, created_at timestamptz not null default now()
);
create table notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid, user_id uuid not null references users(id),
  title text not null, body text, href text, read_at timestamptz,
  created_at timestamptz not null default now()
);
create table leads (   -- public demo / contact / trial requests
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('demo','contact','trial')),
  name text not null, email text not null, company text, message text,
  created_at timestamptz not null default now()
);
create table platform_settings (key text primary key, value jsonb not null);
