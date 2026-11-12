-- Control plane: identity, tenants, subscriptions, jobs, audit. See docs/ARCHITECTURE.md
create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text not null,
  password_hash text not null,
  email_verified_at timestamptz,
  totp_secret text,
  totp_enabled boolean not null default false,
  platform_role text check (platform_role in ('owner','billing','support','tech')),
  status text not null default 'active' check (status in ('active','suspended')),
  failed_logins int not null default 0,
  locked_until timestamptz,
  notif_prefs jsonb not null default '{"email_approvals":true,"email_billing":true}',
  created_at timestamptz not null default now()
);
create unique index users_email_uq on users (lower(email));

create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'trial' check (status in ('trial','active','past_due','suspended','cancelled','closed')),
  legal_name text, gstin text, pan text, address text, phone text,
  currency text not null default 'INR',
  branding jsonb not null default '{}',
  setup jsonb not null default '{}',
  trial_ends_at timestamptz,
  suspended_reason text,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references users(id) on delete cascade,
  tenant_id uuid references tenants(id),
  mfa_ok boolean not null default false,
  ip text, user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index sessions_user_idx on sessions(user_id);

create table auth_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('verify','reset')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  key text not null,
  name text not null,
  permissions text[] not null default '{}',
  is_system boolean not null default false,
  unique (tenant_id, key),
  unique (tenant_id, id)
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role_id uuid not null,
  branch_ids uuid[],            -- null = all branches
  customer_id uuid,             -- set for customer-portal members
  status text not null default 'active' check (status in ('active','suspended','removed')),
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id),
  foreign key (tenant_id, role_id) references roles(tenant_id, id)
);

create table invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  email text not null,
  role_id uuid not null,
  branch_ids uuid[],
  customer_id uuid,
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  invited_by uuid references users(id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, role_id) references roles(tenant_id, id)
);

create table plans (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  active boolean not null default true
);
create table plan_versions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans(id),
  version int not null,
  price_monthly_paise bigint not null check (price_monthly_paise >= 0),
  price_yearly_paise bigint not null check (price_yearly_paise >= 0),
  max_users int not null,
  max_branches int not null,
  max_storage_mb int not null default 1024,
  features text[] not null default '{}',
  effective_from timestamptz not null default now(),
  retired_at timestamptz,
  unique (plan_id, version)
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  plan_version_id uuid not null references plan_versions(id),
  billing_interval text not null default 'monthly' check (billing_interval in ('monthly','yearly')),
  status text not null default 'trialing' check (status in ('trialing','active','past_due','cancelled','expired')),
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz not null,
  grace_until timestamptz,
  cancel_at_period_end boolean not null default false,
  cancelled_at timestamptz,
  pending_plan_version_id uuid references plan_versions(id),
  pending_interval text,
  created_at timestamptz not null default now()
);
create unique index subscriptions_one_live on subscriptions(tenant_id) where status in ('trialing','active','past_due');

create table platform_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  number text not null unique,
  subscription_id uuid references subscriptions(id),
  plan_version_id uuid not null references plan_versions(id),
  description text not null,
  amount_paise bigint not null,
  tax_paise bigint not null,
  total_paise bigint not null,
  status text not null default 'open' check (status in ('open','paid','failed','void','refunded')),
  period_start timestamptz, period_end timestamptz,
  due_at timestamptz not null default now(),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create table platform_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  invoice_id uuid not null references platform_invoices(id),
  provider text not null,
  provider_payment_id text,
  amount_paise bigint not null,
  status text not null check (status in ('pending','succeeded','failed','refunded','disputed')),
  failure_reason text,
  refund_reason text,
  reconciliation_ref text,
  created_at timestamptz not null default now(),
  unique (provider, provider_payment_id)
);
create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  payload jsonb not null,
  status text not null default 'received' check (status in ('received','processed','failed','ignored')),
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, event_id)
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued','running','done','failed','dead')),
  attempts int not null default 0,
  max_attempts int not null default 5,
  run_at timestamptz not null default now(),
  last_error text,
  dedupe_key text unique,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index jobs_due_idx on jobs(run_at) where status in ('queued','failed');

create table audit_log (
  id bigserial primary key,
  tenant_id uuid references tenants(id),
  actor_user_id uuid,
  actor_label text,
  action text not null,
  entity_type text,
  entity_id text,
  detail jsonb not null default '{}',
  reason text,
  created_at timestamptz not null default now()
);
create index audit_tenant_idx on audit_log(tenant_id, id desc);
create function forbid_mutation() returns trigger language plpgsql as $$
begin raise exception '% is append-only', tg_table_name using errcode = '23000'; end $$;
create trigger audit_immutable before update or delete on audit_log for each row execute function forbid_mutation();

create table support_access (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  staff_user_id uuid not null references users(id),
  reason text not null,
  status text not null default 'requested' check (status in ('requested','approved','denied','revoked')),
  decided_by uuid references users(id),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table contact_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('demo','contact','trial')),
  name text not null, email text not null, company text, phone text, message text,
  status text not null default 'new' check (status in ('new','contacted','closed')),
  created_at timestamptz not null default now()
);
create table announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null, body text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  title text not null, body text, link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create table idempotency_keys (
  key text primary key,
  created_at timestamptz not null default now()
);
create table platform_settings (key text primary key, value jsonb not null);
create table platform_coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  percent_off int not null check (percent_off between 1 and 100),
  active boolean not null default true,
  max_redemptions int,
  redeemed int not null default 0,
  created_at timestamptz not null default now()
);
