-- Lot-aware warehouse transfers and work-order spares for batch/serial items.

-- Chooses lots for a quantity at a warehouse: the caller's explicit list, else earliest-expiry-first.
create or replace function app.pick_lots(p_tenant uuid, p_item uuid, p_wh uuid, p_qty numeric, p_explicit jsonb, p_allow_expired boolean)
returns table (lot_id uuid, qty numeric)
language plpgsql security definer set search_path = '' as $$
declare x record; l record; need numeric := p_qty; take numeric; picked numeric := 0; tr text; sku text;
begin
  select i.tracking, i.sku into tr, sku from public.items i where i.id = p_item;
  if p_explicit is not null and jsonb_typeof(p_explicit) = 'array' and jsonb_array_length(p_explicit) > 0 then
    for x in select trim(e->>'code') as code, sum(coalesce((e->>'qty')::numeric, 1)) as q from jsonb_array_elements(p_explicit) e group by 1 loop
      if tr = 'serial' and x.q <> 1 then raise exception 'each serial number is one unit' using errcode = '23514'; end if;
      select s.id, s.expiry_date, coalesce((select sum(m.qty) from public.stock_movements m where m.lot_id = s.id and m.warehouse_id = p_wh), 0) as bal into l
        from public.stock_lots s where s.tenant_id = p_tenant and s.item_id = p_item and s.lot_code = x.code;
      if l.id is null then raise exception 'lot % does not exist for %', x.code, sku using errcode = '23514'; end if;
      if not p_allow_expired and l.expiry_date is not null and l.expiry_date < current_date then raise exception 'lot % expired on %', x.code, l.expiry_date using errcode = '23514'; end if;
      if l.bal < x.q then raise exception 'lot % has only % at this warehouse', x.code, l.bal using errcode = '23514'; end if;
      picked := picked + x.q; lot_id := l.id; qty := x.q; return next;
    end loop;
    if picked <> p_qty then raise exception 'lots for % add up to % but % is needed', sku, picked, p_qty using errcode = '23514'; end if;
    return;
  end if;
  for l in
    select s.id, coalesce(sum(m.qty), 0) as bal from public.stock_lots s join public.stock_movements m on m.lot_id = s.id and m.warehouse_id = p_wh
    where s.tenant_id = p_tenant and s.item_id = p_item and (p_allow_expired or s.expiry_date is null or s.expiry_date >= current_date)
    group by s.id, s.expiry_date, s.seq having coalesce(sum(m.qty), 0) > 0 order by s.expiry_date nulls last, s.seq
  loop
    exit when need <= 0;
    take := least(need, l.bal); lot_id := l.id; qty := take; need := need - take; return next;
  end loop;
  if need > 0 then raise exception 'not enough unexpired lot stock of %: % short', sku, need using errcode = '23514'; end if;
end $$;

create table public.stock_transfer_lots (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, transfer_line_id uuid not null references public.stock_transfer_lines(id),
  lot_id uuid not null, qty numeric(14,3) not null check (qty > 0),
  foreign key (tenant_id, lot_id) references public.stock_lots(tenant_id, id)
);
alter table public.stock_transfer_lots enable row level security;
create policy stl_read on public.stock_transfer_lots for select to authenticated using (tenant_id = (select app.tenant_id()));
grant select on public.stock_transfer_lots to authenticated;
create trigger immutable before update or delete on public.stock_transfer_lots for each row execute function app.immutable();

-- p_lines: [{item_id, qty, lots?: [{code, qty}]}]
create or replace function public.create_transfer(p_from uuid, p_to uuid, p_lines jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); tr uuid; l jsonb; it public.items; q numeric; avail numeric; trl uuid; pk record; stl uuid;
begin
  perform app.require_role('owner','manager','warehouse');
  if p_from = p_to then raise exception 'source and destination must differ'; end if;
  if jsonb_array_length(p_lines) = 0 then raise exception 'add at least one line'; end if;
  perform pg_advisory_xact_lock(hashtextextended(t::text, 7));
  insert into public.stock_transfers (tenant_id, number, from_warehouse_id, to_warehouse_id, created_by) values (t, app.next_number(t,'tr','TR'), p_from, p_to, auth.uid()) returning id into tr;
  for l in select * from jsonb_array_elements(p_lines) loop
    q := (l->>'qty')::numeric;
    select * into it from public.items where id = (l->>'item_id')::uuid and tenant_id = t and kind = 'stock';
    if it.id is null then raise exception 'unknown stock item'; end if;
    if q <= 0 then raise exception 'quantity must be positive'; end if;
    select coalesce(sum(qty),0) - coalesce((select sum(r.qty) from public.reservations r where r.tenant_id = t and r.item_id = it.id and r.warehouse_id = p_from),0)
      into avail from public.stock_movements where tenant_id = t and item_id = it.id and warehouse_id = p_from;
    if q > avail then raise exception 'only % of % is available to transfer (reserved stock cannot move)', avail, it.sku using errcode = '23514'; end if;
    insert into public.stock_transfer_lines (tenant_id, transfer_id, item_id, qty, unit_cost_paise) values (t, tr, it.id, q, it.cost_paise) returning id into trl;
    if it.tracking = 'none' then
      insert into public.stock_movements (tenant_id, item_id, warehouse_id, qty, kind, unit_cost_paise, ref_type, ref_id, ref_line_id, created_by)
      values (t, it.id, p_from, -q, 'transfer_out', it.cost_paise, 'transfer', tr, trl, auth.uid());
    else
      for pk in select * from app.pick_lots(t, it.id, p_from, q, l->'lots', false) loop
        insert into public.stock_transfer_lots (tenant_id, transfer_line_id, lot_id, qty) values (t, trl, pk.lot_id, pk.qty) returning id into stl;
        insert into public.stock_movements (tenant_id, item_id, warehouse_id, qty, kind, unit_cost_paise, ref_type, ref_id, ref_line_id, lot_id, created_by)
        values (t, it.id, p_from, -pk.qty, 'transfer_out', it.cost_paise, 'transfer', tr, stl, pk.lot_id, auth.uid());
      end loop;
    end if;
  end loop;
  return tr;
end $$;

create or replace function public.receive_transfer(p_transfer uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); tr public.stock_transfers; l record; sl record; tracked text;
begin
  perform app.require_role('owner','manager','warehouse');
  select * into tr from public.stock_transfers where id = p_transfer and tenant_id = t for update;
  if tr.id is null then raise exception 'transfer not found'; end if;
  if tr.status <> 'in_transit' then raise exception 'transfer already received'; end if;
  for l in select tl.*, i.tracking from public.stock_transfer_lines tl join public.items i on i.id = tl.item_id where tl.transfer_id = tr.id loop
    if l.tracking = 'none' then
      insert into public.stock_movements (tenant_id, item_id, warehouse_id, qty, kind, unit_cost_paise, ref_type, ref_id, ref_line_id, created_by)
      values (t, l.item_id, tr.to_warehouse_id, l.qty, 'transfer_in', l.unit_cost_paise, 'transfer', tr.id, l.id, auth.uid());
    else
      for sl in select * from public.stock_transfer_lots where transfer_line_id = l.id loop
        insert into public.stock_movements (tenant_id, item_id, warehouse_id, qty, kind, unit_cost_paise, ref_type, ref_id, ref_line_id, lot_id, created_by)
        values (t, l.item_id, tr.to_warehouse_id, sl.qty, 'transfer_in', l.unit_cost_paise, 'transfer', tr.id, sl.id, sl.lot_id, auth.uid());
      end loop;
    end if;
    perform app.fill_backorders(t, l.item_id, tr.to_warehouse_id);
  end loop;
  update public.stock_transfers set status = 'received', received_at = now() where id = tr.id;
end $$;

-- in-transit view must include lot-tracked quantities (they live on transfer lines too, so it already does)

-- ---------------------------------------------------------------- work-order spares with lots
drop function if exists public.close_work_order(uuid, text, uuid, numeric, uuid, bigint);
create or replace function public.close_work_order(p_wo uuid, p_report text, p_spare_item uuid, p_spare_qty numeric, p_warehouse uuid, p_labour bigint, p_spare_lots jsonb default null) returns void
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); w public.work_orders; it public.items; spares bigint := 0; labour bigint := coalesce(p_labour,0); onhand numeric; res numeric; mv uuid; pk record;
begin
  perform app.require_role('owner','manager','warehouse');
  if p_report is null or length(trim(p_report)) < 3 then raise exception 'a service report is required'; end if;
  select * into w from public.work_orders where id = p_wo and tenant_id = t for update;
  if w.id is null then raise exception 'work order not found'; end if;
  if w.status = 'done' then raise exception 'work order already closed'; end if;
  insert into public.accounts (tenant_id, code, name, type, system_key) values (t, '5100', 'Maintenance expense', 'expense', 'maintenance') on conflict do nothing;
  if p_spare_item is not null then
    select * into it from public.items where id = p_spare_item and tenant_id = t and kind = 'stock';
    if it.id is null then raise exception 'unknown spare item'; end if;
    if p_spare_qty is null or p_spare_qty <= 0 then raise exception 'enter the spare quantity used'; end if;
    perform pg_advisory_xact_lock(hashtextextended(t::text, 7));
    select coalesce(sum(qty),0) into onhand from public.stock_movements where tenant_id = t and item_id = it.id and warehouse_id = p_warehouse;
    select coalesce(sum(qty),0) into res from public.reservations where tenant_id = t and item_id = it.id and warehouse_id = p_warehouse;
    if onhand - res < p_spare_qty then raise exception 'not enough free stock of % for this spare', it.sku using errcode = '23514'; end if;
    if it.tracking = 'none' then
      mv := gen_random_uuid();
      insert into public.stock_movements (id, tenant_id, item_id, warehouse_id, qty, kind, unit_cost_paise, ref_type, ref_id, reason, created_by)
      values (mv, t, it.id, p_warehouse, -p_spare_qty, 'adjustment', it.cost_paise, 'work_order', w.id, 'Spare for ' || w.number, auth.uid());
    else
      for pk in select * from app.pick_lots(t, it.id, p_warehouse, p_spare_qty, p_spare_lots, false) loop
        insert into public.stock_movements (tenant_id, item_id, warehouse_id, qty, kind, unit_cost_paise, ref_type, ref_id, reason, lot_id, created_by)
        values (t, it.id, p_warehouse, -pk.qty, 'adjustment', it.cost_paise, 'work_order', w.id, 'Spare for ' || w.number, pk.lot_id, auth.uid());
      end loop;
    end if;
    spares := round(p_spare_qty * it.cost_paise)::bigint;
  end if;
  if spares + labour > 0 then
    perform app.post_journal(t, current_date, 'Maintenance ' || w.number, 'work_order', w.id, jsonb_build_array(
      jsonb_build_object('key','maintenance','debit', spares + labour), jsonb_build_object('key','inventory','credit', spares), jsonb_build_object('key','bank','credit', labour)));
  end if;
  update public.work_orders set status = 'done', report = trim(p_report), spare_item_id = p_spare_item, spare_qty = p_spare_qty, labour_cost_paise = labour, closed_at = now() where id = w.id;
  update public.assets set status = 'active' where id = w.asset_id and status = 'under_repair';
  update public.assets set next_service_on = case when service_every_days is null then next_service_on else current_date + service_every_days end where id = w.asset_id;
end $$;

revoke all on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.apply_provider_event(text,text,uuid,text,text,text), public.api_resolve_key(text),
  public.claim_webhook_deliveries(int), public.record_webhook_result(uuid,boolean,int,text), public.purge_webhook_deliveries() from authenticated;
grant execute on function public.apply_provider_event(text,text,uuid,text,text,text), public.api_resolve_key(text),
  public.claim_webhook_deliveries(int), public.record_webhook_result(uuid,boolean,int,text), public.purge_webhook_deliveries() to service_role;
revoke execute on all functions in schema app from public, anon, authenticated;
grant execute on function app.tenant_id(), app.role(), app.has_role(public.app_role[]), app.is_platform_admin() to authenticated;
