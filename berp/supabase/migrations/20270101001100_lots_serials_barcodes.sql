-- Batch / serial tracking with expiry, FEFO dispatch, lot traceability, and item barcodes.
-- Tracked items must carry a lot on every stock movement (enforced by trigger, so no code path can skip it).
-- Supported for tracked items: receipts, adjustments, dispatch, customer-return restock. Transfers and work-order
-- spares of tracked items are refused with a clear message until they are specified.

alter table public.items add column tracking text not null default 'none' check (tracking in ('none','batch','serial'));
alter table public.items add column barcode text check (barcode is null or barcode ~ '^[\x20-\x7E]{1,40}$');
create unique index items_barcode_unique on public.items (tenant_id, lower(barcode)) where barcode is not null;

create table public.stock_lots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  item_id uuid not null, lot_code text not null check (lot_code ~ '^[\x20-\x7E]{1,60}$' and lot_code = trim(lot_code)),
  expiry_date date, created_at timestamptz not null default now(), seq bigint generated always as identity,
  unique (tenant_id, item_id, lot_code), unique (tenant_id, id),
  foreign key (tenant_id, item_id) references public.items(tenant_id, id)
);
alter table public.stock_movements add column lot_id uuid;
alter table public.stock_movements add column seq bigint generated always as identity; -- strict order within one transaction
alter table public.stock_movements add constraint stock_movements_lot_fk foreign key (tenant_id, lot_id) references public.stock_lots(tenant_id, id);
create index on public.stock_movements (lot_id) where lot_id is not null;

create table public.goods_receipt_lots (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, receipt_line_id uuid not null, lot_id uuid not null, qty numeric(14,3) not null check (qty > 0),
  foreign key (receipt_line_id) references public.goods_receipt_lines(id), foreign key (tenant_id, lot_id) references public.stock_lots(tenant_id, id)
);
create table public.dispatch_line_lots (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, dispatch_line_id uuid not null, lot_id uuid not null,
  qty numeric(14,3) not null check (qty > 0), qty_returned numeric(14,3) not null default 0, created_at timestamptz not null default now(), seq bigint generated always as identity,
  check (qty_returned >= 0 and qty_returned <= qty),
  foreign key (dispatch_line_id) references public.dispatch_lines(id), foreign key (tenant_id, lot_id) references public.stock_lots(tenant_id, id)
);
create trigger immutable before update or delete on public.goods_receipt_lots for each row execute function app.immutable();

alter table public.stock_lots enable row level security;
alter table public.goods_receipt_lots enable row level security;
alter table public.dispatch_line_lots enable row level security;
create policy lots_read on public.stock_lots for select to authenticated using (tenant_id = (select app.tenant_id()));
create policy grl_read on public.goods_receipt_lots for select to authenticated using (tenant_id = (select app.tenant_id()));
create policy dll_read on public.dispatch_line_lots for select to authenticated using (tenant_id = (select app.tenant_id()));
grant select on public.stock_lots, public.goods_receipt_lots, public.dispatch_line_lots to authenticated;
create trigger forbid_tenant_change before update on public.stock_lots for each row execute function app.forbid_tenant_change();

-- Tracking mode can only change while the item has never moved.
create or replace function app.guard_tracking_change() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.tracking is distinct from old.tracking and exists (select 1 from public.stock_movements where item_id = old.id) then
    raise exception 'tracking cannot change for % once it has stock movements', old.sku using errcode = '23514';
  end if;
  if new.tracking <> 'none' and new.kind <> 'stock' then raise exception 'only stock items can be batch or serial tracked' using errcode = '23514'; end if;
  return new;
end $$;
create trigger guard_tracking before update on public.items for each row execute function app.guard_tracking_change();
create or replace function app.guard_tracking_insert() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.tracking <> 'none' and new.kind <> 'stock' then raise exception 'only stock items can be batch or serial tracked' using errcode = '23514'; end if;
  return new;
end $$;
create trigger guard_tracking_ins before insert on public.items for each row execute function app.guard_tracking_insert();

-- Every movement of a tracked item names a valid lot; lots never go negative; a serial is 0 or 1.
create or replace function app.guard_movement_lot() returns trigger language plpgsql security definer set search_path = '' as $$
declare tr text; sku text; lot_item uuid; bal numeric;
begin
  select i.tracking, i.sku into tr, sku from public.items i where i.id = new.item_id;
  if tr = 'none' then
    if new.lot_id is not null then raise exception 'item % is not lot-tracked', sku using errcode = '23514'; end if;
    return new;
  end if;
  if new.lot_id is null then raise exception 'item % is %-tracked: this operation does not support lots yet (supported: receipts, adjustments, dispatch, returns)', sku, tr using errcode = '23514'; end if;
  select item_id into lot_item from public.stock_lots where id = new.lot_id;
  if lot_item is distinct from new.item_id then raise exception 'lot does not belong to item %', sku using errcode = '23514'; end if;
  if tr = 'serial' and abs(new.qty) <> 1 then raise exception 'serial-tracked % moves one unit at a time', sku using errcode = '23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.lot_id::text, 11));
  select coalesce(sum(qty), 0) + new.qty into bal from public.stock_movements where lot_id = new.lot_id;
  -- balance per lot is across warehouses; per-warehouse negativity is guarded by callers checking availability
  if bal < 0 then raise exception 'lot of % would go negative', sku using errcode = '23514'; end if;
  if tr = 'serial' and bal > 1 then raise exception 'serial number of % is already in stock', sku using errcode = '23514'; end if;
  return new;
end $$;
create trigger guard_lot before insert on public.stock_movements for each row execute function app.guard_movement_lot();

-- find or create a lot (creation only when p_create); expiry is fixed once set
create or replace function app.lot_for(p_tenant uuid, p_item uuid, p_code text, p_expiry date, p_create boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare l public.stock_lots; code text := trim(coalesce(p_code, ''));
begin
  if code = '' then raise exception 'a lot or serial number is required'; end if;
  select * into l from public.stock_lots where tenant_id = p_tenant and item_id = p_item and lot_code = code;
  if l.id is not null then
    if p_expiry is not null and l.expiry_date is distinct from p_expiry then raise exception 'lot % already exists with expiry %', code, coalesce(l.expiry_date::text, 'none') using errcode = '23514'; end if;
    return l.id;
  end if;
  if not p_create then raise exception 'lot % does not exist for this item', code using errcode = '23514'; end if;
  insert into public.stock_lots (tenant_id, item_id, lot_code, expiry_date) values (p_tenant, p_item, code, p_expiry) returning id into l.id;
  return l.id;
end $$;

-- ---------------------------------------------------------------- receipts with lots
-- p_lines: [{po_line_id, qty, lots?: [{code, expiry?, qty}]}]. Tracked items need lots summing to qty (serials: qty 1 each).
create or replace function public.receive_goods(p_po uuid, p_lines jsonb, p_key text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); po public.purchase_orders; gr uuid; l jsonb; lt jsonb; pl public.purchase_order_lines; it public.items; q numeric; v bigint; tot bigint := 0; open_ct int; grl uuid; lot uuid; lotsum numeric; grlot uuid;
begin
  perform app.require_role('owner','manager','warehouse','purchasing');
  if p_key is not null then
    select id into gr from public.goods_receipts where tenant_id = t and idempotency_key = p_key;
    if gr is not null then return gr; end if;
  end if;
  select * into po from public.purchase_orders where id = p_po and tenant_id = t for update;
  if po.id is null then raise exception 'purchase order not found'; end if;
  if po.status in ('cancelled','billed') then raise exception 'purchase order is %', po.status; end if;
  insert into public.goods_receipts (tenant_id, number, po_id, idempotency_key, received_by) values (t, app.next_number(t,'grn','GRN'), po.id, p_key, auth.uid()) returning id into gr;
  for l in select * from jsonb_array_elements(p_lines) loop
    q := (l->>'qty')::numeric;
    select * into pl from public.purchase_order_lines where id = (l->>'po_line_id')::uuid and po_id = po.id and tenant_id = t for update;
    if pl.id is null then raise exception 'line does not belong to this purchase order'; end if;
    if q <= 0 then raise exception 'receipt quantity must be positive'; end if;
    if pl.qty_received + q > pl.qty then raise exception 'over-receipt: ordered %, already received %, receiving %', pl.qty, pl.qty_received, q using errcode = '23514'; end if;
    select * into it from public.items where id = pl.item_id;
    update public.purchase_order_lines set qty_received = qty_received + q where id = pl.id;
    insert into public.goods_receipt_lines (tenant_id, receipt_id, po_line_id, qty) values (t, gr, pl.id, q) returning id into grl;
    if it.tracking = 'none' then
      insert into public.stock_movements (tenant_id, item_id, warehouse_id, qty, kind, unit_cost_paise, ref_type, ref_id, ref_line_id, created_by)
      values (t, pl.item_id, po.warehouse_id, q, 'receipt', pl.unit_cost_paise, 'goods_receipt', gr, grl, auth.uid());
    else
      if l->'lots' is null or jsonb_array_length(l->'lots') = 0 then raise exception '% is %-tracked: enter the lot/serial numbers received', it.sku, it.tracking; end if;
      select coalesce(sum((x->>'qty')::numeric), 0) into lotsum from jsonb_array_elements(l->'lots') x;
      if lotsum <> q then raise exception 'lots for % add up to % but % was received', it.sku, lotsum, q using errcode = '23514'; end if;
      for lt in select * from jsonb_array_elements(l->'lots') loop
        if (lt->>'qty')::numeric <= 0 then raise exception 'lot quantity must be positive'; end if;
        if it.tracking = 'serial' and (lt->>'qty')::numeric <> 1 then raise exception 'each serial number is one unit'; end if;
        lot := app.lot_for(t, it.id, lt->>'code', nullif(lt->>'expiry','')::date, true);
        insert into public.goods_receipt_lots (tenant_id, receipt_line_id, lot_id, qty) values (t, grl, lot, (lt->>'qty')::numeric) returning id into grlot;
        insert into public.stock_movements (tenant_id, item_id, warehouse_id, qty, kind, unit_cost_paise, ref_type, ref_id, ref_line_id, lot_id, created_by)
        values (t, pl.item_id, po.warehouse_id, (lt->>'qty')::numeric, 'receipt', pl.unit_cost_paise, 'goods_receipt', gr, grlot, lot, auth.uid());
      end loop;
    end if;
    v := round(q * pl.unit_cost_paise)::bigint; tot := tot + v;
    perform app.fill_backorders(t, pl.item_id, po.warehouse_id);
  end loop;
  perform app.post_journal(t, current_date, 'Goods receipt', 'goods_receipt', gr, jsonb_build_array(jsonb_build_object('key','inventory','debit',tot), jsonb_build_object('key','grni','credit',tot)));
  select count(*) into open_ct from public.purchase_order_lines where po_id = po.id and qty_received < qty;
  update public.purchase_orders set status = case when open_ct = 0 then 'received' else 'partially_received' end where id = po.id;
  return gr;
end $$;

-- ---------------------------------------------------------------- adjustments with lots
drop function if exists public.adjust_stock(uuid, uuid, numeric, text);
create or replace function public.adjust_stock(p_item uuid, p_warehouse uuid, p_delta numeric, p_reason text, p_lot text default null, p_expiry date default null) returns void
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); it public.items; onhand numeric; res numeric; mv uuid := gen_random_uuid(); v bigint; lot uuid; lotbal numeric;
begin
  perform app.require_role('owner','manager','warehouse');
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'a reason is required for stock adjustments'; end if;
  if p_delta = 0 then raise exception 'adjustment cannot be zero'; end if;
  select * into it from public.items where id = p_item and tenant_id = t and kind = 'stock';
  if it.id is null then raise exception 'unknown stock item'; end if;
  perform pg_advisory_xact_lock(hashtextextended(t::text, 7));
  if it.tracking <> 'none' then
    lot := app.lot_for(t, it.id, p_lot, p_expiry, p_delta > 0);
    if p_delta < 0 then
      select coalesce(sum(qty),0) into lotbal from public.stock_movements where lot_id = lot and warehouse_id = p_warehouse;
      if lotbal < -p_delta then raise exception 'lot % has only % in this warehouse', p_lot, lotbal using errcode = '23514'; end if;
    end if;
  end if;
  select coalesce(sum(qty),0) into onhand from public.stock_movements where tenant_id = t and item_id = p_item and warehouse_id = p_warehouse;
  select coalesce(sum(qty),0) into res from public.reservations where tenant_id = t and item_id = p_item and warehouse_id = p_warehouse;
  if onhand + p_delta < res then raise exception 'adjustment would drop on-hand (%) below reserved (%)', onhand + p_delta, res using errcode = '23514'; end if;
  insert into public.stock_movements (id, tenant_id, item_id, warehouse_id, qty, kind, unit_cost_paise, ref_type, ref_id, reason, lot_id, created_by)
  values (mv, t, p_item, p_warehouse, p_delta, 'adjustment', it.cost_paise, 'adjustment', mv, trim(p_reason), lot, auth.uid());
  v := round(abs(p_delta) * it.cost_paise)::bigint;
  if v > 0 then
    perform app.post_journal(t, current_date, 'Stock adjustment: ' || trim(p_reason), 'adjustment', mv, jsonb_build_array(
      jsonb_build_object('key','inventory','debit', case when p_delta > 0 then v else 0 end, 'credit', case when p_delta < 0 then v else 0 end),
      jsonb_build_object('key','stock_gain','credit', case when p_delta > 0 then v else 0 end),
      jsonb_build_object('key','stock_loss','debit', case when p_delta < 0 then v else 0 end)));
  end if;
  if p_delta > 0 then perform app.fill_backorders(t, p_item, p_warehouse); end if;
end $$;

-- ---------------------------------------------------------------- dispatch with FEFO / serial picking
-- p_lines: [{so_line_id, qty, lots?: [{code, qty}]}]. Without lots: earliest-expiry-first among unexpired lots at the warehouse.
create or replace function public.dispatch_order(p_order uuid, p_lines jsonb, p_carrier_ref text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); o public.sales_orders; d uuid; l jsonb; lt jsonb; sl public.sales_order_lines; it public.items; q numeric; res numeric; rem numeric; r record; cost bigint; cogs bigint := 0; all_done boolean; dl uuid; dll uuid;
        need numeric; take numeric; lotrow record; picked numeric;
begin
  perform app.require_role('owner','manager','warehouse');
  select * into o from public.sales_orders where id = p_order and tenant_id = t for update;
  if o.id is null then raise exception 'order not found'; end if;
  if o.status not in ('confirmed','partially_dispatched') then raise exception 'cannot dispatch a % order', o.status; end if;
  insert into public.dispatches (tenant_id, number, order_id, carrier_ref, dispatched_by) values (t, app.next_number(t,'dn','DN'), o.id, p_carrier_ref, auth.uid()) returning id into d;
  for l in select * from jsonb_array_elements(p_lines) loop
    q := (l->>'qty')::numeric;
    select * into sl from public.sales_order_lines where id = (l->>'so_line_id')::uuid and order_id = o.id and tenant_id = t for update;
    if sl.id is null then raise exception 'line does not belong to this order'; end if;
    select * into it from public.items where id = sl.item_id;
    if q <= 0 or sl.qty_dispatched + q > sl.qty then raise exception 'cannot dispatch % of %: ordered %, already dispatched %', q, it.sku, sl.qty, sl.qty_dispatched using errcode = '23514'; end if;
    cost := 0;
    if it.kind = 'stock' then
      select coalesce(sum(qty),0) into res from public.reservations where so_line_id = sl.id;
      if q > res then raise exception 'only % of % is reserved for %', res, q, it.sku using errcode = '23514'; end if;
      rem := q;
      for r in select id, qty from public.reservations where so_line_id = sl.id order by created_at, id loop
        exit when rem <= 0;
        if r.qty <= rem then delete from public.reservations where id = r.id; rem := rem - r.qty;
        else update public.reservations set qty = qty - rem where id = r.id; rem := 0; end if;
      end loop;
      cost := it.cost_paise;
    end if;
    insert into public.dispatch_lines (tenant_id, dispatch_id, so_line_id, qty, unit_cost_paise) values (t, d, sl.id, q, cost) returning id into dl;
    if it.kind = 'stock' and it.tracking = 'none' then
      insert into public.stock_movements (tenant_id, item_id, warehouse_id, qty, kind, unit_cost_paise, ref_type, ref_id, ref_line_id, created_by) values (t, it.id, o.warehouse_id, -q, 'dispatch', cost, 'dispatch', d, dl, auth.uid());
      cogs := cogs + round(q * cost)::bigint;
    elsif it.kind = 'stock' then
      picked := 0;
      if l->'lots' is not null and jsonb_array_length(l->'lots') > 0 then
        for lt in select * from jsonb_array_elements(l->'lots') loop
          take := (lt->>'qty')::numeric;
          if take is null or take <= 0 then take := 1; end if;
          if it.tracking = 'serial' and take <> 1 then raise exception 'each serial number is one unit'; end if;
          lotrow := null;
          select s.id, s.expiry_date, coalesce((select sum(m.qty) from public.stock_movements m where m.lot_id = s.id and m.warehouse_id = o.warehouse_id), 0) as bal into lotrow
            from public.stock_lots s where s.tenant_id = t and s.item_id = it.id and s.lot_code = trim(lt->>'code');
          if lotrow.id is null then raise exception 'lot % does not exist for %', lt->>'code', it.sku using errcode = '23514'; end if;
          if lotrow.expiry_date is not null and lotrow.expiry_date < current_date then raise exception 'lot % expired on %', lt->>'code', lotrow.expiry_date using errcode = '23514'; end if;
          if lotrow.bal < take then raise exception 'lot % has only % at this warehouse', lt->>'code', lotrow.bal using errcode = '23514'; end if;
          insert into public.dispatch_line_lots (tenant_id, dispatch_line_id, lot_id, qty) values (t, dl, lotrow.id, take) returning id into dll;
          insert into public.stock_movements (tenant_id, item_id, warehouse_id, qty, kind, unit_cost_paise, ref_type, ref_id, ref_line_id, lot_id, created_by) values (t, it.id, o.warehouse_id, -take, 'dispatch', cost, 'dispatch', d, dll, lotrow.id, auth.uid());
          picked := picked + take;
        end loop;
        if picked <> q then raise exception 'lots for % add up to % but % is being dispatched', it.sku, picked, q using errcode = '23514'; end if;
      else
        need := q;
        for lotrow in
          select s.id, coalesce(sum(m.qty), 0) as bal from public.stock_lots s join public.stock_movements m on m.lot_id = s.id and m.warehouse_id = o.warehouse_id
          where s.tenant_id = t and s.item_id = it.id and (s.expiry_date is null or s.expiry_date >= current_date)
          group by s.id, s.expiry_date, s.seq having coalesce(sum(m.qty), 0) > 0 order by s.expiry_date nulls last, s.seq
        loop
          exit when need <= 0;
          take := least(need, lotrow.bal);
          insert into public.dispatch_line_lots (tenant_id, dispatch_line_id, lot_id, qty) values (t, dl, lotrow.id, take) returning id into dll;
          insert into public.stock_movements (tenant_id, item_id, warehouse_id, qty, kind, unit_cost_paise, ref_type, ref_id, ref_line_id, lot_id, created_by) values (t, it.id, o.warehouse_id, -take, 'dispatch', cost, 'dispatch', d, dll, lotrow.id, auth.uid());
          need := need - take;
        end loop;
        if need > 0 then raise exception 'not enough unexpired lot stock of %: % short (expired or unlotted stock cannot be dispatched)', it.sku, need using errcode = '23514'; end if;
      end if;
      cogs := cogs + round(q * cost)::bigint;
    end if;
    update public.sales_order_lines set qty_dispatched = qty_dispatched + q where id = sl.id;
  end loop;
  if cogs > 0 then
    perform app.post_journal(t, current_date, 'Cost of goods dispatched', 'dispatch', d, jsonb_build_array(jsonb_build_object('key','cogs','debit',cogs), jsonb_build_object('key','inventory','credit',cogs)));
  end if;
  select bool_and(qty_dispatched = qty) into all_done from public.sales_order_lines where order_id = o.id;
  update public.sales_orders set status = case when all_done then 'dispatched' else 'partially_dispatched' end where id = o.id;
  return d;
end $$;

-- ---------------------------------------------------------------- credit note restock back into the original lots
create or replace function public.create_credit_note(p_invoice uuid, p_lines jsonb, p_reason text, p_restock boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); inv public.invoices; cn uuid; l jsonb; il public.invoice_lines; q numeric; already numeric;
        net bigint; tx bigint; sub bigint := 0; taxt bigint := 0; cost bigint := 0; wh uuid; it public.items; unit_cost bigint; cnl uuid; total bigint; rem numeric; dl record; take numeric;
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
      if it.tracking = 'none' then
        insert into public.stock_movements (tenant_id, item_id, warehouse_id, qty, kind, unit_cost_paise, ref_type, ref_id, ref_line_id, reason, created_by)
        values (t, it.id, wh, q, 'customer_return', unit_cost, 'credit_note', cn, cnl, trim(p_reason), auth.uid());
      else
        rem := q;
        for dl in select dll.id, dll.lot_id, dll.qty - dll.qty_returned as avail from public.dispatch_line_lots dll join public.dispatch_lines d on d.id = dll.dispatch_line_id
                  where d.so_line_id = il.so_line_id and dll.qty > dll.qty_returned order by dll.seq for update of dll loop
          exit when rem <= 0;
          take := least(rem, dl.avail);
          update public.dispatch_line_lots set qty_returned = qty_returned + take where id = dl.id;
          insert into public.stock_movements (tenant_id, item_id, warehouse_id, qty, kind, unit_cost_paise, ref_type, ref_id, ref_line_id, lot_id, reason, created_by)
          values (t, it.id, wh, take, 'customer_return', unit_cost, 'credit_note', cn, gen_random_uuid(), dl.lot_id, trim(p_reason), auth.uid());
          rem := rem - take;
        end loop;
        if rem > 0 then raise exception 'cannot restock % of %: it was not dispatched from tracked lots', rem, it.sku using errcode = '23514'; end if;
      end if;
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

-- ---------------------------------------------------------------- views & traceability
create or replace view public.lot_stock with (security_invoker = true) as
select s.tenant_id, s.item_id, m.warehouse_id, s.id as lot_id, i.sku, i.name as item_name, i.tracking, w.name as warehouse_name, s.lot_code, s.expiry_date,
  sum(m.qty) as on_hand,
  case when s.expiry_date is null then null else s.expiry_date - current_date end as days_to_expiry,
  case when s.expiry_date is null then 'no expiry' when s.expiry_date < current_date then 'expired' when s.expiry_date - current_date <= 60 then 'expiring' else 'ok' end as expiry_status
from public.stock_lots s join public.items i on i.id = s.item_id and i.tenant_id = s.tenant_id
join public.stock_movements m on m.lot_id = s.id join public.warehouses w on w.id = m.warehouse_id
group by s.tenant_id, s.item_id, m.warehouse_id, s.id, i.sku, i.name, i.tracking, w.name, s.lot_code, s.expiry_date
having sum(m.qty) <> 0;

create or replace view public.expiry_report with (security_invoker = true) as
select * from public.lot_stock where on_hand > 0 and expiry_date is not null and expiry_date - current_date <= 90;

-- Where did this lot/serial come from and go? (security invoker: RLS applies)
create or replace function public.trace_lot(p_item uuid, p_code text)
returns table (at timestamptz, event text, document text, qty numeric, party text, warehouse text)
language sql stable security invoker set search_path = '' as $$
  select m.created_at, m.kind, coalesce(gr.number, dn.number, cn.number, 'adjustment'), m.qty,
    coalesce(sup.name, cust.name, cust2.name, m.reason), w.name
  from public.stock_lots s
  join public.stock_movements m on m.lot_id = s.id
  join public.warehouses w on w.id = m.warehouse_id
  left join public.goods_receipts gr on m.ref_type = 'goods_receipt' and gr.id = m.ref_id
  left join public.purchase_orders po on po.id = gr.po_id
  left join public.suppliers sup on sup.id = po.supplier_id
  left join public.dispatches dn on m.ref_type = 'dispatch' and dn.id = m.ref_id
  left join public.sales_orders so on so.id = dn.order_id
  left join public.customers cust on cust.id = so.customer_id
  left join public.credit_notes cn on m.ref_type = 'credit_note' and cn.id = m.ref_id
  left join public.customers cust2 on cust2.id = cn.customer_id
  where s.item_id = p_item and s.lot_code = trim(p_code)
  order by m.seq
$$;
grant select on public.lot_stock, public.expiry_report to authenticated;

revoke all on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.apply_provider_event(text,text,uuid,text,text,text), public.api_resolve_key(text),
  public.claim_webhook_deliveries(int), public.record_webhook_result(uuid,boolean,int,text), public.purge_webhook_deliveries() from authenticated;
grant execute on function public.apply_provider_event(text,text,uuid,text,text,text), public.api_resolve_key(text),
  public.claim_webhook_deliveries(int), public.record_webhook_result(uuid,boolean,int,text), public.purge_webhook_deliveries() to service_role;
revoke execute on all functions in schema app from public, anon, authenticated;
grant execute on function app.tenant_id(), app.role(), app.has_role(public.app_role[]), app.is_platform_admin() to authenticated;
