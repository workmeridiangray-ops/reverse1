-- Phase 7: purchasing, stores and assets.
-- Request -> approval (second person) -> purchase order -> approval (second person) ->
-- goods receipt into a store (append-only ledger) -> issue / transfer / stock count.
-- Supplier bill is recorded as a REFERENCE only (no accounts-payable ledger).
-- Assets: register, service dates, lightweight maintenance work orders with downtime.

alter table app.clinic_counters add column if not exists next_po bigint not null default 1;

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  name text not null check (length(trim(name)) between 1 and 150),
  contact text check (contact is null or length(contact) <= 200),
  active boolean not null default true,
  unique (id, clinic_id), unique (clinic_id, name)
);
create table public.store_items (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  name text not null check (length(trim(name)) between 1 and 150),
  unit text not null default 'each' check (length(unit) between 1 and 20),
  reorder_level integer not null default 0 check (reorder_level >= 0),
  active boolean not null default true,
  unique (id, clinic_id), unique (clinic_id, name)
);
create table public.store_locations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  name text not null check (length(trim(name)) between 1 and 80),
  is_main boolean not null default false,
  unique (id, clinic_id), unique (clinic_id, name)
);
create unique index store_one_main on public.store_locations (clinic_id) where is_main;

create table public.store_balances (
  clinic_id uuid not null references public.clinics (id),
  item_id uuid not null, location_id uuid not null,
  qty integer not null default 0 check (qty >= 0),
  primary key (item_id, location_id),
  foreign key (item_id, clinic_id) references public.store_items (id, clinic_id),
  foreign key (location_id, clinic_id) references public.store_locations (id, clinic_id)
);
create table public.store_movements (
  id bigint generated always as identity primary key,
  clinic_id uuid not null references public.clinics (id),
  item_id uuid not null, location_id uuid not null,
  kind text not null check (kind in ('receipt', 'issue', 'transfer_out', 'transfer_in', 'count_adjust')),
  qty integer not null check (qty <> 0),
  reference text, reason text,
  by_user uuid references public.profiles (id),
  at timestamptz not null default now(),
  foreign key (item_id, clinic_id) references public.store_items (id, clinic_id),
  foreign key (location_id, clinic_id) references public.store_locations (id, clinic_id)
);

create table public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  item_id uuid not null,
  qty integer not null check (qty between 1 and 100000),
  est_unit_price_minor bigint not null default 0 check (est_unit_price_minor >= 0),
  reason text not null check (length(trim(reason)) >= 5),
  status text not null default 'requested' check (status in ('requested', 'approved', 'rejected', 'ordered')),
  requested_by uuid not null references public.profiles (id),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles (id),
  decision_note text,
  unique (id, clinic_id),
  foreign key (item_id, clinic_id) references public.store_items (id, clinic_id),
  check ((status in ('requested')) = (decided_by is null) or status = 'ordered'),
  check (decided_by is null or decided_by <> requested_by),
  check (status <> 'rejected' or length(trim(coalesce(decision_note, ''))) >= 5)
);
create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  number text not null,
  supplier_id uuid not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'part_received', 'received', 'cancelled')),
  created_by uuid not null references public.profiles (id),
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  supplier_bill_ref text check (supplier_bill_ref is null or length(supplier_bill_ref) <= 100),
  created_at timestamptz not null default now(),
  unique (id, clinic_id), unique (clinic_id, number),
  foreign key (supplier_id, clinic_id) references public.suppliers (id, clinic_id),
  check (approved_by is null or approved_by <> created_by),
  check ((approved_by is null) = (approved_at is null))
);
create table public.po_lines (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  po_id uuid not null, item_id uuid not null, request_id uuid,
  qty integer not null check (qty > 0),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  received_qty integer not null default 0 check (received_qty >= 0),
  unique (id, clinic_id),
  foreign key (po_id, clinic_id) references public.purchase_orders (id, clinic_id),
  foreign key (item_id, clinic_id) references public.store_items (id, clinic_id),
  foreign key (request_id, clinic_id) references public.purchase_requests (id, clinic_id),
  check (received_qty <= qty)
);
create table public.goods_receipts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  po_line_id uuid not null, qty integer not null check (qty > 0),
  delivery_note text not null check (length(trim(delivery_note)) >= 1),
  received_by uuid not null references public.profiles (id),
  received_at timestamptz not null default now(),
  foreign key (po_line_id, clinic_id) references public.po_lines (id, clinic_id)
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  tag text not null check (tag ~ '^[A-Z0-9-]{2,30}$'),
  name text not null check (length(trim(name)) between 1 and 150),
  category text not null default 'equipment' check (length(category) <= 40),
  location text check (location is null or length(location) <= 100),
  po_id uuid,
  status text not null default 'in_service' check (status in ('in_service', 'under_maintenance', 'retired')),
  last_service_on date, next_service_due date,
  created_at timestamptz not null default now(),
  unique (id, clinic_id), unique (clinic_id, tag),
  foreign key (po_id, clinic_id) references public.purchase_orders (id, clinic_id)
);
create table public.maintenance_requests (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  asset_id uuid not null,
  issue text not null check (length(trim(issue)) >= 5),
  priority text not null default 'normal' check (priority in ('normal', 'urgent')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  reported_by uuid not null references public.profiles (id),
  reported_at timestamptz not null default now(),
  started_at timestamptz, resolved_at timestamptz, resolution text,
  downtime_minutes integer check (downtime_minutes is null or downtime_minutes >= 0),
  foreign key (asset_id, clinic_id) references public.assets (id, clinic_id),
  check (status <> 'resolved' or (resolved_at is not null and length(trim(coalesce(resolution, ''))) >= 5))
);

do $$
declare t text;
begin
  foreach t in array array['suppliers','store_items','store_locations','store_balances','store_movements','purchase_requests','purchase_orders','po_lines','goods_receipts','assets','maintenance_requests'] loop
    execute format('create trigger workflow_only before insert or update or delete on public.%I for each row execute function app.workflow_only()', t);
  end loop;
  foreach t in array array['suppliers','store_items','purchase_requests','purchase_orders','po_lines','goods_receipts','assets','maintenance_requests'] loop
    execute format('create trigger audit_row after insert or update or delete on public.%I for each row execute function app.audit_row()', t);
  end loop;
end $$;
create trigger immutable_row before update or delete on public.store_movements for each row execute function app.immutable_row();

create or replace function app.adjust_balance(p_clinic uuid, p_item uuid, p_loc uuid, p_delta integer, p_kind text, p_ref text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare cur integer;
begin
  insert into public.store_balances (clinic_id, item_id, location_id, qty) values (p_clinic, p_item, p_loc, 0) on conflict do nothing;
  select qty into cur from public.store_balances where item_id = p_item and location_id = p_loc for update;
  if cur + p_delta < 0 then raise exception 'Only % in stock there.', cur using errcode = '23514'; end if;
  update public.store_balances set qty = cur + p_delta where item_id = p_item and location_id = p_loc;
  insert into public.store_movements (clinic_id, item_id, location_id, kind, qty, reference, reason, by_user) values (p_clinic, p_item, p_loc, p_kind, p_delta, p_ref, p_reason, auth.uid());
end $$;

-- ---------------------------------------------------------------------------
create or replace function public.add_supplier(p_name text, p_contact text) returns uuid language plpgsql security definer set search_path = '' as $$
declare c uuid := app.clinic_id(); nid uuid; begin perform app.assert_role('admin');
  insert into public.suppliers (clinic_id, name, contact) values (c, trim(p_name), nullif(trim(p_contact), '')) returning suppliers.id into nid; return nid; end $$;
create or replace function public.add_store_item(p_name text, p_unit text, p_reorder integer) returns uuid language plpgsql security definer set search_path = '' as $$
declare c uuid := app.clinic_id(); nid uuid; begin perform app.assert_role('admin');
  insert into public.store_items (clinic_id, name, unit, reorder_level) values (c, trim(p_name), coalesce(nullif(trim(p_unit), ''), 'each'), p_reorder) returning store_items.id into nid; return nid; end $$;
create or replace function public.add_store_location(p_name text, p_main boolean) returns uuid language plpgsql security definer set search_path = '' as $$
declare c uuid := app.clinic_id(); nid uuid; begin perform app.assert_role('admin');
  insert into public.store_locations (clinic_id, name, is_main) values (c, trim(p_name), p_main) returning store_locations.id into nid; return nid; end $$;

create or replace function public.request_purchase(p_item uuid, p_qty integer, p_price bigint, p_reason text) returns uuid language plpgsql security definer set search_path = '' as $$
declare c uuid := app.clinic_id(); nid uuid; begin
  perform app.assert_role('admin', 'doctor', 'nurse', 'lab', 'pharmacist', 'receptionist');
  if not exists (select 1 from public.store_items where id = p_item and clinic_id = c and active) then raise exception 'Item not found.' using errcode = 'P0002'; end if;
  insert into public.purchase_requests (clinic_id, item_id, qty, est_unit_price_minor, reason, requested_by) values (c, p_item, p_qty, p_price, trim(p_reason), auth.uid()) returning purchase_requests.id into nid; return nid; end $$;

create or replace function public.decide_request(p_req uuid, p_approve boolean, p_note text default null) returns void language plpgsql security definer set search_path = '' as $$
declare c uuid := app.clinic_id(); r public.purchase_requests%rowtype; begin perform app.assert_role('admin');
  select * into r from public.purchase_requests where id = p_req and clinic_id = c for update;
  if not found then raise exception 'Request not found.' using errcode = 'P0002'; end if;
  if r.status <> 'requested' then raise exception 'Already decided.' using errcode = '55000'; end if;
  if r.requested_by = auth.uid() then raise exception 'A request must be decided by someone other than the person who made it.' using errcode = '42501'; end if;
  if not p_approve and length(trim(coalesce(p_note, ''))) < 5 then raise exception 'Give a reason for rejecting.' using errcode = '23514'; end if;
  update public.purchase_requests set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decision_note = nullif(trim(p_note), '') where id = p_req; end $$;

create or replace function public.create_po(p_supplier uuid, p_requests uuid[]) returns uuid language plpgsql security definer set search_path = '' as $$
declare c uuid := app.clinic_id(); n bigint; po uuid; r public.purchase_requests%rowtype; rid uuid; begin perform app.assert_role('admin');
  if not exists (select 1 from public.suppliers where id = p_supplier and clinic_id = c and active) then raise exception 'Supplier not found.' using errcode = 'P0002'; end if;
  if coalesce(cardinality(p_requests), 0) = 0 then raise exception 'Choose at least one approved request.' using errcode = '23514'; end if;
  insert into app.clinic_counters as cc (clinic_id, next_po) values (c, 2) on conflict (clinic_id) do update set next_po = cc.next_po + 1 returning cc.next_po - 1 into n;
  insert into public.purchase_orders (clinic_id, number, supplier_id, created_by) values (c, 'PO-' || lpad(n::text, 6, '0'), p_supplier, auth.uid()) returning purchase_orders.id into po;
  foreach rid in array p_requests loop
    select * into r from public.purchase_requests where id = rid and clinic_id = c for update;
    if not found or r.status <> 'approved' then raise exception 'Only approved requests can be ordered.' using errcode = '55000'; end if;
    insert into public.po_lines (clinic_id, po_id, item_id, request_id, qty, unit_price_minor) values (c, po, r.item_id, rid, r.qty, r.est_unit_price_minor);
    update public.purchase_requests set status = 'ordered' where id = rid;
  end loop; return po; end $$;

create or replace function public.set_po_line_price(p_line uuid, p_price bigint) returns void language plpgsql security definer set search_path = '' as $$
declare c uuid := app.clinic_id(); begin perform app.assert_role('admin');
  update public.po_lines l set unit_price_minor = p_price where l.id = p_line and l.clinic_id = c and exists (select 1 from public.purchase_orders o where o.id = l.po_id and o.status = 'draft');
  if not found then raise exception 'Only lines on a draft order can be re-priced.' using errcode = '55000'; end if; end $$;

create or replace function public.approve_po(p_po uuid) returns void language plpgsql security definer set search_path = '' as $$
declare c uuid := app.clinic_id(); o public.purchase_orders%rowtype; begin perform app.assert_role('admin');
  select * into o from public.purchase_orders where id = p_po and clinic_id = c for update;
  if not found then raise exception 'Order not found.' using errcode = 'P0002'; end if;
  if o.status <> 'draft' then raise exception 'Only a draft order can be approved.' using errcode = '55000'; end if;
  if o.created_by = auth.uid() then raise exception 'An order must be approved by someone other than the person who created it.' using errcode = '42501'; end if;
  update public.purchase_orders set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_po; end $$;

create or replace function public.receive_goods(p_line uuid, p_qty integer, p_delivery_note text, p_location uuid) returns void language plpgsql security definer set search_path = '' as $$
declare c uuid := app.clinic_id(); l public.po_lines%rowtype; o public.purchase_orders%rowtype; left_ integer; begin perform app.assert_role('admin', 'nurse');
  select * into l from public.po_lines where id = p_line and clinic_id = c for update;
  if not found then raise exception 'Order line not found.' using errcode = 'P0002'; end if;
  select * into o from public.purchase_orders where id = l.po_id for update;
  if o.status not in ('approved', 'part_received') then raise exception 'The order must be approved before goods are received.' using errcode = '55000'; end if;
  if p_qty > l.qty - l.received_qty then raise exception 'Only % more expected on this line.', l.qty - l.received_qty using errcode = '23514'; end if;
  if not exists (select 1 from public.store_locations where id = p_location and clinic_id = c) then raise exception 'Location not found.' using errcode = 'P0002'; end if;
  insert into public.goods_receipts (clinic_id, po_line_id, qty, delivery_note, received_by) values (c, p_line, p_qty, trim(p_delivery_note), auth.uid());
  update public.po_lines set received_qty = received_qty + p_qty where id = p_line;
  perform app.adjust_balance(c, l.item_id, p_location, p_qty, 'receipt', o.number || ' / ' || trim(p_delivery_note), null);
  select coalesce(sum(qty - received_qty), 0) into left_ from public.po_lines where po_id = o.id;
  update public.purchase_orders set status = case when left_ = 0 then 'received' else 'part_received' end where id = o.id; end $$;

create or replace function public.set_supplier_bill(p_po uuid, p_ref text) returns void language plpgsql security definer set search_path = '' as $$
declare c uuid := app.clinic_id(); begin perform app.assert_role('admin');
  update public.purchase_orders set supplier_bill_ref = nullif(trim(p_ref), '') where id = p_po and clinic_id = c and status in ('part_received', 'received');
  if not found then raise exception 'A supplier bill reference can be recorded once goods have arrived.' using errcode = '55000'; end if; end $$;

create or replace function public.issue_stock(p_item uuid, p_from uuid, p_qty integer, p_to text) returns void language plpgsql security definer set search_path = '' as $$
declare c uuid := app.clinic_id(); begin perform app.assert_role('admin', 'nurse', 'pharmacist', 'lab');
  if length(trim(coalesce(p_to, ''))) < 2 then raise exception 'Say which department the stock goes to.' using errcode = '23514'; end if;
  if not exists (select 1 from public.store_items where id = p_item and clinic_id = c) or not exists (select 1 from public.store_locations where id = p_from and clinic_id = c) then raise exception 'Item or location not found.' using errcode = 'P0002'; end if;
  perform app.adjust_balance(c, p_item, p_from, -p_qty, 'issue', 'to ' || trim(p_to), null); end $$;

create or replace function public.transfer_stock(p_item uuid, p_from uuid, p_to uuid, p_qty integer) returns void language plpgsql security definer set search_path = '' as $$
declare c uuid := app.clinic_id(); begin perform app.assert_role('admin', 'nurse', 'pharmacist', 'lab');
  if p_from = p_to then raise exception 'Choose two different locations.' using errcode = '23514'; end if;
  if not exists (select 1 from public.store_items where id = p_item and clinic_id = c) or not exists (select 1 from public.store_locations where id = p_from and clinic_id = c)
     or not exists (select 1 from public.store_locations where id = p_to and clinic_id = c) then raise exception 'Item or location not found.' using errcode = 'P0002'; end if;
  perform app.adjust_balance(c, p_item, p_from, -p_qty, 'transfer_out', null, null);
  perform app.adjust_balance(c, p_item, p_to, p_qty, 'transfer_in', null, null); end $$;

create or replace function public.stock_count(p_item uuid, p_loc uuid, p_counted integer, p_reason text) returns integer language plpgsql security definer set search_path = '' as $$
declare c uuid := app.clinic_id(); cur integer; begin perform app.assert_role('admin', 'nurse', 'pharmacist', 'lab');
  if p_counted < 0 then raise exception 'The count cannot be negative.' using errcode = '23514'; end if;
  select coalesce((select qty from public.store_balances where item_id = p_item and location_id = p_loc and clinic_id = c), 0) into cur;
  if p_counted = cur then return 0; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'The count differs from the system (% recorded). Give a reason for the difference.', cur using errcode = '23514'; end if;
  perform app.adjust_balance(c, p_item, p_loc, p_counted - cur, 'count_adjust', null, trim(p_reason)); return p_counted - cur; end $$;

create or replace function public.register_asset(p_tag text, p_name text, p_category text, p_location text, p_next_service date) returns uuid language plpgsql security definer set search_path = '' as $$
declare c uuid := app.clinic_id(); nid uuid; begin perform app.assert_role('admin');
  insert into public.assets (clinic_id, tag, name, category, location, next_service_due) values (c, upper(trim(p_tag)), trim(p_name), coalesce(nullif(trim(p_category), ''), 'equipment'), nullif(trim(p_location), ''), p_next_service) returning assets.id into nid; return nid; end $$;
create or replace function public.record_service(p_asset uuid, p_next date) returns void language plpgsql security definer set search_path = '' as $$
declare c uuid := app.clinic_id(); begin perform app.assert_role('admin');
  update public.assets set last_service_on = current_date, next_service_due = p_next where id = p_asset and clinic_id = c and status <> 'retired';
  if not found then raise exception 'Asset not found or retired.' using errcode = 'P0002'; end if; end $$;
create or replace function public.report_fault(p_asset uuid, p_issue text, p_priority text) returns uuid language plpgsql security definer set search_path = '' as $$
declare c uuid := app.clinic_id(); nid uuid; begin perform app.assert_role('admin', 'doctor', 'nurse', 'lab', 'pharmacist', 'receptionist');
  if not exists (select 1 from public.assets where id = p_asset and clinic_id = c and status <> 'retired') then raise exception 'Asset not found.' using errcode = 'P0002'; end if;
  insert into public.maintenance_requests (clinic_id, asset_id, issue, priority, reported_by) values (c, p_asset, trim(p_issue), p_priority, auth.uid()) returning maintenance_requests.id into nid; return nid; end $$;
create or replace function public.start_maintenance(p_req uuid) returns void language plpgsql security definer set search_path = '' as $$
declare c uuid := app.clinic_id(); m public.maintenance_requests%rowtype; begin perform app.assert_role('admin');
  select * into m from public.maintenance_requests where id = p_req and clinic_id = c for update;
  if not found then raise exception 'Request not found.' using errcode = 'P0002'; end if;
  if m.status <> 'open' then raise exception 'Work has already started.' using errcode = '55000'; end if;
  update public.maintenance_requests set status = 'in_progress', started_at = now() where id = p_req;
  update public.assets set status = 'under_maintenance' where id = m.asset_id; end $$;
create or replace function public.resolve_maintenance(p_req uuid, p_resolution text) returns void language plpgsql security definer set search_path = '' as $$
declare c uuid := app.clinic_id(); m public.maintenance_requests%rowtype; begin perform app.assert_role('admin');
  select * into m from public.maintenance_requests where id = p_req and clinic_id = c for update;
  if not found then raise exception 'Request not found.' using errcode = 'P0002'; end if;
  if m.status <> 'in_progress' then raise exception 'Start the work before resolving it.' using errcode = '55000'; end if;
  if length(trim(coalesce(p_resolution, ''))) < 5 then raise exception 'Say what was done.' using errcode = '23514'; end if;
  update public.maintenance_requests set status = 'resolved', resolved_at = now(), resolution = trim(p_resolution), downtime_minutes = (extract(epoch from now() - reported_at) / 60)::int where id = p_req;
  update public.assets set status = 'in_service', last_service_on = current_date where id = m.asset_id; end $$;
create or replace function public.retire_asset(p_asset uuid, p_reason text) returns void language plpgsql security definer set search_path = '' as $$
declare c uuid := app.clinic_id(); begin perform app.assert_role('admin');
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Give a reason.' using errcode = '23514'; end if;
  if exists (select 1 from public.maintenance_requests where asset_id = p_asset and status <> 'resolved') then raise exception 'Resolve open maintenance first.' using errcode = '55000'; end if;
  update public.assets set status = 'retired', location = null where id = p_asset and clinic_id = c and status <> 'retired';
  if not found then raise exception 'Asset not found.' using errcode = 'P0002'; end if; end $$;

-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['suppliers','store_items','store_locations','store_balances','store_movements','purchase_requests','purchase_orders','po_lines','goods_receipts','assets','maintenance_requests'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
  end loop;
end $$;
create policy suppliers_sel on public.suppliers for select to authenticated using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin')));
create policy store_items_sel on public.store_items for select to authenticated using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'doctor', 'nurse', 'lab', 'pharmacist', 'receptionist')));
create policy store_locations_sel on public.store_locations for select to authenticated using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'nurse', 'lab', 'pharmacist')));
create policy store_balances_sel on public.store_balances for select to authenticated using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'nurse', 'lab', 'pharmacist')));
create policy store_movements_sel on public.store_movements for select to authenticated using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin')));
create policy purchase_requests_sel on public.purchase_requests for select to authenticated using (clinic_id = (select app.clinic_id()) and ((select app.has_role('admin')) or requested_by = (select auth.uid())));
create policy purchase_orders_sel on public.purchase_orders for select to authenticated using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin')));
create policy po_lines_sel on public.po_lines for select to authenticated using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'nurse')));
create policy goods_receipts_sel on public.goods_receipts for select to authenticated using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin')));
create policy assets_sel on public.assets for select to authenticated using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'doctor', 'nurse', 'lab', 'pharmacist', 'receptionist')));
create policy maintenance_sel on public.maintenance_requests for select to authenticated using (clinic_id = (select app.clinic_id()) and ((select app.has_role('admin')) or reported_by = (select auth.uid())));

grant execute on all functions in schema public to authenticated;
revoke all on function public.add_supplier(text, text), public.add_store_item(text, text, integer), public.add_store_location(text, boolean), public.request_purchase(uuid, integer, bigint, text),
  public.decide_request(uuid, boolean, text), public.create_po(uuid, uuid[]), public.set_po_line_price(uuid, bigint), public.approve_po(uuid), public.receive_goods(uuid, integer, text, uuid),
  public.set_supplier_bill(uuid, text), public.issue_stock(uuid, uuid, integer, text), public.transfer_stock(uuid, uuid, uuid, integer), public.stock_count(uuid, uuid, integer, text),
  public.register_asset(text, text, text, text, date), public.record_service(uuid, date), public.report_fault(uuid, text, text), public.start_maintenance(uuid), public.resolve_maintenance(uuid, text), public.retire_asset(uuid, text)
  from anon, public;
revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated;
