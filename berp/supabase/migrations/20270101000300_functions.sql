-- Business operations. Every function is SECURITY DEFINER, re-checks tenant and role itself,
-- and runs in one transaction. Clients call these (RPC) instead of writing posted data directly.

-- ---------------------------------------------------------------- tenant bootstrap & switching
create or replace function public.create_workspace(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t uuid; b uuid; tc uuid;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  insert into public.tenants (name) values (trim(p_name)) returning id into t;
  insert into public.memberships (user_id, tenant_id, role) values (auth.uid(), t, 'owner');
  insert into public.profiles (user_id, active_tenant_id) values (auth.uid(), t)
    on conflict (user_id) do update set active_tenant_id = t;
  insert into public.branches (tenant_id, code, name) values (t, 'HQ', 'Head office') returning id into b;
  insert into public.warehouses (tenant_id, branch_id, code, name) values (t, b, 'MAIN', 'Main warehouse');
  insert into public.tax_codes (tenant_id, code, rate_bp) values (t,'GST0',0),(t,'GST5',500),(t,'GST12',1200),(t,'GST18',1800),(t,'GST28',2800);
  insert into public.accounts (tenant_id, code, name, type, system_key) values
    (t,'1000','Cash and bank','asset','bank'), (t,'1100','Accounts receivable','asset','ar'),
    (t,'1200','Inventory','asset','inventory'), (t,'1300','Input GST','asset','gst_input'),
    (t,'2000','Accounts payable','liability','ap'), (t,'2100','Goods received not billed','liability','grni'),
    (t,'2200','Output GST','liability','gst_output'), (t,'3000','Owner equity','equity','equity'),
    (t,'4000','Sales revenue','income','sales'), (t,'4900','Inventory gain','income','stock_gain'),
    (t,'5000','Cost of goods sold','expense','cogs'), (t,'5900','Inventory loss','expense','stock_loss');
  insert into public.subscription_events (tenant_id, kind, plan_code) values (t,'trial_started','trial');
  return t;
end $$;

create or replace function public.switch_workspace(p_tenant uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.memberships where user_id = auth.uid() and tenant_id = p_tenant and active) then
    raise exception 'not a member of that workspace' using errcode = '42501';
  end if;
  insert into public.profiles (user_id, active_tenant_id) values (auth.uid(), p_tenant)
    on conflict (user_id) do update set active_tenant_id = p_tenant;
end $$;

create or replace function public.change_plan(p_plan text) returns void
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); p public.plans; u int; b int; w int;
begin
  if not app.has_role('owner') then raise exception 'only the owner can change the plan' using errcode = '42501'; end if;
  select * into p from public.plans where code = p_plan and active and code <> 'trial';
  if p.code is null then raise exception 'unknown plan'; end if;
  select count(*) into u from public.memberships where tenant_id = t and active;
  select count(*) into b from public.branches where tenant_id = t and active;
  select count(*) into w from public.warehouses where tenant_id = t and active;
  if u > p.max_users or b > p.max_branches or w > p.max_warehouses then
    raise exception 'downgrade blocked: % users / % branches / % warehouses exceed the % plan; deactivate the excess first', u, b, w, p.name using errcode = '53400';
  end if;
  update public.tenants set plan_code = p_plan, status = 'active' where id = t;
  insert into public.subscription_events (tenant_id, kind, plan_code, note) values (t,'plan_changed',p_plan,'recorded; payment provider confirms separately');
end $$;

create or replace function public.add_member(p_user uuid, p_role public.app_role) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_role('owner');
  insert into public.memberships (user_id, tenant_id, role) values (p_user, app.tenant_id(), p_role)
    on conflict (user_id, tenant_id) do update set role = excluded.role, active = true;
  insert into public.profiles (user_id, active_tenant_id) values (p_user, app.tenant_id()) on conflict (user_id) do nothing;
end $$;

create or replace function public.set_member_active(p_user uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_role('owner');
  if p_user = auth.uid() and not p_active then raise exception 'you cannot deactivate yourself'; end if;
  update public.memberships set active = p_active where user_id = p_user and tenant_id = app.tenant_id();
end $$;

create or replace function public.lock_period(p_through date) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_role('owner','accountant');
  insert into public.period_locks (tenant_id, locked_through, locked_by) values (app.tenant_id(), p_through, auth.uid())
  on conflict (tenant_id) do update set locked_through = greatest(public.period_locks.locked_through, excluded.locked_through),
    locked_by = auth.uid(), locked_at = now();
end $$;

-- ---------------------------------------------------------------- sales orders
-- p_lines: [{item_id, qty, unit_price_paise?, discount_bp?}] ; price/tax default from the item.
create or replace function public.create_sales_order(p_customer uuid, p_warehouse uuid, p_lines jsonb, p_notes text default '') returns uuid
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); so uuid; l jsonb; it public.items; rate int; n int := 0;
begin
  perform app.require_role('owner','manager','sales');
  if jsonb_array_length(p_lines) = 0 then raise exception 'an order needs at least one line'; end if;
  insert into public.sales_orders (tenant_id, number, customer_id, warehouse_id, notes, created_by)
  values (t, app.next_number(t,'so','SO'), p_customer, p_warehouse, coalesce(p_notes,''), auth.uid()) returning id into so;
  for l in select * from jsonb_array_elements(p_lines) loop
    select * into it from public.items where tenant_id = t and id = (l->>'item_id')::uuid and active;
    if it.id is null then raise exception 'unknown or inactive item'; end if;
    select coalesce(tc.rate_bp,0) into rate from public.tax_codes tc where tc.tenant_id = t and tc.id = it.tax_code_id;
    n := n + 1;
    insert into public.sales_order_lines (tenant_id, order_id, line_no, item_id, qty, unit_price_paise, discount_bp, tax_rate_bp)
    values (t, so, n, it.id, (l->>'qty')::numeric, coalesce((l->>'unit_price_paise')::bigint, it.sale_price_paise),
            coalesce((l->>'discount_bp')::int, 0), coalesce(rate,0));
  end loop;
  return so;
end $$;

create or replace function app.order_total(p_order uuid) returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(n + app.line_tax(n, tax_rate_bp)), 0)::bigint from (
    select app.line_net(qty, unit_price_paise, discount_bp) n, tax_rate_bp from public.sales_order_lines where order_id = p_order) x
$$;

create or replace function app.customer_outstanding(p_tenant uuid, p_customer uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(total_paise - paid_paise) from public.invoices where tenant_id = p_tenant and customer_id = p_customer and status <> 'reversed'), 0)
       + coalesce((select sum(app.order_total(id)) from public.sales_orders where tenant_id = p_tenant and customer_id = p_customer and status in ('confirmed','partially_dispatched')), 0)
$$;

-- Confirms an order: credit check, then reserves what is available. Returns the shortages.
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

create or replace function public.cancel_sales_order(p_order uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); o public.sales_orders;
begin
  perform app.require_role('owner','manager','sales');
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'a cancellation reason is required'; end if;
  select * into o from public.sales_orders where id = p_order and tenant_id = t for update;
  if o.id is null then raise exception 'order not found'; end if;
  if o.status not in ('draft','confirmed') then raise exception 'a % order cannot be cancelled; use a return or credit note', o.status; end if;
  delete from public.reservations where so_line_id in (select id from public.sales_order_lines where order_id = o.id);
  update public.purchase_requests set status = 'rejected', decision_reason = 'order cancelled'
    where tenant_id = t and status = 'pending' and so_line_id in (select id from public.sales_order_lines where order_id = o.id);
  update public.sales_orders set status = 'cancelled', notes = notes || E'\nCancelled: ' || trim(p_reason) where id = o.id;
end $$;

-- Creates one pending purchase request per short line (idempotent per line).
create or replace function public.request_shortage_purchases(p_order uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); o public.sales_orders; l record; short numeric; n int := 0;
begin
  perform app.require_role('owner','manager','sales','purchasing');
  select * into o from public.sales_orders where id = p_order and tenant_id = t;
  if o.id is null or o.status not in ('confirmed','partially_dispatched') then raise exception 'order must be confirmed'; end if;
  for l in select sl.id, sl.item_id, sl.qty, sl.qty_dispatched,
             coalesce((select sum(r.qty) from public.reservations r where r.so_line_id = sl.id),0) reserved
           from public.sales_order_lines sl join public.items i on i.id = sl.item_id and i.kind = 'stock' where sl.order_id = o.id loop
    short := l.qty - l.qty_dispatched - l.reserved;
    if short > 0 and not exists (select 1 from public.purchase_requests where so_line_id = l.id and status in ('pending','approved')) then
      insert into public.purchase_requests (tenant_id, number, item_id, warehouse_id, qty, so_line_id)
      values (t, app.next_number(t,'pr','PR'), l.item_id, o.warehouse_id, short, l.id);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- purchasing
create or replace function public.approve_purchase_request(p_request uuid, p_supplier uuid, p_unit_cost_paise bigint) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); r public.purchase_requests; po uuid; rate int;
begin
  perform app.require_role('owner','manager','purchasing');
  select * into r from public.purchase_requests where id = p_request and tenant_id = t for update;
  if r.id is null or r.status <> 'pending' then raise exception 'request is not pending'; end if;
  select coalesce(tc.rate_bp,0) into rate from public.items i left join public.tax_codes tc on tc.id = i.tax_code_id and tc.tenant_id = i.tenant_id where i.id = r.item_id;
  insert into public.purchase_orders (tenant_id, number, supplier_id, warehouse_id, request_id, created_by)
  values (t, app.next_number(t,'po','PO'), p_supplier, r.warehouse_id, r.id, auth.uid()) returning id into po;
  insert into public.purchase_order_lines (tenant_id, po_id, item_id, qty, unit_cost_paise, tax_rate_bp) values (t, po, r.item_id, r.qty, p_unit_cost_paise, coalesce(rate,0));
  update public.purchase_requests set status = 'approved', decided_by = auth.uid() where id = r.id;
  return po;
end $$;

create or replace function public.reject_purchase_request(p_request uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_role('owner','manager','purchasing');
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'a rejection reason is required'; end if;
  update public.purchase_requests set status = 'rejected', decision_reason = trim(p_reason), decided_by = auth.uid()
   where id = p_request and tenant_id = app.tenant_id() and status = 'pending';
  if not found then raise exception 'request is not pending'; end if;
end $$;

-- Reserve free stock for confirmed orders that were short (oldest order first).
create or replace function app.fill_backorders(p_tenant uuid, p_item uuid, p_wh uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare avail numeric; l record; need numeric; take numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text, 7));
  select coalesce(sum(qty),0) - coalesce((select sum(qty) from public.reservations where tenant_id = p_tenant and item_id = p_item and warehouse_id = p_wh),0)
    into avail from public.stock_movements where tenant_id = p_tenant and item_id = p_item and warehouse_id = p_wh;
  for l in select sl.id, sl.qty - sl.qty_dispatched - coalesce((select sum(r.qty) from public.reservations r where r.so_line_id = sl.id),0) as need
           from public.sales_order_lines sl join public.sales_orders so on so.id = sl.order_id
           where sl.tenant_id = p_tenant and sl.item_id = p_item and so.warehouse_id = p_wh and so.status in ('confirmed','partially_dispatched')
           order by so.created_at, sl.line_no loop
    exit when avail <= 0;
    if l.need > 0 then
      take := least(avail, l.need);
      insert into public.reservations (tenant_id, so_line_id, item_id, warehouse_id, qty) values (p_tenant, l.id, p_item, p_wh, take);
      avail := avail - take;
    end if;
  end loop;
end $$;

-- Partial goods receipt. p_lines: [{po_line_id, qty}]. Safe to retry with the same key.
create or replace function public.receive_goods(p_po uuid, p_lines jsonb, p_key text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); po public.purchase_orders; gr uuid; l jsonb; pl public.purchase_order_lines; q numeric; v bigint; tot bigint := 0; open_ct int; grl uuid;
begin
  perform app.require_role('owner','manager','warehouse','purchasing');
  if p_key is not null then
    select id into gr from public.goods_receipts where tenant_id = t and idempotency_key = p_key;
    if gr is not null then return gr; end if;
  end if;
  select * into po from public.purchase_orders where id = p_po and tenant_id = t for update;
  if po.id is null then raise exception 'purchase order not found'; end if;
  if po.status in ('cancelled','billed') then raise exception 'purchase order is %', po.status; end if;
  insert into public.goods_receipts (tenant_id, number, po_id, idempotency_key, received_by)
  values (t, app.next_number(t,'grn','GRN'), po.id, p_key, auth.uid()) returning id into gr;
  for l in select * from jsonb_array_elements(p_lines) loop
    q := (l->>'qty')::numeric;
    select * into pl from public.purchase_order_lines where id = (l->>'po_line_id')::uuid and po_id = po.id and tenant_id = t for update;
    if pl.id is null then raise exception 'line does not belong to this purchase order'; end if;
    if q <= 0 then raise exception 'receipt quantity must be positive'; end if;
    if pl.qty_received + q > pl.qty then raise exception 'over-receipt: ordered %, already received %, receiving %', pl.qty, pl.qty_received, q using errcode = '23514'; end if;
    update public.purchase_order_lines set qty_received = qty_received + q where id = pl.id;
    insert into public.goods_receipt_lines (tenant_id, receipt_id, po_line_id, qty) values (t, gr, pl.id, q) returning id into grl;
    insert into public.stock_movements (tenant_id, item_id, warehouse_id, qty, kind, unit_cost_paise, ref_type, ref_id, ref_line_id, created_by)
      values (t, pl.item_id, po.warehouse_id, q, 'receipt', pl.unit_cost_paise, 'goods_receipt', gr, grl, auth.uid());
    v := round(q * pl.unit_cost_paise)::bigint; tot := tot + v;
    perform app.fill_backorders(t, pl.item_id, po.warehouse_id);
  end loop;
  perform app.post_journal(t, current_date, 'Goods receipt', 'goods_receipt', gr,
    jsonb_build_array(jsonb_build_object('key','inventory','debit',tot), jsonb_build_object('key','grni','credit',tot)));
  select count(*) into open_ct from public.purchase_order_lines where po_id = po.id and qty_received < qty;
  update public.purchase_orders set status = case when open_ct = 0 then 'received' else 'partially_received' end where id = po.id;
  return gr;
end $$;

-- Supplier bill, three-way matched against receipts. Outside tolerance needs a manager + reason.
create or replace function public.post_supplier_bill(p_po uuid, p_supplier_ref text, p_billed_subtotal_paise bigint, p_exception_reason text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); po public.purchase_orders; tn public.tenants; recv bigint; tax bigint; b uuid; diff bigint; tol bigint; exp_sub bigint;
begin
  perform app.require_role('owner','manager','accountant','purchasing');
  select * into po from public.purchase_orders where id = p_po and tenant_id = t for update;
  if po.id is null then raise exception 'purchase order not found'; end if;
  select * into tn from public.tenants where id = t;
  select coalesce(sum(round(qty_received * unit_cost_paise)),0), coalesce(sum(round(round(qty_received*unit_cost_paise) * tax_rate_bp / 10000.0)),0)
    into recv, tax from public.purchase_order_lines where po_id = po.id;
  if recv = 0 then raise exception 'nothing has been received against this purchase order'; end if;
  exp_sub := recv;
  diff := abs(p_billed_subtotal_paise - exp_sub); tol := round(exp_sub * tn.bill_tolerance_bp / 10000.0);
  if diff > tol then
    if p_exception_reason is null or length(trim(p_exception_reason)) < 5 then
      raise exception 'bill % differs from received value % by more than tolerance: an exception reason is required', p_billed_subtotal_paise, exp_sub using errcode = '23514';
    end if;
    if not app.has_role('owner','manager') then raise exception 'only a manager can approve a bill exception' using errcode = '42501'; end if;
  end if;
  -- tax follows the billed subtotal proportionally to the received value
  tax := case when exp_sub = 0 then 0 else round(tax * p_billed_subtotal_paise::numeric / exp_sub)::bigint end;
  insert into public.supplier_bills (tenant_id, number, po_id, supplier_ref, subtotal_paise, tax_paise, total_paise, exception_reason, created_by)
  values (t, app.next_number(t,'bill','BILL'), po.id, trim(p_supplier_ref), p_billed_subtotal_paise, tax, p_billed_subtotal_paise + tax, nullif(trim(coalesce(p_exception_reason,'')),''), auth.uid())
  returning id into b;
  update public.purchase_order_lines set qty_billed = qty_received where po_id = po.id;
  -- GRNI was booked at PO cost for what was received; any price difference goes to inventory
  perform app.post_journal(t, current_date, 'Supplier bill', 'supplier_bill', b, jsonb_build_array(
    jsonb_build_object('key','grni','debit',recv),
    jsonb_build_object('key','gst_input','debit',tax),
    jsonb_build_object('key','inventory','debit',greatest(p_billed_subtotal_paise - recv,0)),
    jsonb_build_object('key','inventory','credit',greatest(recv - p_billed_subtotal_paise,0)),
    jsonb_build_object('key','ap','credit',p_billed_subtotal_paise + tax)));
  update public.purchase_orders set status = 'billed' where id = po.id and not exists (select 1 from public.purchase_order_lines where po_id = po.id and qty_received < qty);
  return b;
end $$;

create or replace function public.pay_supplier_bill(p_bill uuid, p_amount_paise bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); b public.supplier_bills;
begin
  perform app.require_role('owner','accountant');
  select * into b from public.supplier_bills where id = p_bill and tenant_id = t for update;
  if b.id is null then raise exception 'bill not found'; end if;
  if p_amount_paise <= 0 or b.paid_paise + p_amount_paise > b.total_paise then raise exception 'payment exceeds the bill balance' using errcode = '23514'; end if;
  update public.supplier_bills set paid_paise = paid_paise + p_amount_paise where id = b.id;
  perform app.post_journal(t, current_date, 'Supplier payment', 'supplier_payment', b.id, jsonb_build_array(
    jsonb_build_object('key','ap','debit',p_amount_paise), jsonb_build_object('key','bank','credit',p_amount_paise)));
end $$;

-- ---------------------------------------------------------------- dispatch, invoice, collection
-- p_lines: [{so_line_id, qty}]. A line can only ship what is reserved for it.
create or replace function public.dispatch_order(p_order uuid, p_lines jsonb, p_carrier_ref text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); o public.sales_orders; d uuid; l jsonb; sl public.sales_order_lines; it public.items; q numeric; res numeric; rem numeric; r record; cost bigint; cogs bigint := 0; all_done boolean; dl uuid;
begin
  perform app.require_role('owner','manager','warehouse');
  select * into o from public.sales_orders where id = p_order and tenant_id = t for update;
  if o.id is null then raise exception 'order not found'; end if;
  if o.status not in ('confirmed','partially_dispatched') then raise exception 'cannot dispatch a % order', o.status; end if;
  insert into public.dispatches (tenant_id, number, order_id, carrier_ref, dispatched_by)
  values (t, app.next_number(t,'dn','DN'), o.id, p_carrier_ref, auth.uid()) returning id into d;
  for l in select * from jsonb_array_elements(p_lines) loop
    q := (l->>'qty')::numeric;
    select * into sl from public.sales_order_lines where id = (l->>'so_line_id')::uuid and order_id = o.id and tenant_id = t for update;
    if sl.id is null then raise exception 'line does not belong to this order'; end if;
    select * into it from public.items where id = sl.item_id;
    if q <= 0 or sl.qty_dispatched + q > sl.qty then raise exception 'cannot dispatch % of %: ordered %, already dispatched %', q, it.sku, sl.qty, sl.qty_dispatched using errcode = '23514'; end if;
    if it.kind = 'stock' then
      select coalesce(sum(qty),0) into res from public.reservations where so_line_id = sl.id;
      if q > res then raise exception 'only % of % is reserved for %', res, q, it.sku using errcode = '23514'; end if;
      -- consume reservations oldest first
      rem := q;
      for r in select id, qty from public.reservations where so_line_id = sl.id order by created_at, id loop
        exit when rem <= 0;
        if r.qty <= rem then delete from public.reservations where id = r.id; rem := rem - r.qty;
        else update public.reservations set qty = qty - rem where id = r.id; rem := 0; end if;
      end loop;
      cost := it.cost_paise;
    else cost := 0; end if;
    insert into public.dispatch_lines (tenant_id, dispatch_id, so_line_id, qty, unit_cost_paise) values (t, d, sl.id, q, cost) returning id into dl;
    if it.kind = 'stock' then
      insert into public.stock_movements (tenant_id, item_id, warehouse_id, qty, kind, unit_cost_paise, ref_type, ref_id, ref_line_id, created_by)
        values (t, it.id, o.warehouse_id, -q, 'dispatch', cost, 'dispatch', d, dl, auth.uid());
      cogs := cogs + round(q * cost)::bigint;
    end if;
    update public.sales_order_lines set qty_dispatched = qty_dispatched + q where id = sl.id;
  end loop;
  if cogs > 0 then
    perform app.post_journal(t, current_date, 'Cost of goods dispatched', 'dispatch', d, jsonb_build_array(
      jsonb_build_object('key','cogs','debit',cogs), jsonb_build_object('key','inventory','credit',cogs)));
  end if;
  select bool_and(qty_dispatched = qty) into all_done from public.sales_order_lines where order_id = o.id;
  update public.sales_orders set status = case when all_done then 'dispatched' else 'partially_dispatched' end where id = o.id;
  return d;
end $$;

-- Invoices everything dispatched but not yet invoiced.
create or replace function public.invoice_order(p_order uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); o public.sales_orders; inv uuid; sl record; q numeric; net bigint; tx bigint; sub bigint := 0; taxt bigint := 0; all_inv boolean;
begin
  perform app.require_role('owner','manager','accountant','sales');
  select * into o from public.sales_orders where id = p_order and tenant_id = t for update;
  if o.id is null then raise exception 'order not found'; end if;
  if not exists (select 1 from public.sales_order_lines where order_id = o.id and qty_dispatched > qty_invoiced) then
    raise exception 'nothing dispatched is awaiting an invoice';
  end if;
  insert into public.invoices (tenant_id, number, order_id, customer_id, subtotal_paise, tax_paise, total_paise, created_by)
  values (t, app.next_number(t,'inv','INV'), o.id, o.customer_id, 0, 0, 0, auth.uid()) returning id into inv;
  for sl in select * from public.sales_order_lines where order_id = o.id and qty_dispatched > qty_invoiced order by line_no loop
    q := sl.qty_dispatched - sl.qty_invoiced;
    net := app.line_net(q, sl.unit_price_paise, sl.discount_bp); tx := app.line_tax(net, sl.tax_rate_bp);
    insert into public.invoice_lines (tenant_id, invoice_id, so_line_id, item_id, qty, unit_price_paise, discount_bp, tax_rate_bp, net_paise, tax_paise)
      values (t, inv, sl.id, sl.item_id, q, sl.unit_price_paise, sl.discount_bp, sl.tax_rate_bp, net, tx);
    update public.sales_order_lines set qty_invoiced = qty_dispatched where id = sl.id;
    sub := sub + net; taxt := taxt + tx;
  end loop;
  update public.invoices set subtotal_paise = sub, tax_paise = taxt, total_paise = sub + taxt where id = inv;
  perform app.post_journal(t, current_date, 'Sales invoice', 'invoice', inv, jsonb_build_array(
    jsonb_build_object('key','ar','debit',sub + taxt), jsonb_build_object('key','sales','credit',sub),
    jsonb_build_object('key','gst_output','credit',taxt)));
  select bool_and(qty_invoiced = qty) into all_inv from public.sales_order_lines where order_id = o.id;
  if all_inv then update public.sales_orders set status = 'invoiced' where id = o.id; end if;
  return inv;
end $$;

-- p_alloc: [{invoice_id, amount_paise}]; allocations must equal the payment and fit each invoice.
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
    if amt <= 0 or inv.paid_paise + amt > inv.total_paise then raise exception 'allocation exceeds the balance of %', inv.number using errcode = '23514'; end if;
    insert into public.payment_allocations (tenant_id, payment_id, invoice_id, amount_paise) values (t, pay, inv.id, amt);
    update public.invoices set paid_paise = paid_paise + amt,
      status = case when paid_paise + amt = total_paise then 'paid' else 'partially_paid' end where id = inv.id;
    total := total + amt;
  end loop;
  perform app.post_journal(t, current_date, 'Customer receipt', 'payment', pay, jsonb_build_array(
    jsonb_build_object('key','bank','debit',total), jsonb_build_object('key','ar','credit',total)));
  return pay;
end $$;

-- ---------------------------------------------------------------- stock adjustment & reversal
create or replace function public.adjust_stock(p_item uuid, p_warehouse uuid, p_delta numeric, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); it public.items; onhand numeric; res numeric; v bigint; mv uuid;
begin
  perform app.require_role('owner','manager','warehouse');
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'a reason is required for stock adjustments'; end if;
  if p_delta = 0 then raise exception 'adjustment cannot be zero'; end if;
  select * into it from public.items where id = p_item and tenant_id = t and kind = 'stock';
  if it.id is null then raise exception 'unknown stock item'; end if;
  perform pg_advisory_xact_lock(hashtextextended(t::text, 7));
  select coalesce(sum(qty),0) into onhand from public.stock_movements where tenant_id = t and item_id = p_item and warehouse_id = p_warehouse;
  select coalesce(sum(qty),0) into res from public.reservations where tenant_id = t and item_id = p_item and warehouse_id = p_warehouse;
  if onhand + p_delta < res then raise exception 'adjustment would drop on-hand (%) below reserved (%)', onhand + p_delta, res using errcode = '23514'; end if;
  mv := gen_random_uuid();
  insert into public.stock_movements (id, tenant_id, item_id, warehouse_id, qty, kind, unit_cost_paise, ref_type, ref_id, reason, created_by)
    values (mv, t, p_item, p_warehouse, p_delta, 'adjustment', it.cost_paise, 'adjustment', mv, trim(p_reason), auth.uid());
  v := round(abs(p_delta) * it.cost_paise)::bigint;
  if v > 0 then
    perform app.post_journal(t, current_date, 'Stock adjustment: ' || trim(p_reason), 'adjustment', mv, jsonb_build_array(
      jsonb_build_object('key','inventory','debit', case when p_delta > 0 then v else 0 end, 'credit', case when p_delta < 0 then v else 0 end),
      jsonb_build_object('key','stock_gain','credit', case when p_delta > 0 then v else 0 end),
      jsonb_build_object('key','stock_loss','debit', case when p_delta < 0 then v else 0 end)));
  end if;
  if p_delta > 0 then perform app.fill_backorders(t, p_item, p_warehouse); end if;
end $$;

create or replace function public.reverse_journal(p_entry uuid, p_reason text, p_date date default current_date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); e public.journal_entries; r uuid;
begin
  perform app.require_role('owner','accountant');
  if p_reason is null or length(trim(p_reason)) < 5 then raise exception 'a reason is required to reverse an entry'; end if;
  select * into e from public.journal_entries where id = p_entry and tenant_id = t;
  if e.id is null then raise exception 'entry not found'; end if;
  if e.reverses_id is not null then raise exception 'a reversal cannot itself be reversed'; end if;
  if e.source_type <> 'manual' then raise exception 'entries from % documents are reversed through the document, not directly', e.source_type; end if;
  insert into public.journal_entries (tenant_id, number, entry_date, memo, source_type, source_id, reverses_id, reversal_reason, created_by)
  values (t, app.next_number(t,'journal','JV'), p_date, 'Reversal of ' || e.number || ': ' || trim(p_reason), 'manual', e.id, e.id, trim(p_reason), auth.uid()) returning id into r;
  insert into public.journal_lines (tenant_id, entry_id, account_id, debit_paise, credit_paise)
    select t, r, account_id, credit_paise, debit_paise from public.journal_lines where entry_id = e.id;
  return r;
end $$;

-- manual journal: p_lines [{account_code, debit, credit}]
create or replace function public.post_manual_journal(p_date date, p_memo text, p_lines jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); e uuid; l jsonb; a uuid;
begin
  perform app.require_role('owner','accountant');
  if p_memo is null or length(trim(p_memo)) < 3 then raise exception 'a memo is required'; end if;
  insert into public.journal_entries (tenant_id, number, entry_date, memo, source_type, created_by)
  values (t, app.next_number(t,'journal','JV'), p_date, trim(p_memo), 'manual', auth.uid()) returning id into e;
  for l in select * from jsonb_array_elements(p_lines) loop
    select id into a from public.accounts where tenant_id = t and code = l->>'account_code' and active;
    if a is null then raise exception 'unknown account %', l->>'account_code'; end if;
    insert into public.journal_lines (tenant_id, entry_id, account_id, debit_paise, credit_paise)
    values (t, e, a, coalesce((l->>'debit')::bigint,0), coalesce((l->>'credit')::bigint,0));
  end loop;
  return e;
end $$;
