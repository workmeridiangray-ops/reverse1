-- Credit notes & customer returns, warehouse transfers, ageing/valuation/margin reports.

alter table public.customers add column payment_terms_days int not null default 30 check (payment_terms_days between 0 and 365);
alter table public.invoices add column credited_paise bigint not null default 0 check (credited_paise >= 0);
alter table public.invoices add constraint invoice_settled_within_total check (paid_paise + credited_paise <= total_paise);
alter table public.invoice_lines add column cogs_paise bigint not null default 0;
alter table public.supplier_bills add column due_days int not null default 30;

-- cost of goods behind each invoiced line = dispatch cost of that order line (basis for margin reports)
create or replace function app.set_line_cogs() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select round(new.qty * coalesce(avg(unit_cost_paise), 0))::bigint into new.cogs_paise from public.dispatch_lines where so_line_id = new.so_line_id;
  return new;
end $$;
create trigger set_cogs before insert on public.invoice_lines for each row execute function app.set_line_cogs();

-- stock kinds & duplicate-post guard
alter table public.stock_movements drop constraint stock_movements_kind_check;
alter table public.stock_movements add constraint stock_movements_kind_check
  check (kind in ('receipt','dispatch','adjustment','customer_return','transfer_out','transfer_in','reversal'));
drop index public.stock_no_duplicate_post;
create unique index stock_no_duplicate_post on public.stock_movements (tenant_id, ref_type, ref_line_id, kind)
  where ref_line_id is not null and kind in ('receipt','dispatch','customer_return','transfer_out','transfer_in');

-- ---------------------------------------------------------------- credit notes
create table public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  number text not null, invoice_id uuid not null, customer_id uuid not null,
  reason text not null check (length(trim(reason)) >= 3),
  restocked boolean not null,
  subtotal_paise bigint not null, tax_paise bigint not null, total_paise bigint not null,
  created_by uuid, created_at timestamptz not null default now(),
  unique (tenant_id, number), unique (tenant_id, id),
  foreign key (tenant_id, invoice_id) references public.invoices(tenant_id, id)
);
create table public.credit_note_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null, credit_note_id uuid not null, invoice_line_id uuid not null,
  qty numeric(14,3) not null check (qty > 0), net_paise bigint not null, tax_paise bigint not null,
  foreign key (tenant_id, credit_note_id) references public.credit_notes(tenant_id, id),
  foreign key (invoice_line_id) references public.invoice_lines(id)
);
create trigger immutable before update or delete on public.credit_notes for each row execute function app.immutable();
create trigger immutable before update or delete on public.credit_note_lines for each row execute function app.immutable();
create trigger forbid_tenant_change before update on public.credit_notes for each row execute function app.forbid_tenant_change();
create trigger audit after insert on public.credit_notes for each row execute function app.audit();

-- p_lines: [{invoice_line_id, qty}]. Returned quantity can never exceed what was invoiced and not yet credited.
create or replace function public.create_credit_note(p_invoice uuid, p_lines jsonb, p_reason text, p_restock boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); inv public.invoices; cn uuid; l jsonb; il public.invoice_lines; q numeric; already numeric;
        net bigint; tx bigint; sub bigint := 0; taxt bigint := 0; cost bigint := 0; wh uuid; it public.items; unit_cost bigint; cnl uuid; total bigint;
begin
  perform app.require_role('owner','manager','accountant');
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'a reason is required for a credit note'; end if;
  select * into inv from public.invoices where id = p_invoice and tenant_id = t for update;
  if inv.id is null then raise exception 'invoice not found'; end if;
  select warehouse_id into wh from public.sales_orders where id = inv.order_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    q := (l->>'qty')::numeric;
    select * into il from public.invoice_lines where id = (l->>'invoice_line_id')::uuid and invoice_id = inv.id and tenant_id = t;
    if il.id is null then raise exception 'line does not belong to this invoice'; end if;
    select coalesce(sum(qty),0) into already from public.credit_note_lines where invoice_line_id = il.id;
    if q <= 0 or already + q > il.qty then raise exception 'cannot credit % : invoiced %, already credited %', q, il.qty, already using errcode = '23514'; end if;
    net := app.line_net(q, il.unit_price_paise, il.discount_bp); sub := sub + net; taxt := taxt + app.line_tax(net, il.tax_rate_bp);
  end loop;
  total := sub + taxt;
  if total = 0 then raise exception 'nothing to credit'; end if;
  if inv.paid_paise + inv.credited_paise + total > inv.total_paise then
    raise exception 'credit of % exceeds the unpaid balance % of %: refund the customer or adjust the receipt first', total, inv.total_paise - inv.paid_paise - inv.credited_paise, inv.number using errcode = '23514';
  end if;
  insert into public.credit_notes (tenant_id, number, invoice_id, customer_id, reason, restocked, subtotal_paise, tax_paise, total_paise, created_by)
  values (t, app.next_number(t,'cn','CN'), inv.id, inv.customer_id, trim(p_reason), p_restock, sub, taxt, total, auth.uid()) returning id into cn;
  for l in select * from jsonb_array_elements(p_lines) loop
    q := (l->>'qty')::numeric;
    select * into il from public.invoice_lines where id = (l->>'invoice_line_id')::uuid;
    net := app.line_net(q, il.unit_price_paise, il.discount_bp); tx := app.line_tax(net, il.tax_rate_bp);
    insert into public.credit_note_lines (tenant_id, credit_note_id, invoice_line_id, qty, net_paise, tax_paise) values (t, cn, il.id, q, net, tx) returning id into cnl;
    select * into it from public.items where id = il.item_id;
    if p_restock and it.kind = 'stock' then
      unit_cost := round(il.cogs_paise / il.qty)::bigint;
      insert into public.stock_movements (tenant_id, item_id, warehouse_id, qty, kind, unit_cost_paise, ref_type, ref_id, ref_line_id, reason, created_by)
      values (t, it.id, wh, q, 'customer_return', unit_cost, 'credit_note', cn, cnl, trim(p_reason), auth.uid());
      cost := cost + round(q * unit_cost)::bigint;
      perform app.fill_backorders(t, it.id, wh);
    end if;
  end loop;
  update public.invoices set credited_paise = credited_paise + total,
    status = case when paid_paise + credited_paise + total = total_paise then 'paid' else 'partially_paid' end where id = inv.id;
  perform app.post_journal(t, current_date, 'Credit note', 'credit_note', cn, jsonb_build_array(
    jsonb_build_object('key','sales','debit',sub), jsonb_build_object('key','gst_output','debit',taxt), jsonb_build_object('key','ar','credit',total),
    jsonb_build_object('key','inventory','debit',cost), jsonb_build_object('key','cogs','credit',cost)));
  return cn;
end $$;

create or replace function app.customer_outstanding(p_tenant uuid, p_customer uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(total_paise - paid_paise - credited_paise) from public.invoices where tenant_id = p_tenant and customer_id = p_customer and status <> 'reversed'), 0)
       + coalesce((select sum(app.order_total(id)) from public.sales_orders where tenant_id = p_tenant and customer_id = p_customer and status in ('confirmed','partially_dispatched')), 0)
$$;

create or replace function public.record_payment(p_customer uuid, p_method text, p_alloc jsonb, p_reference text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); pay uuid; a jsonb; inv public.invoices; amt bigint; total bigint := 0;
begin
  perform app.require_role('owner','accountant','sales');
  insert into public.payments (tenant_id, number, customer_id, amount_paise, method, reference, created_by)
  select t, app.next_number(t,'rcpt','RCPT'), p_customer, coalesce(sum((x->>'amount_paise')::bigint),0), p_method, p_reference, auth.uid()
  from jsonb_array_elements(p_alloc) x returning id into pay;
  for a in select * from jsonb_array_elements(p_alloc) loop
    amt := (a->>'amount_paise')::bigint;
    select * into inv from public.invoices where id = (a->>'invoice_id')::uuid and tenant_id = t and customer_id = p_customer for update;
    if inv.id is null then raise exception 'invoice does not belong to this customer'; end if;
    if inv.status = 'reversed' then raise exception 'invoice % is reversed', inv.number; end if;
    if amt <= 0 or inv.paid_paise + inv.credited_paise + amt > inv.total_paise then raise exception 'allocation exceeds the balance of %', inv.number using errcode = '23514'; end if;
    insert into public.payment_allocations (tenant_id, payment_id, invoice_id, amount_paise) values (t, pay, inv.id, amt);
    update public.invoices set paid_paise = paid_paise + amt,
      status = case when paid_paise + credited_paise + amt = total_paise then 'paid' else 'partially_paid' end where id = inv.id;
    total := total + amt;
  end loop;
  perform app.post_journal(t, current_date, 'Customer receipt', 'payment', pay, jsonb_build_array(
    jsonb_build_object('key','bank','debit',total), jsonb_build_object('key','ar','credit',total)));
  return pay;
end $$;

-- ---------------------------------------------------------------- transfers (with in-transit stock)
create table public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  number text not null, from_warehouse_id uuid not null, to_warehouse_id uuid not null,
  status text not null default 'in_transit' check (status in ('in_transit','received')),
  created_by uuid, created_at timestamptz not null default now(), received_at timestamptz,
  unique (tenant_id, number), unique (tenant_id, id), check (from_warehouse_id <> to_warehouse_id),
  foreign key (tenant_id, from_warehouse_id) references public.warehouses(tenant_id, id),
  foreign key (tenant_id, to_warehouse_id) references public.warehouses(tenant_id, id)
);
create table public.stock_transfer_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null, transfer_id uuid not null, item_id uuid not null,
  qty numeric(14,3) not null check (qty > 0), unit_cost_paise bigint not null default 0,
  foreign key (tenant_id, transfer_id) references public.stock_transfers(tenant_id, id) on delete cascade,
  foreign key (tenant_id, item_id) references public.items(tenant_id, id)
);
create trigger forbid_tenant_change before update on public.stock_transfers for each row execute function app.forbid_tenant_change();
create trigger audit after insert or update on public.stock_transfers for each row execute function app.audit();

create or replace function public.create_transfer(p_from uuid, p_to uuid, p_lines jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); tr uuid; l jsonb; it public.items; q numeric; avail numeric; trl uuid;
begin
  perform app.require_role('owner','manager','warehouse');
  if p_from = p_to then raise exception 'source and destination must differ'; end if;
  if jsonb_array_length(p_lines) = 0 then raise exception 'add at least one line'; end if;
  perform pg_advisory_xact_lock(hashtextextended(t::text, 7));
  insert into public.stock_transfers (tenant_id, number, from_warehouse_id, to_warehouse_id, created_by)
  values (t, app.next_number(t,'tr','TR'), p_from, p_to, auth.uid()) returning id into tr;
  for l in select * from jsonb_array_elements(p_lines) loop
    q := (l->>'qty')::numeric;
    select * into it from public.items where id = (l->>'item_id')::uuid and tenant_id = t and kind = 'stock';
    if it.id is null then raise exception 'unknown stock item'; end if;
    if q <= 0 then raise exception 'quantity must be positive'; end if;
    select coalesce(sum(qty),0) - coalesce((select sum(r.qty) from public.reservations r where r.tenant_id = t and r.item_id = it.id and r.warehouse_id = p_from),0)
      into avail from public.stock_movements where tenant_id = t and item_id = it.id and warehouse_id = p_from;
    if q > avail then raise exception 'only % of % is available to transfer (reserved stock cannot move)', avail, it.sku using errcode = '23514'; end if;
    insert into public.stock_transfer_lines (tenant_id, transfer_id, item_id, qty, unit_cost_paise) values (t, tr, it.id, q, it.cost_paise) returning id into trl;
    insert into public.stock_movements (tenant_id, item_id, warehouse_id, qty, kind, unit_cost_paise, ref_type, ref_id, ref_line_id, created_by)
    values (t, it.id, p_from, -q, 'transfer_out', it.cost_paise, 'transfer', tr, trl, auth.uid());
  end loop;
  return tr;
end $$;

create or replace function public.receive_transfer(p_transfer uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); tr public.stock_transfers; l record;
begin
  perform app.require_role('owner','manager','warehouse');
  select * into tr from public.stock_transfers where id = p_transfer and tenant_id = t for update;
  if tr.id is null then raise exception 'transfer not found'; end if;
  if tr.status <> 'in_transit' then raise exception 'transfer already received'; end if;
  for l in select * from public.stock_transfer_lines where transfer_id = tr.id loop
    insert into public.stock_movements (tenant_id, item_id, warehouse_id, qty, kind, unit_cost_paise, ref_type, ref_id, ref_line_id, created_by)
    values (t, l.item_id, tr.to_warehouse_id, l.qty, 'transfer_in', l.unit_cost_paise, 'transfer', tr.id, l.id, auth.uid());
    perform app.fill_backorders(t, l.item_id, tr.to_warehouse_id);
  end loop;
  update public.stock_transfers set status = 'received', received_at = now() where id = tr.id;
end $$;

-- ---------------------------------------------------------------- reports (security_invoker: RLS applies)
create or replace view public.receivables_ageing with (security_invoker = true) as
select i.tenant_id, i.id as invoice_id, i.number, i.customer_id, c.name as customer_name, i.invoice_date,
  (i.invoice_date + c.payment_terms_days) as due_date,
  (i.total_paise - i.paid_paise - i.credited_paise) as balance_paise,
  greatest(current_date - (i.invoice_date + c.payment_terms_days), 0) as days_overdue,
  case when current_date <= i.invoice_date + c.payment_terms_days then 'current'
       when current_date - (i.invoice_date + c.payment_terms_days) <= 30 then '1-30'
       when current_date - (i.invoice_date + c.payment_terms_days) <= 60 then '31-60'
       when current_date - (i.invoice_date + c.payment_terms_days) <= 90 then '61-90' else '90+' end as bucket
from public.invoices i join public.customers c on c.id = i.customer_id and c.tenant_id = i.tenant_id
where i.status in ('posted','partially_paid') and i.total_paise - i.paid_paise - i.credited_paise > 0;

create or replace view public.payables_ageing with (security_invoker = true) as
select b.tenant_id, b.id as bill_id, b.number, b.supplier_ref, s.name as supplier_name, b.created_at::date as bill_date,
  (b.created_at::date + b.due_days) as due_date, (b.total_paise - b.paid_paise) as balance_paise,
  greatest(current_date - (b.created_at::date + b.due_days), 0) as days_overdue,
  case when current_date <= b.created_at::date + b.due_days then 'current'
       when current_date - (b.created_at::date + b.due_days) <= 30 then '1-30'
       when current_date - (b.created_at::date + b.due_days) <= 60 then '31-60'
       when current_date - (b.created_at::date + b.due_days) <= 90 then '61-90' else '90+' end as bucket
from public.supplier_bills b join public.purchase_orders po on po.id = b.po_id and po.tenant_id = b.tenant_id
join public.suppliers s on s.id = po.supplier_id and s.tenant_id = po.tenant_id
where b.total_paise - b.paid_paise > 0;

create or replace view public.stock_valuation with (security_invoker = true) as
select l.tenant_id, l.item_id, l.warehouse_id, l.sku, l.item_name, l.warehouse_name, l.on_hand, l.reserved, i.cost_paise,
  round(l.on_hand * i.cost_paise)::bigint as value_paise
from public.stock_levels l join public.items i on i.id = l.item_id;

create or replace view public.in_transit_stock with (security_invoker = true) as
select t.tenant_id, t.id as transfer_id, t.number, t.from_warehouse_id, t.to_warehouse_id, tl.item_id, tl.qty
from public.stock_transfers t join public.stock_transfer_lines tl on tl.transfer_id = t.id where t.status = 'in_transit';

create or replace view public.sales_margin with (security_invoker = true) as
select il.tenant_id, i.id as invoice_id, i.number, i.invoice_date, i.customer_id, il.item_id, it.sku, it.name as item_name,
  il.qty, il.net_paise, il.cogs_paise, il.net_paise - il.cogs_paise as margin_paise
from public.invoice_lines il join public.invoices i on i.id = il.invoice_id join public.items it on it.id = il.item_id;

-- ---------------------------------------------------------------- RLS & grants for the new objects
alter table public.credit_notes enable row level security;
alter table public.credit_note_lines enable row level security;
alter table public.stock_transfers enable row level security;
alter table public.stock_transfer_lines enable row level security;
grant select on public.credit_notes, public.credit_note_lines, public.stock_transfers, public.stock_transfer_lines,
  public.receivables_ageing, public.payables_ageing, public.stock_valuation, public.in_transit_stock, public.sales_margin to authenticated;
grant update (payment_terms_days) on public.customers to authenticated;
create policy credit_notes_read on public.credit_notes for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.has_role('owner','manager','accountant','viewer','sales')));
create policy credit_note_lines_read on public.credit_note_lines for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.has_role('owner','manager','accountant','viewer','sales')));
create policy stock_transfers_read on public.stock_transfers for select to authenticated using (tenant_id = (select app.tenant_id()));
create policy stock_transfer_lines_read on public.stock_transfer_lines for select to authenticated using (tenant_id = (select app.tenant_id()));
revoke all on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on all functions in schema app from public, anon, authenticated;
grant execute on function app.tenant_id(), app.role(), app.has_role(public.app_role[]), app.is_platform_admin() to authenticated;
