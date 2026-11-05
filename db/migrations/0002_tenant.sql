-- Tenant (per-company) operational schema. Every table carries company_id and is protected by RLS.
create table counters (company_id uuid not null, kind text not null, n bigint not null default 0, primary key (company_id, kind));
create function next_number(p_company uuid, p_kind text, p_prefix text) returns text language plpgsql as $$
declare v bigint; begin
  insert into counters(company_id, kind, n) values (p_company, p_kind, 1)
  on conflict (company_id, kind) do update set n = counters.n + 1 returning n into v;
  return p_prefix || '-' || lpad(v::text, 5, '0'); end $$;

create table plants (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  code text not null, name text not null, active boolean not null default true, unique (company_id, code), unique (id, company_id));
create table locations (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  plant_id uuid not null, code text not null, name text not null,
  kind text not null default 'stock' check (kind in ('stock','quarantine','wip','dispatch')),
  unique (company_id, code), unique (id, company_id),
  foreign key (plant_id, company_id) references plants(id, company_id));
create table work_centres (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  plant_id uuid not null, code text not null, name text not null,
  hours_per_day numeric(6,2) not null default 8 check (hours_per_day > 0),
  cost_rate_per_hour_paise bigint not null default 0 check (cost_rate_per_hour_paise >= 0),
  overhead_pct numeric(6,2) not null default 0 check (overhead_pct >= 0),
  unique (company_id, code), unique (id, company_id),
  foreign key (plant_id, company_id) references plants(id, company_id));
create table machines (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  work_centre_id uuid not null, code text not null, name text not null, pm_interval_days int, last_pm_at date,
  unique (company_id, code), unique (id, company_id),
  foreign key (work_centre_id, company_id) references work_centres(id, company_id));
create table shift_calendar (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  plant_id uuid not null, weekday int not null check (weekday between 0 and 6), working boolean not null default true,
  unique (company_id, plant_id, weekday), foreign key (plant_id, company_id) references plants(id, company_id));

create table uoms (company_id uuid not null references companies(id), code text not null, name text not null, primary key (company_id, code));
create table items (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  code text not null, name text not null,
  kind text not null check (kind in ('make','buy','subcontract')),
  uom text not null, tracking text not null default 'none' check (tracking in ('none','batch','serial')),
  lot_size numeric(18,4) not null default 1 check (lot_size > 0),
  lead_time_days int not null default 0 check (lead_time_days >= 0),
  safety_stock numeric(18,4) not null default 0 check (safety_stock >= 0),
  std_cost_paise bigint not null default 0 check (std_cost_paise >= 0),
  revision text not null default 'A',
  active boolean not null default true, version int not null default 1,
  unique (company_id, code), unique (id, company_id),
  foreign key (company_id, uom) references uoms(company_id, code));
create table item_revisions (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  item_id uuid not null, rev text not null, status text not null default 'approved' check (status in ('draft','approved','obsolete')),
  notes text, approved_by uuid, created_at timestamptz not null default now(),
  unique (item_id, rev), foreign key (item_id, company_id) references items(id, company_id));
create table uom_conversions (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  item_id uuid, from_uom text not null, to_uom text not null, factor numeric(18,6) not null check (factor > 0),
  unique (company_id, item_id, from_uom, to_uom));
create table item_alternates (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  item_id uuid not null, alternate_item_id uuid not null, check (item_id <> alternate_item_id),
  unique (item_id, alternate_item_id),
  foreign key (item_id, company_id) references items(id, company_id),
  foreign key (alternate_item_id, company_id) references items(id, company_id));
create table customers (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  code text not null, name text not null, email text, active boolean not null default true,
  unique (company_id, code), unique (id, company_id));
create table suppliers (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  code text not null, name text not null, email text, active boolean not null default true,
  unique (company_id, code), unique (id, company_id));
create table documents (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  entity text not null, entity_id uuid not null, filename text not null, mime text not null, size_bytes int not null,
  storage_key text not null, sha256 text not null, shared_with_party boolean not null default false,
  uploaded_by uuid, created_at timestamptz not null default now());

-- Engineering
create table boms (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  item_id uuid not null, version int not null, status text not null default 'draft' check (status in ('draft','pending','released','obsolete')),
  effective_from date not null default current_date, effective_to date,
  yield_pct numeric(6,2) not null default 100 check (yield_pct > 0 and yield_pct <= 100),
  created_at timestamptz not null default now(),
  unique (item_id, version), unique (id, company_id),
  foreign key (item_id, company_id) references items(id, company_id));
create table bom_lines (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  bom_id uuid not null, component_item_id uuid not null,
  qty_per numeric(18,6) not null check (qty_per > 0), scrap_pct numeric(6,2) not null default 0 check (scrap_pct >= 0 and scrap_pct < 100),
  substitute_item_id uuid,
  unique (bom_id, component_item_id),
  foreign key (bom_id, company_id) references boms(id, company_id) on delete cascade,
  foreign key (component_item_id, company_id) references items(id, company_id),
  foreign key (substitute_item_id, company_id) references items(id, company_id));
create table routings (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  item_id uuid not null, version int not null, status text not null default 'draft' check (status in ('draft','released','obsolete')),
  unique (item_id, version), unique (id, company_id), foreign key (item_id, company_id) references items(id, company_id));
create table routing_ops (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  routing_id uuid not null, seq int not null, name text not null, work_centre_id uuid not null,
  setup_min numeric(10,2) not null default 0 check (setup_min >= 0), run_min_per_unit numeric(10,4) not null default 0 check (run_min_per_unit >= 0),
  subcontract_supplier_id uuid,
  unique (routing_id, seq),
  foreign key (routing_id, company_id) references routings(id, company_id) on delete cascade,
  foreign key (work_centre_id, company_id) references work_centres(id, company_id),
  foreign key (subcontract_supplier_id, company_id) references suppliers(id, company_id));
create table change_requests (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  number text not null, bom_id uuid not null, reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  affected jsonb not null default '[]', requested_by uuid, decided_by uuid, decision_reason text, decided_at timestamptz,
  created_at timestamptz not null default now(), unique (company_id, number),
  foreign key (bom_id, company_id) references boms(id, company_id));

-- Sales
create table sales_orders (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  number text not null, customer_id uuid not null, status text not null default 'draft' check (status in ('draft','confirmed','cancelled','closed')),
  order_date date not null default current_date, cancel_reason text, version int not null default 1,
  created_by uuid, created_at timestamptz not null default now(),
  unique (company_id, number), unique (id, company_id), foreign key (customer_id, company_id) references customers(id, company_id));
create table sales_order_lines (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  order_id uuid not null, line_no int not null, item_id uuid not null, qty numeric(18,4) not null check (qty > 0),
  shipped_qty numeric(18,4) not null default 0 check (shipped_qty >= 0),
  due_date date not null, promised_date date, supply text not null default 'mto' check (supply in ('mts','mto')),
  unique (order_id, line_no), unique (id, company_id),
  check (shipped_qty <= qty),
  foreign key (order_id, company_id) references sales_orders(id, company_id) on delete cascade,
  foreign key (item_id, company_id) references items(id, company_id));
create table forecasts (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  item_id uuid not null, period_start date not null, qty numeric(18,4) not null check (qty >= 0),
  unique (item_id, period_start), foreign key (item_id, company_id) references items(id, company_id));
create table quotations (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  number text not null, customer_id uuid not null, item_id uuid not null, qty numeric(18,4) not null check (qty > 0),
  est_cost_paise bigint not null, margin_pct numeric(6,2) not null default 20, quoted_price_paise bigint not null,
  status text not null default 'draft' check (status in ('draft','sent','accepted','lost')),
  created_at timestamptz not null default now(), unique (company_id, number),
  foreign key (customer_id, company_id) references customers(id, company_id),
  foreign key (item_id, company_id) references items(id, company_id));

-- Planning
create table mrp_runs (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  number text not null, params jsonb not null, snapshot jsonb not null, status text not null default 'completed',
  created_by uuid, created_at timestamptz not null default now(), unique (company_id, number), unique (id, company_id));
create table mrp_suggestions (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  run_id uuid not null, item_id uuid not null, kind text not null check (kind in ('purchase','production')),
  qty numeric(18,4) not null check (qty > 0), need_date date not null, release_date date not null,
  reason jsonb not null, status text not null default 'suggested' check (status in ('suggested','released','dismissed')),
  released_ref text, decided_by uuid,
  foreign key (run_id, company_id) references mrp_runs(id, company_id) on delete cascade,
  foreign key (item_id, company_id) references items(id, company_id));

-- Procurement
create table purchase_orders (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  number text not null, supplier_id uuid not null, status text not null default 'draft' check (status in ('draft','pending_approval','approved','partial','received','cancelled')),
  approved_by uuid, reject_reason text, created_by uuid, created_at timestamptz not null default now(), version int not null default 1,
  unique (company_id, number), unique (id, company_id), foreign key (supplier_id, company_id) references suppliers(id, company_id));
create table purchase_order_lines (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  po_id uuid not null, item_id uuid not null, qty numeric(18,4) not null check (qty > 0),
  received_qty numeric(18,4) not null default 0 check (received_qty >= 0), unit_price_paise bigint not null default 0 check (unit_price_paise >= 0),
  due_date date not null, suggestion_id uuid, work_order_id uuid, unique (id, company_id),
  foreign key (po_id, company_id) references purchase_orders(id, company_id) on delete cascade,
  foreign key (item_id, company_id) references items(id, company_id));
create table receipts (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  number text not null, po_id uuid not null, supplier_invoice_ref text, received_by uuid, created_at timestamptz not null default now(),
  unique (company_id, number), foreign key (po_id, company_id) references purchase_orders(id, company_id));
create table subcontract_orders (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  number text not null, supplier_id uuid not null, work_order_id uuid, item_id uuid not null,
  qty_sent numeric(18,4) not null check (qty_sent > 0), qty_received numeric(18,4) not null default 0, qty_lost numeric(18,4) not null default 0,
  status text not null default 'sent' check (status in ('sent','partial','closed')), expected_return date,
  created_at timestamptz not null default now(), unique (company_id, number),
  foreign key (supplier_id, company_id) references suppliers(id, company_id),
  foreign key (item_id, company_id) references items(id, company_id),
  check (qty_received + qty_lost <= qty_sent));

-- Inventory
create table batches (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  item_id uuid not null, code text not null, status text not null default 'available' check (status in ('available','quarantine','rejected')),
  supplier_id uuid, source_ref text, created_at timestamptz not null default now(),
  unique (company_id, item_id, code), unique (id, company_id),
  foreign key (item_id, company_id) references items(id, company_id));
create table stock_movements (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  seq bigserial, item_id uuid not null, batch_id uuid, location_id uuid not null,
  qty numeric(18,4) not null check (qty <> 0),
  kind text not null check (kind in ('receipt','issue','output','transfer_in','transfer_out','adjust','dispatch','scrap','reversal','return','subcontract_out','subcontract_in')),
  ref_type text, ref_id uuid, unit_cost_paise bigint not null default 0,
  reverses_id uuid unique, idempotency_key text, note text, posted_by uuid, posted_at timestamptz not null default now(),
  unique (company_id, idempotency_key),
  foreign key (item_id, company_id) references items(id, company_id),
  foreign key (location_id, company_id) references locations(id, company_id),
  foreign key (batch_id, company_id) references batches(id, company_id));
create index mov_item on stock_movements(company_id, item_id, location_id, batch_id);
create index mov_ref on stock_movements(ref_type, ref_id);
create table reservations (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  item_id uuid not null, qty numeric(18,4) not null check (qty > 0), ref_type text not null, ref_id uuid not null,
  status text not null default 'active' check (status in ('active','released','consumed')), created_at timestamptz not null default now(),
  foreign key (item_id, company_id) references items(id, company_id));
create table serials (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  item_id uuid not null, serial text not null, batch_id uuid, work_order_id uuid, shipment_id uuid,
  status text not null default 'in_stock' check (status in ('in_stock','shipped','scrapped')),
  unique (company_id, item_id, serial), foreign key (item_id, company_id) references items(id, company_id));
create table stock_counts (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  item_id uuid not null, location_id uuid not null, batch_id uuid, counted_qty numeric(18,4) not null, system_qty numeric(18,4) not null,
  status text not null default 'pending' check (status in ('pending','posted')), reason text, counted_by uuid, created_at timestamptz not null default now());

-- Production
create table work_orders (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  number text not null, item_id uuid not null, plant_id uuid not null, qty numeric(18,4) not null check (qty > 0),
  status text not null default 'planned' check (status in ('planned','released','in_progress','completed','closed','cancelled')),
  due_date date not null, so_line_id uuid, parent_wo_id uuid, is_rework boolean not null default false,
  completed_qty numeric(18,4) not null default 0 check (completed_qty >= 0), scrap_qty numeric(18,4) not null default 0 check (scrap_qty >= 0),
  bom_snapshot jsonb, routing_snapshot jsonb, item_revision text, suggestion_id uuid,
  released_at timestamptz, version int not null default 1, created_at timestamptz not null default now(),
  unique (company_id, number), unique (id, company_id),
  foreign key (item_id, company_id) references items(id, company_id),
  foreign key (plant_id, company_id) references plants(id, company_id));
create table wo_operations (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  work_order_id uuid not null, seq int not null, name text not null, work_centre_id uuid not null,
  planned_min numeric(12,2) not null, actual_min numeric(12,2) not null default 0, qty_done numeric(18,4) not null default 0,
  status text not null default 'pending' check (status in ('pending','running','paused','done')),
  planned_start date, planned_end date, actual_start timestamptz, actual_end timestamptz, started_at timestamptz,
  operator_id uuid, subcontract boolean not null default false,
  unique (work_order_id, seq), unique (id, company_id),
  foreign key (work_order_id, company_id) references work_orders(id, company_id) on delete cascade,
  foreign key (work_centre_id, company_id) references work_centres(id, company_id));
create table wo_materials (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  work_order_id uuid not null, item_id uuid not null, planned_qty numeric(18,4) not null, issued_qty numeric(18,4) not null default 0,
  unique (work_order_id, item_id),
  foreign key (work_order_id, company_id) references work_orders(id, company_id) on delete cascade,
  foreign key (item_id, company_id) references items(id, company_id));
create table schedule_history (id bigserial primary key, company_id uuid not null, operation_id uuid not null,
  old_start date, old_end date, new_start date, new_end date, reason text, changed_by uuid, at timestamptz not null default now());
create table downtime (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  work_centre_id uuid not null, machine_id uuid, minutes int not null check (minutes > 0), reason text not null,
  started_at timestamptz not null default now(), reported_by uuid,
  foreign key (work_centre_id, company_id) references work_centres(id, company_id));
create table maintenance_requests (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  machine_id uuid not null, description text not null, status text not null default 'open' check (status in ('open','in_progress','done')),
  requested_by uuid, created_at timestamptz not null default now(), closed_at timestamptz,
  foreign key (machine_id, company_id) references machines(id, company_id));

-- Quality
create table inspections (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  number text not null, kind text not null check (kind in ('incoming','in_process','final')),
  item_id uuid not null, batch_id uuid, ref_type text, ref_id uuid, qty numeric(18,4) not null,
  characteristic text not null default 'Visual / dimensional', unit text, measured numeric(18,4), min_value numeric(18,4), max_value numeric(18,4),
  status text not null default 'pending' check (status in ('pending','passed','failed')),
  decided_by uuid, decided_at timestamptz, notes text, created_at timestamptz not null default now(),
  unique (company_id, number), unique (id, company_id),
  foreign key (item_id, company_id) references items(id, company_id));
create table ncrs (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  number text not null, inspection_id uuid not null, description text not null,
  disposition text check (disposition in ('rework','return','concession','scrap')),
  status text not null default 'open' check (status in ('open','dispositioned','closed')),
  corrective_action text, decided_by uuid, decision_reason text, created_at timestamptz not null default now(),
  unique (company_id, number), foreign key (inspection_id, company_id) references inspections(id, company_id));

-- Fulfilment
create table shipments (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  number text not null, customer_id uuid not null, status text not null default 'packing' check (status in ('packing','dispatched','delivered')),
  invoice_ref text, dispatched_at timestamptz, delivered_at timestamptz, delivery_note text, created_by uuid,
  created_at timestamptz not null default now(), unique (company_id, number), unique (id, company_id),
  foreign key (customer_id, company_id) references customers(id, company_id));
create table shipment_lines (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  shipment_id uuid not null, so_line_id uuid not null, item_id uuid not null, batch_id uuid, location_id uuid not null, qty numeric(18,4) not null check (qty > 0),
  serials text[] not null default '{}',
  foreign key (shipment_id, company_id) references shipments(id, company_id) on delete cascade,
  foreign key (so_line_id, company_id) references sales_order_lines(id, company_id),
  foreign key (item_id, company_id) references items(id, company_id));
create table returns (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  number text not null, shipment_id uuid not null, item_id uuid not null, qty numeric(18,4) not null check (qty > 0), reason text not null,
  status text not null default 'awaiting_inspection' check (status in ('awaiting_inspection','restocked','scrapped')),
  created_at timestamptz not null default now(), unique (company_id, number));

-- Costing and periods
create table cost_periods (company_id uuid not null references companies(id), period text not null, status text not null default 'open' check (status in ('open','closed')),
  closed_by uuid, closed_at timestamptz, primary key (company_id, period));
create table cost_adjustments (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  work_order_id uuid not null, amount_paise bigint not null, reason text not null, period text not null, by_user uuid,
  created_at timestamptz not null default now());
create table saved_views (id uuid primary key default gen_random_uuid(), company_id uuid not null, user_id uuid not null,
  page text not null, name text not null, query text not null);
create table import_jobs (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  kind text not null, status text not null default 'preview' check (status in ('preview','committed','failed')),
  rows_total int not null, rows_ok int not null, errors jsonb not null default '[]', created_by uuid, created_at timestamptz not null default now());

-- ===== Rules =====
create function immutable_row() returns trigger language plpgsql as $$ begin raise exception 'stock_movements are immutable; post a reversal'; end $$;
create trigger mov_immutable before update or delete on stock_movements for each row execute function immutable_row();

create function check_movement() returns trigger language plpgsql as $$
declare bal numeric; bstatus text; begin
  perform pg_advisory_xact_lock(hashtextextended(new.company_id::text || new.item_id::text, 0));
  if new.batch_id is not null then
    select status into bstatus from batches where id = new.batch_id;
    if new.qty < 0 and new.kind in ('issue','dispatch','transfer_out','subcontract_out') and bstatus <> 'available' then
      raise exception 'batch is % and cannot be issued', bstatus using errcode = 'P0001'; end if;
  end if;
  if new.qty < 0 then
    select coalesce(sum(qty),0) into bal from stock_movements
      where company_id = new.company_id and item_id = new.item_id and location_id = new.location_id
        and batch_id is not distinct from new.batch_id;
    if bal + new.qty < 0 then raise exception 'insufficient stock: available %, requested %', bal, -new.qty using errcode = 'P0001'; end if;
  end if;
  return new; end $$;
create trigger mov_check before insert on stock_movements for each row execute function check_movement();

create function bom_no_cycle() returns trigger language plpgsql as $$
declare parent uuid; cyc boolean; begin
  select item_id into parent from boms where id = new.bom_id;
  if parent = new.component_item_id then raise exception 'BOM cycle: item cannot contain itself'; end if;
  with recursive d(item) as (
    select new.component_item_id
    union
    select l.component_item_id from d join boms b on b.item_id = d.item and b.status <> 'obsolete'
      join bom_lines l on l.bom_id = b.id)
  select exists(select 1 from d where item = parent) into cyc;
  if cyc then raise exception 'BOM cycle detected: adding this component would make the item contain itself'; end if;
  return new; end $$;
create trigger bom_cycle before insert or update on bom_lines for each row execute function bom_no_cycle();

create function released_bom_frozen() returns trigger language plpgsql as $$
declare st text; begin
  select status into st from boms where id = coalesce(new.bom_id, old.bom_id);
  if st in ('released','obsolete') then raise exception 'released BOMs are frozen; raise an engineering change'; end if;
  return coalesce(new, old); end $$;
create trigger bom_lines_frozen before insert or update or delete on bom_lines for each row execute function released_bom_frozen();

create view stock_balances as
  select company_id, item_id, location_id, batch_id, sum(qty) as qty from stock_movements group by 1,2,3,4 having sum(qty) <> 0;

-- ===== Row level security =====
do $$ declare t text; begin
  for t in select c.table_name from information_schema.columns c
    join information_schema.tables tb on tb.table_name = c.table_name and tb.table_schema = c.table_schema and tb.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'company_id'
      and c.table_name not in ('companies','memberships','invitations','subscriptions','platform_invoices','jobs','email_outbox','audit_log','support_tickets','support_access','notifications','sessions')
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I using (company_id = nullif(current_setting('app.company_id', true), '')::uuid) with check (company_id = nullif(current_setting('app.company_id', true), '')::uuid)$p$, t);
  end loop; end $$;
alter view stock_balances set (security_invoker = true);

grant usage on schema public to mfg_app;
grant select, insert, update, delete on all tables in schema public to mfg_app;
grant usage, select on all sequences in schema public to mfg_app;
revoke update, delete on stock_movements, audit_log, schedule_history from mfg_app;
grant execute on all functions in schema public to mfg_app;
