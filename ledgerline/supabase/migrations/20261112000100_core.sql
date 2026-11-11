-- Ledgerline core schema. Tenant isolation and role access are enforced by Postgres, not by the browser.
create extension if not exists pgcrypto;

create table public.tenants (id text primary key, name text not null, created_at timestamptz not null default now());

-- Real table (not a client-writable record): membership and role decide everything else.
create table public.members (
  id text primary key,
  tenant_id text not null references public.tenants(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  name text not null,
  role text not null check (role in ('owner','manager','staff')),
  status text not null default 'invited' check (status in ('invited','active','suspended')),
  branch_id text,
  title text,
  mfa boolean not null default false,
  suspend_reason text,
  created_at timestamptz not null default now(),
  unique (tenant_id, email)
);
create index members_user on public.members(user_id) where user_id is not null;

-- Customer portal users: one organisation each, revocable.
create table public.portal_users (
  tenant_id text not null references public.tenants(id) on delete cascade,
  customer_id text not null,
  email text not null,
  user_id uuid references auth.users(id) on delete set null,
  active boolean not null default true,
  primary key (tenant_id, customer_id, email)
);
create index portal_user on public.portal_users(user_id) where user_id is not null;

create table public.platform_staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  name text not null,
  role text not null check (role in ('platform_owner','platform_billing','platform_support','platform_techops')),
  active boolean not null default true
);

-- Every business document lives here, one row per record, keyed by tenant + collection + id.
create table public.records (
  tenant_id text not null references public.tenants(id) on delete cascade,
  collection text not null check (collection ~ '^[A-Za-z_]{2,40}$'),
  id text not null check (length(id) between 1 and 80),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (tenant_id, collection, id)
);
create index records_coll on public.records(tenant_id, collection);

-- Platform-level records (plans, businesses, tickets...). Never visible to tenants.
create table public.platform_records (
  collection text not null check (collection ~ '^[A-Za-z_]{2,40}$'),
  id text not null,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

-- ---------- uniqueness that must hold regardless of client behaviour ----------
create unique index uq_doc_number on public.records (tenant_id, collection, (data->>'number'))
  where collection in ('invoices','receipts','quotes','credits') and coalesce(data->>'number','') <> '';
create unique index uq_receipt_ref on public.records (tenant_id, (data->>'ref'))
  where collection = 'receipts' and coalesce(data->>'ref','') <> '';
create unique index uq_receipt_event on public.records (tenant_id, (data->>'providerEventId'))
  where collection = 'receipts' and coalesce(data->>'providerEventId','') <> '';
create unique index uq_bill_ref on public.records (tenant_id, (data->>'supplierId'), lower(btrim(data->>'ref')))
  where collection = 'bills';

-- ---------- identity helpers (security definer so policies can read membership safely) ----------
create or replace function public.member_role(t text) returns text language sql stable security definer set search_path = public as $$
  select role from public.members where tenant_id = t and user_id = auth.uid() and status = 'active' limit 1 $$;
create or replace function public.portal_customer(t text) returns text language sql stable security definer set search_path = public as $$
  select customer_id from public.portal_users where tenant_id = t and user_id = auth.uid() and active limit 1 $$;
create or replace function public.platform_role() returns text language sql stable security definer set search_path = public as $$
  select role from public.platform_staff where user_id = auth.uid() and active $$;

-- Collections a staff member must never read or write.
create or replace function public.staff_read_denied(c text) returns boolean language sql immutable as $$
  select c in ('apiKeys','integrations','bankTx','bills','supplierPayments','suppliers','subscriptions','subInvoices','paymentMethods','exports','reconciliations','supportAccess','webhookLogs','roleDefs_admin') $$;
create or replace function public.staff_write_allowed(c text) returns boolean language sql immutable as $$
  select c in ('invoices','quotes','receipts','allocations','customers','contacts','contactLog','promises','reminderLog','expenses','disputes','disputeEvents','savedViews','notifications','messages','paymentLinks','credits','importRows','imports','sessions','paymentAttempts') $$;

create or replace function public.customer_can_read(t text, c text, rid text, d jsonb) returns boolean language plpgsql stable security definer set search_path = public as $$
declare pc text := public.portal_customer(t);
begin
  if pc is null then return false; end if;
  if c in ('invoices') then return d->>'customerId' = pc and coalesce(d->>'status','') not in ('draft','pending_approval'); end if;
  if c in ('receipts','credits','disputes','messages','quotes','schedules','contacts','promises') then return d->>'customerId' = pc; end if;
  if c = 'customers' then return rid = pc; end if;
  if c = 'allocations' then
    return exists (select 1 from public.records i where i.tenant_id = t and i.collection = 'invoices' and i.id = d->>'invoiceId' and i.data->>'customerId' = pc);
  end if;
  return false;
end $$;

alter table public.tenants enable row level security;
alter table public.members enable row level security;
alter table public.portal_users enable row level security;
alter table public.platform_staff enable row level security;
alter table public.records enable row level security;
alter table public.platform_records enable row level security;

create policy tenants_read on public.tenants for select to authenticated using (public.member_role(id) is not null or public.portal_customer(id) is not null or public.platform_role() is not null);

create policy members_read on public.members for select to authenticated using (user_id = auth.uid() or public.member_role(tenant_id) is not null or public.platform_role() = 'platform_owner');
create policy members_write on public.members for all to authenticated using (public.member_role(tenant_id) = 'owner') with check (public.member_role(tenant_id) = 'owner');

create policy portal_read on public.portal_users for select to authenticated using (user_id = auth.uid() or public.member_role(tenant_id) in ('owner','manager'));
create policy portal_write on public.portal_users for all to authenticated using (public.member_role(tenant_id) in ('owner','manager')) with check (public.member_role(tenant_id) in ('owner','manager'));

create policy staff_self on public.platform_staff for select to authenticated using (user_id = auth.uid() or public.platform_role() = 'platform_owner');
create policy staff_manage on public.platform_staff for all to authenticated using (public.platform_role() = 'platform_owner') with check (public.platform_role() = 'platform_owner');

create policy rec_read on public.records for select to authenticated using (
  case public.member_role(tenant_id)
    when 'owner' then true when 'manager' then true
    when 'staff' then not public.staff_read_denied(collection)
    else public.customer_can_read(tenant_id, collection, id, data) end);
create policy rec_insert on public.records for insert to authenticated with check (
  case public.member_role(tenant_id)
    when 'owner' then true when 'manager' then true
    when 'staff' then public.staff_write_allowed(collection) or collection = 'audit'
    else (public.portal_customer(tenant_id) is not null and collection in ('messages','disputes','disputeEvents')
          and data->>'customerId' = public.portal_customer(tenant_id)) end);
create policy rec_update on public.records for update to authenticated
  using (case public.member_role(tenant_id) when 'owner' then true when 'manager' then true when 'staff' then public.staff_write_allowed(collection) else false end)
  with check (case public.member_role(tenant_id) when 'owner' then true when 'manager' then true when 'staff' then public.staff_write_allowed(collection) else false end);
create policy rec_delete on public.records for delete to authenticated
  using (case public.member_role(tenant_id) when 'owner' then true when 'manager' then true when 'staff' then public.staff_write_allowed(collection) and collection not in ('allocations','receipts','credits') else false end);

-- Platform data: staff only, narrowed by role.
create policy plat_read on public.platform_records for select to authenticated using (public.platform_role() is not null or collection = 'plans' or collection = 'announcements');
create policy plat_write on public.platform_records for all to authenticated
  using (public.platform_role() = 'platform_owner' or (public.platform_role() = 'platform_billing' and collection in ('plans','coupons','platformPayments','platformRefunds','biz')) or (public.platform_role() = 'platform_support' and collection in ('tickets','biz')) or (public.platform_role() = 'platform_techops' and collection in ('jobs','incidents','storageStats','deletionFailures','processingFailures')))
  with check (public.platform_role() = 'platform_owner' or (public.platform_role() = 'platform_billing' and collection in ('plans','coupons','platformPayments','platformRefunds','biz')) or (public.platform_role() = 'platform_support' and collection in ('tickets','biz')) or (public.platform_role() = 'platform_techops' and collection in ('jobs','incidents','storageStats','deletionFailures','processingFailures')));

grant select, insert, update, delete on public.tenants, public.members, public.portal_users, public.platform_staff, public.records, public.platform_records to authenticated;
revoke all on public.tenants, public.members, public.portal_users, public.platform_staff, public.records, public.platform_records from anon;
