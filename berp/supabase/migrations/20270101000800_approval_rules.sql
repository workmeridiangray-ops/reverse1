-- Approval rules: bounded, effective-dated amount thresholds that route sales orders and purchase requests
-- to a manager or owner. Routing is stamped on each request, so later rule changes never re-route open ones.

create table public.approval_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  subject text not null check (subject in ('sales_order','purchase_request')),
  min_amount_paise bigint not null check (min_amount_paise > 0),
  approver_role public.app_role not null check (approver_role in ('manager','owner')),
  effective_from date not null default current_date,
  active boolean not null default true,
  created_by uuid, created_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index approval_rule_unique on public.approval_rules (tenant_id, subject, min_amount_paise, effective_from) where active;

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  subject text not null check (subject in ('sales_order','purchase_request')),
  subject_id uuid not null, amount_paise bigint not null,
  required_role public.app_role not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by uuid not null, decided_by uuid, decision_reason text,
  created_at timestamptz not null default now(), decided_at timestamptz,
  unique (tenant_id, id)
);
create unique index approval_one_pending on public.approvals (tenant_id, subject, subject_id) where status = 'pending';
create index on public.approvals (tenant_id, subject, subject_id);

alter table public.approval_rules enable row level security;
alter table public.approvals enable row level security;
grant select on public.approval_rules, public.approvals to authenticated;
create policy rules_read on public.approval_rules for select to authenticated using (tenant_id = (select app.tenant_id()));
create policy approvals_read on public.approvals for select to authenticated using (tenant_id = (select app.tenant_id()));
create trigger forbid_tenant_change before update on public.approvals for each row execute function app.forbid_tenant_change();
create trigger audit after insert or update on public.approval_rules for each row execute function app.audit();
create trigger audit after insert or update on public.approvals for each row execute function app.audit();

-- the role needed for this amount today (highest threshold at or below it), or null when nothing is required
create or replace function app.required_role(p_tenant uuid, p_subject text, p_amount bigint) returns public.app_role
language sql stable security definer set search_path = '' as $$
  select approver_role from public.approval_rules
  where tenant_id = p_tenant and subject = p_subject and active and effective_from <= current_date and min_amount_paise <= p_amount
  order by min_amount_paise desc limit 1
$$;

create or replace function app.role_satisfies(p_have public.app_role, p_need public.app_role) returns boolean
language sql immutable as $$ select p_have = 'owner' or p_have = p_need $$;

-- Gate used inside confirm_sales_order / approve_purchase_request.
create or replace function app.require_approved(p_subject text, p_id uuid, p_amount bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); need public.app_role;
begin
  need := app.required_role(t, p_subject, p_amount);
  if need is null then return; end if;
  if app.role_satisfies(app.role(), need) then return; end if;  -- the approver can act directly
  if exists (select 1 from public.approvals where tenant_id = t and subject = p_subject and subject_id = p_id and status = 'approved' and amount_paise >= p_amount) then return; end if;
  raise exception 'approval required: amounts of this size need a % (this one is %). Request approval first.', need, p_amount using errcode = '42501';
end $$;

create or replace function public.request_approval(p_subject text, p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); amt bigint; need public.app_role; a uuid;
begin
  perform app.require_role('owner','manager','sales','purchasing');
  if p_subject = 'sales_order' then
    select app.order_total(id) into amt from public.sales_orders where id = p_id and tenant_id = t and status = 'draft';
  elsif p_subject = 'purchase_request' then
    select round(r.qty * i.cost_paise)::bigint into amt from public.purchase_requests r join public.items i on i.id = r.item_id where r.id = p_id and r.tenant_id = t and r.status = 'pending';
  else raise exception 'unknown subject'; end if;
  if amt is null then raise exception 'nothing to approve: record not found or not awaiting approval'; end if;
  need := app.required_role(t, p_subject, amt);
  if need is null then raise exception 'no approval is required for this amount'; end if;
  insert into public.approvals (tenant_id, subject, subject_id, amount_paise, required_role, requested_by) values (t, p_subject, p_id, amt, need, auth.uid()) returning id into a;
  return a;
end $$;

create or replace function public.decide_approval(p_id uuid, p_approve boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); a public.approvals;
begin
  perform app.require_writable();
  select * into a from public.approvals where id = p_id and tenant_id = t and status = 'pending' for update;
  if a.id is null then raise exception 'approval is not pending'; end if;
  if not app.role_satisfies(app.role(), a.required_role) then raise exception 'this approval needs a %', a.required_role using errcode = '42501'; end if;
  if a.requested_by = auth.uid() then raise exception 'you cannot approve your own request' using errcode = '42501'; end if;
  if not p_approve and (p_reason is null or length(trim(p_reason)) < 3) then raise exception 'a reason is required to reject'; end if;
  update public.approvals set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decision_reason = nullif(trim(coalesce(p_reason,'')),''), decided_at = now() where id = a.id;
end $$;

-- Rules: owner only. Refuses a rule nobody could ever approve.
create or replace function public.save_approval_rule(p_subject text, p_min bigint, p_role public.app_role, p_from date default current_date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); new_id uuid;
begin
  perform app.require_role('owner');
  if p_role not in ('manager','owner') then raise exception 'approver must be a manager or owner'; end if;
  if p_role = 'manager' and not exists (select 1 from public.memberships where tenant_id = t and role = 'manager' and active) then
    raise exception 'no active manager exists to approve this; add one first';
  end if;
  insert into public.approval_rules (tenant_id, subject, min_amount_paise, approver_role, effective_from, created_by)
  values (t, p_subject, p_min, p_role, p_from, auth.uid()) returning approval_rules.id into new_id;
  return new_id;
end $$;

create or replace function public.deactivate_approval_rule(p_rule uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_role('owner');
  update public.approval_rules set active = false where id = p_rule and tenant_id = app.tenant_id() and active;
  if not found then raise exception 'rule not found'; end if;
end $$;

-- gates added to the two functions below
create or replace function public.confirm_sales_order(p_order uuid, p_override_reason text default null)
returns table (line_id uuid, item_id uuid, shortage numeric)
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); o public.sales_orders; c public.customers; tn public.tenants; l record;
        avail numeric; need numeric; take numeric; limit_paise bigint; exposure bigint;
begin
  perform app.require_role('owner','manager','sales');
  select * into o from public.sales_orders where id = p_order and tenant_id = t for update;
  if o.id is null then raise exception 'order not found'; end if;
  if o.status <> 'draft' then raise exception 'only a draft order can be confirmed (status: %)', o.status; end if;
  perform app.require_approved('sales_order', o.id, app.order_total(o.id));
  select * into tn from public.tenants where id = t;
  select * into c from public.customers where id = o.customer_id and tenant_id = t;
  if not c.active then raise exception 'customer is inactive'; end if;
  if tn.credit_check then
    limit_paise := c.credit_limit_paise;
    exposure := app.customer_outstanding(t, o.customer_id) + app.order_total(o.id);
    if limit_paise is not null and exposure > limit_paise then
      if p_override_reason is null or length(trim(p_override_reason)) < 5 then
        raise exception 'credit limit exceeded (exposure % > limit %): a reason is required' , exposure, limit_paise using errcode = '23514';
      end if;
      if not app.has_role('owner','manager') then raise exception 'only a manager can override the credit limit' using errcode = '42501'; end if;
      update public.sales_orders set credit_override_reason = trim(p_override_reason) where id = o.id;
    end if;
  end if;
  -- serialise reservations per tenant so two orders cannot both take the last unit
  perform pg_advisory_xact_lock(hashtextextended(t::text, 7));
  for l in select sl.id, sl.item_id, sl.qty from public.sales_order_lines sl join public.items i on i.id = sl.item_id and i.kind = 'stock'
           where sl.order_id = o.id order by sl.line_no loop
    select coalesce(sum(m.qty),0) - coalesce((select sum(r.qty) from public.reservations r where r.tenant_id = t and r.item_id = l.item_id and r.warehouse_id = o.warehouse_id),0)
      into avail from public.stock_movements m where m.tenant_id = t and m.item_id = l.item_id and m.warehouse_id = o.warehouse_id;
    take := greatest(least(avail, l.qty), 0);
    if take > 0 then
      insert into public.reservations (tenant_id, so_line_id, item_id, warehouse_id, qty) values (t, l.id, l.item_id, o.warehouse_id, take);
    end if;
    if l.qty - take > 0 then line_id := l.id; item_id := l.item_id; shortage := l.qty - take; return next; end if;
  end loop;
  update public.sales_orders set status = 'confirmed' where id = o.id;
end $$;

create or replace function public.approve_purchase_request(p_request uuid, p_supplier uuid, p_unit_cost_paise bigint) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); r public.purchase_requests; po uuid; rate int;
begin
  perform app.require_role('owner','manager','purchasing');
  select * into r from public.purchase_requests where id = p_request and tenant_id = t for update;
  if r.id is null or r.status <> 'pending' then raise exception 'request is not pending'; end if;
  perform app.require_approved('purchase_request', r.id, round(r.qty * p_unit_cost_paise)::bigint);
  select coalesce(tc.rate_bp,0) into rate from public.items i left join public.tax_codes tc on tc.id = i.tax_code_id and tc.tenant_id = i.tenant_id where i.id = r.item_id;
  insert into public.purchase_orders (tenant_id, number, supplier_id, warehouse_id, request_id, created_by)
  values (t, app.next_number(t,'po','PO'), p_supplier, r.warehouse_id, r.id, auth.uid()) returning id into po;
  insert into public.purchase_order_lines (tenant_id, po_id, item_id, qty, unit_cost_paise, tax_rate_bp) values (t, po, r.item_id, r.qty, p_unit_cost_paise, coalesce(rate,0));
  update public.purchase_requests set status = 'approved', decided_by = auth.uid() where id = r.id;
  return po;
end $$;

revoke all on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.apply_provider_event(text,text,uuid,text,text,text), public.api_resolve_key(text) from authenticated;
grant execute on function public.apply_provider_event(text,text,uuid,text,text,text), public.api_resolve_key(text) to service_role;
revoke execute on all functions in schema app from public, anon, authenticated;
grant execute on function app.tenant_id(), app.role(), app.has_role(public.app_role[]), app.is_platform_admin() to authenticated;
