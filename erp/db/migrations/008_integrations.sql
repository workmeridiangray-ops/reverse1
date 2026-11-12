create table api_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null, prefix text not null, key_hash text not null unique,
  scopes text[] not null default '{read}', created_by uuid, last_used_at timestamptz, revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create table webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  url text not null, secret text not null, events text[] not null default '{*}', active boolean not null default true,
  created_at timestamptz not null default now()
);
create table webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  endpoint_id uuid not null references webhook_endpoints(id) on delete cascade,
  event_type text not null, payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','delivered','failed')),
  attempts int not null default 0, last_status int, last_error text,
  created_at timestamptz not null default now(), delivered_at timestamptz
);
create table closure_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  requested_by uuid not null, reason text, status text not null default 'requested' check (status in ('requested','exported','cancelled','completed')),
  created_at timestamptz not null default now()
);
create table import_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  kind text not null, filename text, rows_total int not null, rows_ok int not null, rows_failed int not null, errors jsonb not null default '[]',
  created_by uuid, created_at timestamptz not null default now()
);
do $$ declare t text; begin
  foreach t in array array['api_keys','webhook_endpoints','webhook_deliveries','closure_requests','import_batches'] loop
    execute format('alter table %I enable row level security', t); execute format('alter table %I force row level security', t);
    execute format('create policy tenant_only on %I using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', t);
    execute format('grant select, insert, update, delete on %I to erp_app', t);
  end loop; end $$;
-- API-key lookup happens before a tenant is known: allow it through a narrow definer function
create function api_key_lookup(p_hash text) returns table(tenant_id uuid, key_id uuid, scopes text[]) language sql security definer set search_path = public as
$$ select tenant_id, id, scopes from api_keys where key_hash = p_hash and revoked_at is null $$;
grant execute on function api_key_lookup(text) to erp_app;
-- jobs for webhook delivery and cron run in system mode over many tenants
create policy webhook_system on webhook_deliveries using (current_setting('app.system', true) = 'on') with check (current_setting('app.system', true) = 'on');
create policy webhook_ep_system on webhook_endpoints using (current_setting('app.system', true) = 'on') with check (current_setting('app.system', true) = 'on');
