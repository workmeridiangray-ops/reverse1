-- Platform, identity, tenancy, subscriptions, jobs, audit.
-- Money is bigint paise. Quantities are numeric(18,3). All ids are uuid.
create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text not null default '',
  password_hash text not null,
  email_verified_at timestamptz,
  totp_secret text,
  totp_enabled boolean not null default false,
  platform_role text check (platform_role in ('owner','billing','support','techops')),
  status text not null default 'active' check (status in ('active','suspended')),
  failed_logins int not null default 0,
  locked_until timestamptz,
  notify_prefs jsonb not null default '{"email_approvals":true,"email_billing":true,"email_digest":false}',
  created_at timestamptz not null default now()
);
create unique index users_email_lower on users (lower(email));

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  org_id uuid,
  mfa_verified boolean not null default false,
  pending_mfa boolean not null default false,
  user_agent text,
  ip text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_reason text
);
create index sessions_user on sessions(user_id);

create table email_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('verify','reset')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table plans (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  version int not null default 1,
  name text not null,
  price_month_paise bigint not null check (price_month_paise >= 0),
  price_year_paise bigint not null check (price_year_paise >= 0),
  limits jsonb not null,          -- {"users":5,"projects":3,"storage_mb":2048,"branches":2}
  features jsonb not null default '[]',
  effective_from date not null default current_date,
  retired_at date,
  unique (code, version)
);

create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'trial' check (status in ('trial','active','past_due','suspended','cancelled','closed')),
  legal_name text, gstin text, address text, state_code text,
  billing_email text, billing_address text,
  brand_color text default '#244B78', logo_file_id uuid,
  suspended_reason text,
  setup jsonb not null default '{}',       -- onboarding progress
  sample_data boolean not null default false,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create table subscriptions (
  org_id uuid primary key references orgs(id) on delete cascade,
  plan_id uuid not null references plans(id),
  interval text not null default 'month' check (interval in ('month','year')),
  status text not null default 'trialing' check (status in ('trialing','active','past_due','cancelled','expired')),
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  grace_until timestamptz,
  cancel_at_period_end boolean not null default false,
  pending_plan_id uuid references plans(id),
  pending_interval text,
  provider_customer_ref text,
  provider_subscription_ref text,
  updated_at timestamptz not null default now()
);

create table branches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  code text not null,
  address text,
  version int not null default 1,
  created_at timestamptz not null default now(),
  unique (org_id, code)
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner','manager','engineer','qs','store','accounts','supervisor','viewer','client','consultant','contractor')),
  status text not null default 'active' check (status in ('active','suspended','removed')),
  branch_ids uuid[] not null default '{}',     -- empty = all branches
  sensitive jsonb not null default '[]',       -- extra sensitive grants e.g. ["safety:incidents","finance:refund"]
  party_id uuid,
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index memberships_user on memberships(user_id);

create table role_permissions (
  org_id uuid not null references orgs(id) on delete cascade,
  role text not null,
  permission text not null,
  granted boolean not null,
  primary key (org_id, role, permission)
);

create table invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  email text not null,
  role text not null,
  project_id uuid,
  party_id uuid,
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  invited_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table support_grants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  support_user_id uuid not null references users(id),
  reason text not null,
  approved_by uuid not null references users(id),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table platform_invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  number text not null unique,
  plan_code text not null,
  plan_version int not null,
  interval text not null,
  period_start timestamptz,
  period_end timestamptz,
  subtotal_paise bigint not null,
  discount_paise bigint not null default 0,
  tax_paise bigint not null,
  total_paise bigint not null,
  coupon_code text,
  status text not null default 'issued' check (status in ('draft','issued','paid','failed','void','refunded','disputed')),
  reconciliation_ref text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create table platform_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  invoice_id uuid references platform_invoices(id),
  provider text not null,
  provider_ref text not null,
  amount_paise bigint not null,
  status text not null check (status in ('pending','succeeded','failed','refunded','disputed')),
  refunded_paise bigint not null default 0,
  failure_reason text,
  created_at timestamptz not null default now(),
  unique (provider, provider_ref)
);

create table coupons (
  code text primary key,
  percent_off int not null check (percent_off between 1 and 100),
  max_redemptions int,
  redeemed int not null default 0,
  expires_at timestamptz,
  active boolean not null default true
);

create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  type text not null,
  payload jsonb not null,
  status text not null default 'received' check (status in ('received','processed','failed')),
  attempts int not null default 0,
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, event_id)
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid,
  kind text not null,
  payload jsonb not null default '{}',
  dedupe_key text unique,
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  attempts int not null default 0,
  max_attempts int not null default 5,
  run_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index jobs_due on jobs(status, run_at);

create table email_outbox (
  id uuid primary key default gen_random_uuid(),
  to_email text not null,
  subject text not null,
  body text not null,
  org_id uuid,
  status text not null default 'queued' check (status in ('queued','sent','failed')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user on notifications(user_id, read_at);

create table audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  org_id uuid,
  actor_id uuid,
  actor_role text,
  action text not null,
  entity text,
  entity_id text,
  detail jsonb not null default '{}',   -- field names / ids / reasons only; never secrets
  ip text
);
create index audit_org_at on audit_log(org_id, at desc);

create table announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  published_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table support_tickets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id),
  user_id uuid references users(id),
  subject text not null,
  body text not null,
  status text not null default 'open' check (status in ('open','pending','resolved')),
  priority text not null default 'normal' check (priority in ('low','normal','high')),
  resolution text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table leads (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('demo','trial','contact')),
  name text not null,
  email text not null,
  company text,
  phone text,
  message text,
  created_at timestamptz not null default now()
);

create table incidents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  severity text not null check (severity in ('minor','major','critical')),
  status text not null default 'investigating' check (status in ('investigating','identified','monitoring','resolved')),
  owner text,
  notes text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table platform_settings (
  key text primary key,
  value jsonb not null
);

create table files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid,
  name text not null,
  mime text not null,
  size_bytes bigint not null,
  sha256 text not null,
  storage_key text not null unique,
  kind text not null default 'document',
  restricted boolean not null default false,
  uploaded_by uuid references users(id),
  status text not null default 'stored' check (status in ('stored','delete_pending','deleted','delete_failed')),
  created_at timestamptz not null default now()
);
create index files_org on files(org_id, project_id);

insert into plans (code, version, name, price_month_paise, price_year_paise, limits, features) values
 ('starter', 1, 'Starter', 499900, 4999000, '{"users":5,"projects":2,"storage_mb":2048,"branches":1}', '["Core project control","Daily reports","Client portal"]'),
 ('growth',  1, 'Growth',  1499900, 14999000, '{"users":25,"projects":10,"storage_mb":20480,"branches":5}', '["Everything in Starter","Procurement & stores","Subcontract billing","Variations"]'),
 ('scale',   1, 'Scale',   3999900, 39999000, '{"users":100,"projects":50,"storage_mb":204800,"branches":25}', '["Everything in Growth","Priority support","Extended retention"]');
insert into platform_settings(key,value) values ('trial_days','14'), ('grace_days','7'), ('gst_percent','18');
