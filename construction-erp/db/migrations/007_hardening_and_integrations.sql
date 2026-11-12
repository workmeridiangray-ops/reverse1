-- Identity tables: only the trusted server (system) or the owner of the row may touch them.
alter table users enable row level security;
create policy u_sel on users for select using (id = app_user() or app_role() in ('system','platform') or exists (select 1 from memberships m where m.user_id = users.id and m.org_id = app_org()));
create policy u_mod on users for all using (id = app_user() or app_role() = 'system') with check (id = app_user() or app_role() = 'system');
alter table sessions enable row level security;
create policy s_all on sessions for all using (app_role() = 'system' or user_id = app_user()) with check (app_role() = 'system' or user_id = app_user());
alter table email_tokens enable row level security;
create policy et_all on email_tokens for all using (app_role() = 'system') with check (app_role() = 'system');
alter table login_attempts enable row level security;
create policy la_all on login_attempts for all using (app_role() = 'system') with check (app_role() = 'system');
alter table idempotency_keys enable row level security;
create policy ik_all on idempotency_keys for all using (user_id = app_user() or app_role() = 'system') with check (user_id = app_user() or app_role() = 'system');
alter table coupons enable row level security;
create policy cp_sel on coupons for select using (true);
create policy cp_mod on coupons for all using (app_role() in ('platform','system')) with check (app_role() in ('platform','system'));
alter table incidents enable row level security;
create policy in_all on incidents for all using (app_role() in ('platform','system')) with check (app_role() in ('platform','system'));
alter table announcements enable row level security;
create policy an_sel on announcements for select using (published_at is not null or app_role() in ('platform','system'));
create policy an_mod on announcements for all using (app_role() in ('platform','system')) with check (app_role() in ('platform','system'));
alter table leads enable row level security;
create policy ld_ins on leads for insert with check (true);
create policy ld_sel on leads for select using (app_role() in ('platform','system'));
alter table platform_settings enable row level security;
create policy ps_sel on platform_settings for select using (true);
create policy ps_mod on platform_settings for all using (app_role() in ('platform','system')) with check (app_role() in ('platform','system'));
alter table plans enable row level security;
create policy pl_sel on plans for select using (true);
create policy pl_mod on plans for all using (app_role() in ('platform','system')) with check (app_role() in ('platform','system'));

create table saved_views (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  scope text not null, name text not null, query text not null,
  created_at timestamptz not null default now(), unique (user_id, scope, name)
);
alter table saved_views enable row level security;
create policy sv_all on saved_views for all using (org_id = app_org() and user_id = app_user()) with check (org_id = app_org() and user_id = app_user());

create table api_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null, prefix text not null, key_hash text not null unique,
  scopes text[] not null default '{read}', created_by uuid references users(id),
  last_used_at timestamptz, revoked_at timestamptz, created_at timestamptz not null default now()
);
alter table api_keys enable row level security;
create policy ak_sel on api_keys for select using (org_id = app_org() and app_role() in ('owner','manager') or app_role() = 'system');
create policy ak_mod on api_keys for all using (org_id = app_org() and app_role() = 'owner' or app_role() = 'system') with check (org_id = app_org() or app_role() = 'system');

create table webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  url text not null, secret text not null, events text[] not null default '{*}', active boolean not null default true,
  created_at timestamptz not null default now()
);
create table webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  endpoint_id uuid not null references webhook_endpoints(id) on delete cascade,
  event text not null, payload jsonb not null,
  status text not null default 'queued' check (status in ('queued','delivered','failed')),
  attempts int not null default 0, response_code int, last_error text,
  created_at timestamptz not null default now(), delivered_at timestamp with time zone
);
alter table webhook_endpoints enable row level security;
create policy we_all on webhook_endpoints for all using (org_id = app_org() and app_role() in ('owner','manager') or app_role() = 'system') with check (org_id = app_org() or app_role() = 'system');
alter table webhook_deliveries enable row level security;
create policy wd_all on webhook_deliveries for all using (org_id = app_org() and app_role() in ('owner','manager') or app_role() = 'system') with check (org_id = app_org() or app_role() = 'system');

grant select, insert, update, delete on saved_views, api_keys, webhook_endpoints, webhook_deliveries to erp_app;
