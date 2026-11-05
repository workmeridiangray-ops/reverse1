-- Subscription billing hooks, API keys, projects, people, assets & maintenance.

-- ---------------------------------------------------------------- billing
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if; end $$;
alter table public.tenants add column billing_cycle text not null default 'monthly' check (billing_cycle in ('monthly','yearly'));
alter table public.tenants add column provider_subscription_ref text;
alter table public.tenants add column past_due_since timestamptz;
create table public.provider_events (
  id text primary key, tenant_id uuid references public.tenants(id) on delete set null,
  kind text not null, payload jsonb not null default '{}', received_at timestamptz not null default now()
);
alter table public.provider_events enable row level security; -- no policies: service role only

-- Writes stay open for 7 days after a failed renewal (grace), then the workspace turns read-only.
create or replace function app.require_writable() returns void
language plpgsql stable security definer set search_path = '' as $$
declare t public.tenants;
begin
  select * into t from public.tenants where id = app.tenant_id();
  if t.id is null then raise exception 'no active workspace' using errcode = '42501'; end if;
  if t.status in ('suspended','cancelled') then raise exception 'workspace is %', t.status using errcode = '42501'; end if;
  if t.status = 'trial' and t.trial_ends_at < now() then raise exception 'trial expired: choose a plan' using errcode = '42501'; end if;
  if t.status = 'past_due' and t.past_due_since < now() - interval '7 days' then raise exception 'payment overdue: update billing to continue' using errcode = '42501'; end if;
end $$;

-- Called by the verified payment-provider webhook (service role). Idempotent on the provider event id.
create or replace function public.apply_provider_event(p_event_id text, p_kind text, p_tenant uuid, p_plan text, p_ref text, p_cycle text default 'monthly') returns boolean
language plpgsql security definer set search_path = '' as $$
declare fresh int;
begin
  insert into public.provider_events (id, tenant_id, kind, payload) values (p_event_id, p_tenant, p_kind, jsonb_build_object('plan', p_plan, 'ref', p_ref))
  on conflict (id) do nothing;
  get diagnostics fresh = row_count;
  if fresh = 0 then return false; end if;
  if p_kind = 'charged' then
    update public.tenants set plan_code = coalesce(p_plan, plan_code), status = 'active', past_due_since = null, billing_cycle = p_cycle, provider_subscription_ref = coalesce(p_ref, provider_subscription_ref) where id = p_tenant;
    insert into public.subscription_events (tenant_id, kind, plan_code, provider_ref) values (p_tenant, 'payment_succeeded', p_plan, p_ref);
  elsif p_kind = 'failed' then
    update public.tenants set status = 'past_due', past_due_since = coalesce(past_due_since, now()) where id = p_tenant and status <> 'suspended';
    insert into public.subscription_events (tenant_id, kind, plan_code, provider_ref) values (p_tenant, 'payment_failed', p_plan, p_ref);
  elsif p_kind = 'cancelled' then
    update public.tenants set status = 'cancelled' where id = p_tenant;
    insert into public.subscription_events (tenant_id, kind, provider_ref) values (p_tenant, 'cancelled', p_ref);
  else raise exception 'unknown provider event kind %', p_kind; end if;
  return true;
end $$;
revoke execute on function public.apply_provider_event(text,text,uuid,text,text,text) from public, authenticated;
grant execute on function public.apply_provider_event(text,text,uuid,text,text,text) to service_role;

-- change_plan now only moves a *paying* tenant between plans; a trial tenant must pay first
create or replace function public.change_plan(p_plan text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tenants; p public.plans; u int; b int; w int;
begin
  if not app.has_role('owner') then raise exception 'only the owner can change the plan' using errcode = '42501'; end if;
  select * into t from public.tenants where id = app.tenant_id();
  select * into p from public.plans where code = p_plan and active and code <> 'trial';
  if p.code is null then raise exception 'unknown plan'; end if;
  select count(*) into u from public.memberships where tenant_id = t.id and active;
  select count(*) into b from public.branches where tenant_id = t.id and active;
  select count(*) into w from public.warehouses where tenant_id = t.id and active;
  if u > p.max_users or b > p.max_branches or w > p.max_warehouses then
    raise exception 'downgrade blocked: % users / % branches / % warehouses exceed the % plan; deactivate the excess first', u, b, w, p.name using errcode = '53400';
  end if;
  if t.status in ('trial','past_due') then
    raise exception 'complete payment first: the plan changes when the payment provider confirms the charge' using errcode = '42501';
  end if;
  update public.tenants set plan_code = p_plan where id = t.id;
  insert into public.subscription_events (tenant_id, kind, plan_code, note) values (t.id, 'plan_changed', p_plan, 'owner changed plan');
end $$;

-- ---------------------------------------------------------------- API keys (read-only API)
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) >= 2), prefix text not null, secret_hash text not null unique,
  created_by uuid, created_at timestamptz not null default now(), revoked_at timestamptz, last_used_at timestamptz
);
create table app.api_hits (key_id uuid not null, minute timestamptz not null, n int not null default 0, primary key (key_id, minute));
alter table public.api_keys enable row level security;
alter table app.api_hits enable row level security;
create policy api_keys_read on public.api_keys for select to authenticated using (tenant_id = (select app.tenant_id()) and (select app.has_role('owner')));
grant select (id, tenant_id, name, prefix, created_at, revoked_at, last_used_at) on public.api_keys to authenticated;
create trigger audit after insert or update on public.api_keys for each row execute function app.audit();

-- Returns the secret exactly once; only its SHA-256 is stored.
create or replace function public.create_api_key(p_name text) returns text
language plpgsql security definer set search_path = '' as $$
declare s text;
begin
  perform app.require_role('owner');
  s := 'berp_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.api_keys (tenant_id, name, prefix, secret_hash, created_by)
  values (app.tenant_id(), trim(p_name), left(s, 12), encode(sha256(convert_to(s, 'utf8')), 'hex'), auth.uid());
  return s;
end $$;
create or replace function public.revoke_api_key(p_key uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_role('owner');
  update public.api_keys set revoked_at = now() where id = p_key and tenant_id = app.tenant_id() and revoked_at is null;
  if not found then raise exception 'key not found or already revoked'; end if;
end $$;

-- Service role: resolves a presented key to its tenant, enforcing revocation, tenant status and 120 requests/minute.
create or replace function public.api_resolve_key(p_secret text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare k public.api_keys; t public.tenants; m timestamptz := date_trunc('minute', now()); hits int;
begin
  select * into k from public.api_keys where secret_hash = encode(sha256(convert_to(coalesce(p_secret,''), 'utf8')), 'hex') and revoked_at is null;
  if k.id is null then raise exception 'invalid api key' using errcode = '28000'; end if;
  select * into t from public.tenants where id = k.tenant_id;
  if t.status in ('suspended','cancelled') then raise exception 'workspace is %', t.status using errcode = '42501'; end if;
  insert into app.api_hits as h (key_id, minute, n) values (k.id, m, 1) on conflict (key_id, minute) do update set n = h.n + 1 returning n into hits;
  if hits > 120 then raise exception 'rate limit exceeded' using errcode = '54000'; end if;
  update public.api_keys set last_used_at = now() where id = k.id;
  return k.tenant_id;
end $$;
revoke execute on function public.api_resolve_key(text) from public, authenticated;
grant execute on function public.api_resolve_key(text) to service_role;

-- ---------------------------------------------------------------- projects, time & expenses
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  number text not null, name text not null check (length(trim(name)) >= 2), customer_id uuid,
  budget_paise bigint not null default 0 check (budget_paise >= 0),
  status text not null default 'open' check (status in ('open','closed')),
  created_by uuid, created_at timestamptz not null default now(),
  unique (tenant_id, number), unique (tenant_id, id),
  foreign key (tenant_id, customer_id) references public.customers(tenant_id, id)
);
create table public.project_milestones (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null, project_id uuid not null, name text not null,
  amount_paise bigint not null check (amount_paise > 0), invoice_id uuid, billed_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, project_id) references public.projects(tenant_id, id) on delete cascade
);
create table public.project_time (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null, project_id uuid not null, user_id uuid not null,
  work_date date not null, hours numeric(5,2) not null check (hours > 0 and hours <= 24),
  cost_rate_paise bigint not null default 0 check (cost_rate_paise >= 0), note text not null default '',
  status text not null default 'submitted' check (status in ('submitted','approved','rejected')),
  decided_by uuid, decision_reason text,
  foreign key (tenant_id, project_id) references public.projects(tenant_id, id) on delete cascade
);
create table public.project_expenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null, project_id uuid not null, user_id uuid not null,
  spent_on date not null, amount_paise bigint not null check (amount_paise > 0), description text not null check (length(trim(description)) >= 2),
  status text not null default 'submitted' check (status in ('submitted','approved','rejected')),
  decided_by uuid, decision_reason text,
  foreign key (tenant_id, project_id) references public.projects(tenant_id, id) on delete cascade
);
create index on public.project_time (tenant_id, project_id);
create index on public.project_expenses (tenant_id, project_id);

create or replace view public.project_costs with (security_invoker = true) as
select p.tenant_id, p.id as project_id, p.number, p.name, p.budget_paise, p.status,
  coalesce((select sum(round(t.hours * t.cost_rate_paise)) from public.project_time t where t.project_id = p.id and t.status = 'approved'), 0)::bigint as labour_paise,
  coalesce((select sum(e.amount_paise) from public.project_expenses e where e.project_id = p.id and e.status = 'approved'), 0)::bigint as expense_paise,
  coalesce((select sum(m.amount_paise) from public.project_milestones m where m.project_id = p.id), 0)::bigint as milestones_paise,
  coalesce((select sum(m.amount_paise) from public.project_milestones m where m.project_id = p.id and m.invoice_id is not null), 0)::bigint as billed_paise
from public.projects p where app.has_role('owner','manager','accountant');

create or replace function public.create_project(p_name text, p_customer uuid, p_budget bigint) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); new_id uuid;
begin
  perform app.require_role('owner','manager');
  insert into public.projects (tenant_id, number, name, customer_id, budget_paise, created_by)
  values (t, app.next_number(t,'prj','PRJ'), trim(p_name), p_customer, coalesce(p_budget,0), auth.uid()) returning id into new_id;
  return new_id;
end $$;

create or replace function public.add_milestone(p_project uuid, p_name text, p_amount bigint) returns uuid
language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  perform app.require_role('owner','manager');
  insert into public.project_milestones (tenant_id, project_id, name, amount_paise) values (app.tenant_id(), p_project, trim(p_name), p_amount) returning project_milestones.id into new_id;
  return new_id;
end $$;

-- Any member logs their own time; the rate is stamped at entry and visible to managers only (see views below).
create or replace function public.log_time(p_project uuid, p_date date, p_hours numeric, p_rate bigint, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  perform app.require_writable();
  if not exists (select 1 from public.projects where id = p_project and tenant_id = app.tenant_id() and status = 'open') then raise exception 'project is not open'; end if;
  if app.role() is null then raise exception 'role not permitted' using errcode = '42501'; end if;
  insert into public.project_time (tenant_id, project_id, user_id, work_date, hours, cost_rate_paise, note)
  values (app.tenant_id(), p_project, auth.uid(), p_date, p_hours, case when app.has_role('owner','manager') then coalesce(p_rate,0) else 0 end, coalesce(p_note,'')) returning project_time.id into new_id;
  return new_id;
end $$;

create or replace function public.log_expense(p_project uuid, p_date date, p_amount bigint, p_desc text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  perform app.require_writable();
  if not exists (select 1 from public.projects where id = p_project and tenant_id = app.tenant_id() and status = 'open') then raise exception 'project is not open'; end if;
  if app.role() is null then raise exception 'role not permitted' using errcode = '42501'; end if;
  insert into public.project_expenses (tenant_id, project_id, user_id, spent_on, amount_paise, description) values (app.tenant_id(), p_project, auth.uid(), p_date, p_amount, trim(p_desc)) returning project_expenses.id into new_id;
  return new_id;
end $$;

-- Managers approve or reject; nobody approves their own entry; rejection needs a reason.
create or replace function public.decide_project_entry(p_kind text, p_id uuid, p_approve boolean, p_reason text default null, p_rate_paise bigint default null) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
  perform app.require_role('owner','manager');
  if not p_approve and (p_reason is null or length(trim(p_reason)) < 3) then raise exception 'a reason is required to reject'; end if;
  if p_kind = 'time' then
    select user_id into uid from public.project_time where id = p_id and tenant_id = app.tenant_id() and status = 'submitted';
    if uid is null then raise exception 'entry is not awaiting a decision'; end if;
    if uid = auth.uid() then raise exception 'you cannot approve your own entry' using errcode = '42501'; end if;
    update public.project_time set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decision_reason = p_reason, cost_rate_paise = case when p_approve then coalesce(p_rate_paise, cost_rate_paise) else cost_rate_paise end where id = p_id;
  elsif p_kind = 'expense' then
    select user_id into uid from public.project_expenses where id = p_id and tenant_id = app.tenant_id() and status = 'submitted';
    if uid is null then raise exception 'entry is not awaiting a decision'; end if;
    if uid = auth.uid() then raise exception 'you cannot approve your own entry' using errcode = '42501'; end if;
    update public.project_expenses set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decision_reason = p_reason where id = p_id;
  else raise exception 'unknown entry kind'; end if;
end $$;

-- Bills a milestone through the normal order → dispatch → invoice chain so tax, ledger and receivables stay consistent.
create or replace function public.bill_milestone(p_milestone uuid, p_service_item uuid, p_warehouse uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); m public.project_milestones; p public.projects; so uuid; sl uuid; inv uuid;
begin
  perform app.require_role('owner','manager','accountant');
  select * into m from public.project_milestones where id = p_milestone and tenant_id = t for update;
  if m.id is null then raise exception 'milestone not found'; end if;
  if m.invoice_id is not null then raise exception 'milestone already billed'; end if;
  select * into p from public.projects where id = m.project_id;
  if p.customer_id is null then raise exception 'the project has no customer to bill'; end if;
  if not exists (select 1 from public.items where id = p_service_item and tenant_id = t and kind = 'service') then raise exception 'choose a service item to bill against'; end if;
  so := public.create_sales_order(p.customer_id, p_warehouse, jsonb_build_array(jsonb_build_object('item_id', p_service_item, 'qty', 1, 'unit_price_paise', m.amount_paise)), 'Milestone: ' || p.number || ' ' || m.name);
  perform public.confirm_sales_order(so);
  select id into sl from public.sales_order_lines where order_id = so;
  perform public.dispatch_order(so, jsonb_build_array(jsonb_build_object('so_line_id', sl, 'qty', 1)));
  inv := public.invoice_order(so);
  update public.project_milestones set invoice_id = inv, billed_at = now() where id = m.id;
  return inv;
end $$;

create or replace function public.close_project(p_project uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_role('owner','manager');
  if exists (select 1 from public.project_time where project_id = p_project and status = 'submitted')
     or exists (select 1 from public.project_expenses where project_id = p_project and status = 'submitted') then
    raise exception 'decide all pending time and expense entries before closing';
  end if;
  update public.projects set status = 'closed' where id = p_project and tenant_id = app.tenant_id();
end $$;

-- ---------------------------------------------------------------- people
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null, full_name text not null check (length(trim(full_name)) >= 2), job_title text not null default '',
  email text, phone text, branch_id uuid, user_id uuid references auth.users(id) on delete set null,
  joined_on date not null default current_date, left_on date, notes text not null default '',
  unique (tenant_id, code), unique (tenant_id, id),
  foreign key (tenant_id, branch_id) references public.branches(tenant_id, id)
);
create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null, employee_id uuid not null,
  from_date date not null, to_date date not null, kind text not null check (kind in ('casual','sick','earned','unpaid')), reason text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by uuid, decision_reason text, created_at timestamptz not null default now(),
  check (to_date >= from_date),
  foreign key (tenant_id, employee_id) references public.employees(tenant_id, id) on delete cascade
);
alter table public.employees enable row level security;
alter table public.leave_requests enable row level security;
-- personal data: owners/managers see everyone; an employee sees only their own record and requests
create policy employees_read on public.employees for select to authenticated using (tenant_id = (select app.tenant_id()) and ((select app.has_role('owner','manager')) or user_id = (select auth.uid())));
create policy leave_read on public.leave_requests for select to authenticated using (tenant_id = (select app.tenant_id()) and ((select app.has_role('owner','manager'))
  or exists (select 1 from public.employees e where e.id = employee_id and e.user_id = (select auth.uid()))));
create policy employees_write on public.employees for insert to authenticated with check (tenant_id = (select app.tenant_id()) and (select app.has_role('owner','manager')));
create policy employees_update on public.employees for update to authenticated using (tenant_id = (select app.tenant_id()) and (select app.has_role('owner','manager'))) with check (tenant_id = (select app.tenant_id()));
grant select, insert, update on public.employees to authenticated; grant select on public.leave_requests to authenticated;
create trigger audit after insert or update on public.employees for each row execute function app.audit();
create trigger forbid_tenant_change before update on public.employees for each row execute function app.forbid_tenant_change();

create or replace function public.request_leave(p_from date, p_to date, p_kind text, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare e uuid; new_id uuid;
begin
  perform app.require_writable();
  select employees.id into e from public.employees where tenant_id = app.tenant_id() and user_id = auth.uid() and left_on is null;
  if e is null then raise exception 'your login is not linked to an employee record; ask a manager'; end if;
  if exists (select 1 from public.leave_requests where employee_id = e and status in ('pending','approved') and daterange(from_date, to_date, '[]') && daterange(p_from, p_to, '[]')) then
    raise exception 'these dates overlap an existing leave request';
  end if;
  insert into public.leave_requests (tenant_id, employee_id, from_date, to_date, kind, reason) values (app.tenant_id(), e, p_from, p_to, p_kind, coalesce(p_reason,'')) returning leave_requests.id into new_id;
  return new_id;
end $$;

create or replace function public.decide_leave(p_id uuid, p_approve boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare lr public.leave_requests; eu uuid;
begin
  perform app.require_role('owner','manager');
  select * into lr from public.leave_requests where id = p_id and tenant_id = app.tenant_id() and status = 'pending';
  if lr.id is null then raise exception 'request is not pending'; end if;
  select user_id into eu from public.employees where id = lr.employee_id;
  if eu = auth.uid() then raise exception 'you cannot decide your own leave' using errcode = '42501'; end if;
  if not p_approve and (p_reason is null or length(trim(p_reason)) < 3) then raise exception 'a reason is required to reject'; end if;
  update public.leave_requests set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decision_reason = p_reason where id = lr.id;
end $$;

-- Exit: closes the record, cancels future leave, and revokes the person's access to the workspace immediately.
create or replace function public.offboard_employee(p_employee uuid, p_last_day date) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.employees;
begin
  perform app.require_role('owner');
  select * into e from public.employees where id = p_employee and tenant_id = app.tenant_id() for update;
  if e.id is null then raise exception 'employee not found'; end if;
  if e.left_on is not null then raise exception 'already offboarded'; end if;
  if e.user_id = auth.uid() then raise exception 'you cannot offboard yourself'; end if;
  update public.employees set left_on = p_last_day where id = e.id;
  update public.leave_requests set status = 'cancelled', decision_reason = 'employee left' where employee_id = e.id and status in ('pending','approved') and from_date > p_last_day;
  if e.user_id is not null then update public.memberships set active = false where user_id = e.user_id and tenant_id = e.tenant_id; end if;
end $$;

-- ---------------------------------------------------------------- assets & maintenance
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  tag text not null, name text not null check (length(trim(name)) >= 2), category text not null default '',
  warehouse_id uuid, assigned_employee_id uuid, purchase_cost_paise bigint not null default 0 check (purchase_cost_paise >= 0),
  warranty_until date, next_service_on date, service_every_days int check (service_every_days is null or service_every_days > 0),
  status text not null default 'active' check (status in ('active','under_repair','disposed')),
  disposal_reason text, created_at timestamptz not null default now(),
  unique (tenant_id, tag), unique (tenant_id, id),
  foreign key (tenant_id, warehouse_id) references public.warehouses(tenant_id, id),
  foreign key (tenant_id, assigned_employee_id) references public.employees(tenant_id, id)
);
create table public.work_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  number text not null, asset_id uuid not null, kind text not null check (kind in ('breakdown','scheduled')),
  description text not null check (length(trim(description)) >= 3),
  status text not null default 'open' check (status in ('open','done')),
  spare_item_id uuid, spare_qty numeric(14,3) check (spare_qty is null or spare_qty > 0), labour_cost_paise bigint not null default 0 check (labour_cost_paise >= 0),
  report text, opened_by uuid, opened_at timestamptz not null default now(), closed_at timestamptz,
  unique (tenant_id, number), unique (tenant_id, id),
  foreign key (tenant_id, asset_id) references public.assets(tenant_id, id)
);
alter table public.assets enable row level security;
alter table public.work_orders enable row level security;
alter table public.projects enable row level security; alter table public.project_milestones enable row level security;
alter table public.project_time enable row level security; alter table public.project_expenses enable row level security;
create policy assets_read on public.assets for select to authenticated using (tenant_id = (select app.tenant_id()));
create policy wo_read on public.work_orders for select to authenticated using (tenant_id = (select app.tenant_id()));
create policy projects_read on public.projects for select to authenticated using (tenant_id = (select app.tenant_id()));
create policy milestones_read on public.project_milestones for select to authenticated using (tenant_id = (select app.tenant_id()));
-- time/expense: managers see all, everyone else sees only their own entries
create policy ptime_read on public.project_time for select to authenticated using (tenant_id = (select app.tenant_id()) and ((select app.has_role('owner','manager','accountant')) or user_id = (select auth.uid())));
create policy pexp_read on public.project_expenses for select to authenticated using (tenant_id = (select app.tenant_id()) and ((select app.has_role('owner','manager','accountant')) or user_id = (select auth.uid())));
grant select on public.assets, public.work_orders, public.projects, public.project_milestones, public.project_time, public.project_expenses, public.project_costs to authenticated;
create trigger audit after insert or update on public.assets for each row execute function app.audit();
create trigger audit after insert or update on public.projects for each row execute function app.audit();

create or replace function public.register_asset(p_tag text, p_name text, p_category text, p_warehouse uuid, p_cost bigint, p_warranty date, p_service_days int) returns uuid
language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  perform app.require_role('owner','manager');
  insert into public.assets (tenant_id, tag, name, category, warehouse_id, purchase_cost_paise, warranty_until, service_every_days, next_service_on)
  values (app.tenant_id(), trim(p_tag), trim(p_name), coalesce(p_category,''), p_warehouse, coalesce(p_cost,0), p_warranty, p_service_days, case when p_service_days is null then null else current_date + p_service_days end)
  returning assets.id into new_id;
  return new_id;
end $$;

create or replace function public.assign_asset(p_asset uuid, p_employee uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_role('owner','manager');
  update public.assets set assigned_employee_id = p_employee where id = p_asset and tenant_id = app.tenant_id() and status <> 'disposed';
  if not found then raise exception 'asset not found or disposed'; end if;
end $$;

create or replace function public.open_work_order(p_asset uuid, p_kind text, p_desc text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); new_id uuid;
begin
  perform app.require_role('owner','manager','warehouse');
  if not exists (select 1 from public.assets where id = p_asset and tenant_id = t and status <> 'disposed') then raise exception 'asset not found or disposed'; end if;
  insert into public.work_orders (tenant_id, number, asset_id, kind, description, opened_by) values (t, app.next_number(t,'wo','WO'), p_asset, p_kind, trim(p_desc), auth.uid()) returning work_orders.id into new_id;
  if p_kind = 'breakdown' then update public.assets set status = 'under_repair' where id = p_asset; end if;
  return new_id;
end $$;

-- Closing consumes the spare from stock and posts maintenance expense (spares at cost + labour).
create or replace function public.close_work_order(p_wo uuid, p_report text, p_spare_item uuid, p_spare_qty numeric, p_warehouse uuid, p_labour bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); w public.work_orders; a public.assets; it public.items; spares bigint := 0; labour bigint := coalesce(p_labour,0); onhand numeric; res numeric; mv uuid;
begin
  perform app.require_role('owner','manager','warehouse');
  if p_report is null or length(trim(p_report)) < 3 then raise exception 'a service report is required'; end if;
  select * into w from public.work_orders where id = p_wo and tenant_id = t for update;
  if w.id is null then raise exception 'work order not found'; end if;
  if w.status = 'done' then raise exception 'work order already closed'; end if;
  select * into a from public.assets where id = w.asset_id;
  insert into public.accounts (tenant_id, code, name, type, system_key) values (t, '5100', 'Maintenance expense', 'expense', 'maintenance') on conflict do nothing;
  if p_spare_item is not null then
    select * into it from public.items where id = p_spare_item and tenant_id = t and kind = 'stock';
    if it.id is null then raise exception 'unknown spare item'; end if;
    perform pg_advisory_xact_lock(hashtextextended(t::text, 7));
    select coalesce(sum(qty),0) into onhand from public.stock_movements where tenant_id = t and item_id = it.id and warehouse_id = p_warehouse;
    select coalesce(sum(qty),0) into res from public.reservations where tenant_id = t and item_id = it.id and warehouse_id = p_warehouse;
    if onhand - res < p_spare_qty then raise exception 'not enough free stock of % for this spare', it.sku using errcode = '23514'; end if;
    mv := gen_random_uuid();
    insert into public.stock_movements (id, tenant_id, item_id, warehouse_id, qty, kind, unit_cost_paise, ref_type, ref_id, reason, created_by)
    values (mv, t, it.id, p_warehouse, -p_spare_qty, 'adjustment', it.cost_paise, 'work_order', w.id, 'Spare for ' || w.number, auth.uid());
    spares := round(p_spare_qty * it.cost_paise)::bigint;
  end if;
  if spares + labour > 0 then
    perform app.post_journal(t, current_date, 'Maintenance ' || w.number, 'work_order', w.id, jsonb_build_array(
      jsonb_build_object('key','maintenance','debit', spares + labour),
      jsonb_build_object('key','inventory','credit', spares), jsonb_build_object('key','bank','credit', labour)));
  end if;
  update public.work_orders set status = 'done', report = trim(p_report), spare_item_id = p_spare_item, spare_qty = p_spare_qty, labour_cost_paise = labour, closed_at = now() where id = w.id;
  update public.assets set status = 'active', next_service_on = case when service_every_days is null then null else current_date + service_every_days end where id = w.asset_id and status = 'under_repair';
  update public.assets set next_service_on = case when service_every_days is null then next_service_on else current_date + service_every_days end where id = w.asset_id;
end $$;

create or replace function public.dispose_asset(p_asset uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_role('owner');
  if p_reason is null or length(trim(p_reason)) < 5 then raise exception 'a disposal reason is required'; end if;
  if exists (select 1 from public.work_orders where asset_id = p_asset and status = 'open') then raise exception 'close open work orders before disposal'; end if;
  update public.assets set status = 'disposed', disposal_reason = trim(p_reason), assigned_employee_id = null where id = p_asset and tenant_id = app.tenant_id() and status <> 'disposed';
  if not found then raise exception 'asset not found or already disposed'; end if;
end $$;

revoke all on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.apply_provider_event(text,text,uuid,text,text,text), public.api_resolve_key(text) from authenticated;
grant execute on function public.apply_provider_event(text,text,uuid,text,text,text), public.api_resolve_key(text) to service_role;
revoke execute on all functions in schema app from public, anon, authenticated;
grant execute on function app.tenant_id(), app.role(), app.has_role(public.app_role[]), app.is_platform_admin() to authenticated;
grant usage on schema public to service_role; grant usage on schema app to service_role;
