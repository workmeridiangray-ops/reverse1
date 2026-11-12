-- Business data. Every table carries tenant_id; child rows reference parents by (tenant_id,id)
-- so a row can never point at another company's record, even if application code is wrong.
-- Quantities are bigint thousandths of the base unit. Money is bigint paise (INR).

create table branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  code text not null, name text not null, address text, gstin text,
  status text not null default 'active' check (status in ('active','retired')),
  created_at timestamptz not null default now(),
  unique (tenant_id, code), unique (tenant_id, id)
);
create table warehouses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  branch_id uuid not null, code text not null, name text not null,
  status text not null default 'active' check (status in ('active','retired')),
  created_at timestamptz not null default now(),
  unique (tenant_id, code), unique (tenant_id, id),
  foreign key (tenant_id, branch_id) references branches(tenant_id, id)
);
create table bins (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  warehouse_id uuid not null, code text not null, description text,
  status text not null default 'active' check (status in ('active','retired')),
  unique (tenant_id, warehouse_id, code), unique (tenant_id, id),
  foreign key (tenant_id, warehouse_id) references warehouses(tenant_id, id)
);
create table departments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  code text not null, name text not null,
  status text not null default 'active' check (status in ('active','retired')),
  unique (tenant_id, code), unique (tenant_id, id)
);
create table tax_codes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  code text not null, name text not null, rate_bps int not null check (rate_bps between 0 and 10000),
  status text not null default 'active' check (status in ('active','retired')),
  unique (tenant_id, code), unique (tenant_id, id)
);
create table price_lists (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  code text not null, name text not null,
  status text not null default 'active' check (status in ('active','retired')),
  unique (tenant_id, code), unique (tenant_id, id)
);
create table items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  sku text not null, name text not null,
  kind text not null default 'goods' check (kind in ('goods','service')),
  base_unit text not null default 'pcs',
  sale_price_paise bigint not null default 0 check (sale_price_paise >= 0),
  purchase_price_paise bigint not null default 0 check (purchase_price_paise >= 0),
  tax_code_id uuid,
  reorder_level_qty bigint not null default 0,
  reorder_qty bigint not null default 0,
  barcode text,
  avg_cost_paise bigint not null default 0,
  status text not null default 'active' check (status in ('active','retired')),
  created_at timestamptz not null default now(),
  unique (tenant_id, sku), unique (tenant_id, id),
  foreign key (tenant_id, tax_code_id) references tax_codes(tenant_id, id)
);
create unique index items_barcode_uq on items(tenant_id, barcode) where barcode is not null;
create table item_uoms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  item_id uuid not null, unit text not null, factor_milli bigint not null check (factor_milli > 0),
  unique (tenant_id, item_id, unit),
  foreign key (tenant_id, item_id) references items(tenant_id, id)
);
create table price_list_items (
  tenant_id uuid not null references tenants(id) on delete cascade,
  price_list_id uuid not null, item_id uuid not null, price_paise bigint not null check (price_paise >= 0),
  primary key (tenant_id, price_list_id, item_id),
  foreign key (tenant_id, price_list_id) references price_lists(tenant_id, id),
  foreign key (tenant_id, item_id) references items(tenant_id, id)
);
create table customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  code text not null, name text not null, email text, phone text, gstin text, billing_address text,
  credit_limit_paise bigint not null default 0 check (credit_limit_paise >= 0),
  payment_terms_days int not null default 30,
  price_list_id uuid,
  status text not null default 'active' check (status in ('active','retired')),
  created_at timestamptz not null default now(),
  unique (tenant_id, code), unique (tenant_id, id),
  foreign key (tenant_id, price_list_id) references price_lists(tenant_id, id)
);
create table suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  code text not null, name text not null, email text, phone text, gstin text, address text,
  lead_time_days int not null default 7, payment_terms_days int not null default 30,
  doc_expiry_on date, doc_note text,
  status text not null default 'active' check (status in ('active','retired')),
  created_at timestamptz not null default now(),
  unique (tenant_id, code), unique (tenant_id, id)
);
create table fin_periods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  label text not null, starts_on date not null, ends_on date not null,
  status text not null default 'open' check (status in ('open','closed')),
  closed_by uuid, closed_at timestamptz,
  check (ends_on >= starts_on),
  unique (tenant_id, starts_on), unique (tenant_id, id)
);
create table number_sequences (
  tenant_id uuid not null references tenants(id) on delete cascade,
  key text not null, prefix text not null, next_no bigint not null default 1,
  primary key (tenant_id, key)
);
create table accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  code text not null, name text not null,
  type text not null check (type in ('asset','liability','equity','income','expense')),
  system_key text,
  status text not null default 'active' check (status in ('active','retired')),
  unique (tenant_id, code), unique (tenant_id, id)
);
create unique index accounts_system_uq on accounts(tenant_id, system_key) where system_key is not null;

-- ---------- approvals ----------
create table approval_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  entity_type text not null check (entity_type in ('quote','purchase_request','purchase_order','supplier_bill','expense','journal','credit_note','stock_adjustment')),
  min_amount_paise bigint not null default 0,
  approver_permission text not null,
  version int not null default 1,
  effective_from timestamptz not null default now(),
  status text not null default 'active' check (status in ('active','retired')),
  unique (tenant_id, id)
);
create table approval_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  entity_type text not null, entity_id uuid not null, entity_ref text,
  amount_paise bigint not null default 0,
  approver_permission text not null,
  impact jsonb not null default '{}',
  requested_by uuid not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by uuid, decided_at timestamptz, reason text,
  delegated_to uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create index approvals_pending_idx on approval_requests(tenant_id, status);
create unique index approvals_one_pending on approval_requests(tenant_id, entity_type, entity_id) where status = 'pending';

-- ---------- stock ----------
create table stock_balances (
  tenant_id uuid not null references tenants(id) on delete cascade,
  item_id uuid not null, warehouse_id uuid not null,
  on_hand bigint not null default 0,
  reserved bigint not null default 0,
  in_transit bigint not null default 0,   -- inbound, not yet received here
  primary key (tenant_id, item_id, warehouse_id),
  check (on_hand >= 0), check (reserved >= 0), check (reserved <= on_hand), check (in_transit >= 0),
  foreign key (tenant_id, item_id) references items(tenant_id, id),
  foreign key (tenant_id, warehouse_id) references warehouses(tenant_id, id)
);
create table stock_movements (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  item_id uuid not null, warehouse_id uuid not null,
  qty_delta bigint not null check (qty_delta <> 0),
  kind text not null check (kind in ('opening','receipt','dispatch','transfer_out','transfer_in','adjustment','return_in','supplier_return','reversal')),
  unit_cost_paise bigint not null default 0,
  doc_type text not null, doc_id uuid not null, doc_line_id uuid,
  reverses_id bigint references stock_movements(id),
  note text,
  created_by uuid, created_at timestamptz not null default now(),
  foreign key (tenant_id, item_id) references items(tenant_id, id),
  foreign key (tenant_id, warehouse_id) references warehouses(tenant_id, id)
);
-- one posting per document line and kind: duplicate posting is rejected by the database
create unique index stock_movements_dedupe on stock_movements(tenant_id, doc_type, doc_line_id, kind) where doc_line_id is not null and kind <> 'reversal';
create unique index stock_movements_one_reversal on stock_movements(reverses_id) where reverses_id is not null;
create index stock_movements_item_idx on stock_movements(tenant_id, item_id, id);
create trigger stock_movements_immutable before update or delete on stock_movements for each row execute function forbid_mutation();

create table stock_transfers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  number text not null, from_warehouse_id uuid not null, to_warehouse_id uuid not null,
  item_id uuid not null, qty bigint not null check (qty > 0), unit_cost_paise bigint not null default 0,
  status text not null default 'in_transit' check (status in ('in_transit','received','cancelled')),
  created_by uuid, created_at timestamptz not null default now(), received_at timestamptz,
  check (from_warehouse_id <> to_warehouse_id),
  unique (tenant_id, number), unique (tenant_id, id),
  foreign key (tenant_id, from_warehouse_id) references warehouses(tenant_id, id),
  foreign key (tenant_id, to_warehouse_id) references warehouses(tenant_id, id),
  foreign key (tenant_id, item_id) references items(tenant_id, id)
);
create table stock_counts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  number text not null, warehouse_id uuid not null, item_id uuid not null,
  system_qty bigint not null, counted_qty bigint not null, variance_qty bigint not null,
  status text not null default 'pending' check (status in ('pending','posted','rejected')),
  reason text, created_by uuid, created_at timestamptz not null default now(),
  unique (tenant_id, number), unique (tenant_id, id),
  foreign key (tenant_id, warehouse_id) references warehouses(tenant_id, id),
  foreign key (tenant_id, item_id) references items(tenant_id, id)
);

-- ---------- sales ----------
create table quotes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  number text not null, version int not null default 1, root_id uuid,
  customer_id uuid not null, branch_id uuid not null,
  status text not null default 'draft' check (status in ('draft','pending_approval','approved','accepted','rejected','superseded','expired')),
  valid_until date, notes text,
  subtotal_paise bigint not null default 0, tax_paise bigint not null default 0, total_paise bigint not null default 0,
  created_by uuid, created_at timestamptz not null default now(),
  unique (tenant_id, number), unique (tenant_id, id),
  foreign key (tenant_id, customer_id) references customers(tenant_id, id),
  foreign key (tenant_id, branch_id) references branches(tenant_id, id)
);
create table quote_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  quote_id uuid not null, line_no int not null, item_id uuid not null,
  qty bigint not null check (qty > 0), uom text not null, uom_factor_milli bigint not null default 1000,
  unit_price_paise bigint not null check (unit_price_paise >= 0), discount_bps int not null default 0 check (discount_bps between 0 and 10000),
  tax_bps int not null default 0,
  net_paise bigint not null, tax_paise bigint not null, total_paise bigint not null,
  unique (tenant_id, id),
  foreign key (tenant_id, quote_id) references quotes(tenant_id, id) on delete cascade,
  foreign key (tenant_id, item_id) references items(tenant_id, id)
);
create table sales_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  number text not null, quote_id uuid,
  customer_id uuid not null, branch_id uuid not null, warehouse_id uuid not null,
  status text not null default 'draft' check (status in ('draft','confirmed','credit_hold','partially_fulfilled','fulfilled','cancelled','closed')),
  row_version int not null default 1,
  order_date date not null default current_date, promised_date date,
  credit_override_reason text,
  subtotal_paise bigint not null default 0, tax_paise bigint not null default 0, total_paise bigint not null default 0,
  cancel_reason text, notes text,
  created_by uuid, created_at timestamptz not null default now(),
  unique (tenant_id, number), unique (tenant_id, id),
  foreign key (tenant_id, quote_id) references quotes(tenant_id, id),
  foreign key (tenant_id, customer_id) references customers(tenant_id, id),
  foreign key (tenant_id, branch_id) references branches(tenant_id, id),
  foreign key (tenant_id, warehouse_id) references warehouses(tenant_id, id)
);
create table sales_order_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  order_id uuid not null, line_no int not null, item_id uuid not null,
  qty bigint not null check (qty > 0),                      -- base units
  uom text not null, uom_factor_milli bigint not null default 1000, uom_qty bigint not null,
  unit_price_paise bigint not null check (unit_price_paise >= 0),  -- per base unit
  discount_bps int not null default 0 check (discount_bps between 0 and 10000), tax_bps int not null default 0,
  net_paise bigint not null, tax_paise bigint not null, total_paise bigint not null,
  reserved_qty bigint not null default 0, dispatched_qty bigint not null default 0,
  invoiced_qty bigint not null default 0, returned_qty bigint not null default 0,
  check (reserved_qty >= 0 and dispatched_qty >= 0 and invoiced_qty >= 0 and returned_qty >= 0),
  check (dispatched_qty + reserved_qty <= qty), check (invoiced_qty <= dispatched_qty), check (returned_qty <= dispatched_qty),
  unique (tenant_id, id),
  foreign key (tenant_id, order_id) references sales_orders(tenant_id, id) on delete cascade,
  foreign key (tenant_id, item_id) references items(tenant_id, id)
);

-- ---------- procurement ----------
create table purchase_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  number text not null, branch_id uuid not null, source_order_id uuid,
  department_id uuid, reason text,
  status text not null default 'draft' check (status in ('draft','pending_approval','approved','rejected','converted','cancelled')),
  created_by uuid, created_at timestamptz not null default now(),
  unique (tenant_id, number), unique (tenant_id, id),
  foreign key (tenant_id, branch_id) references branches(tenant_id, id),
  foreign key (tenant_id, source_order_id) references sales_orders(tenant_id, id),
  foreign key (tenant_id, department_id) references departments(tenant_id, id)
);
create table purchase_request_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  request_id uuid not null, item_id uuid not null, qty bigint not null check (qty > 0),
  supplier_id uuid, est_unit_cost_paise bigint not null default 0,
  unique (tenant_id, id),
  foreign key (tenant_id, request_id) references purchase_requests(tenant_id, id) on delete cascade,
  foreign key (tenant_id, item_id) references items(tenant_id, id),
  foreign key (tenant_id, supplier_id) references suppliers(tenant_id, id)
);
create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  number text not null, request_id uuid, supplier_id uuid not null,
  branch_id uuid not null, warehouse_id uuid not null,
  status text not null default 'draft' check (status in ('draft','pending_approval','approved','sent','acknowledged','partially_received','received','cancelled','closed')),
  expected_date date, supplier_ack_ref text, notes text,
  subtotal_paise bigint not null default 0, tax_paise bigint not null default 0, total_paise bigint not null default 0,
  created_by uuid, created_at timestamptz not null default now(),
  unique (tenant_id, number), unique (tenant_id, id),
  foreign key (tenant_id, request_id) references purchase_requests(tenant_id, id),
  foreign key (tenant_id, supplier_id) references suppliers(tenant_id, id),
  foreign key (tenant_id, branch_id) references branches(tenant_id, id),
  foreign key (tenant_id, warehouse_id) references warehouses(tenant_id, id)
);
create table purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  order_id uuid not null, line_no int not null, item_id uuid not null,
  qty bigint not null check (qty > 0), uom text not null, uom_factor_milli bigint not null default 1000,
  unit_cost_paise bigint not null check (unit_cost_paise >= 0),  -- per base unit
  tax_bps int not null default 0,
  net_paise bigint not null, tax_paise bigint not null, total_paise bigint not null,
  received_qty bigint not null default 0, billed_qty bigint not null default 0, returned_qty bigint not null default 0,
  check (received_qty >= 0 and billed_qty >= 0 and returned_qty >= 0 and returned_qty <= received_qty),
  unique (tenant_id, id),
  foreign key (tenant_id, order_id) references purchase_orders(tenant_id, id) on delete cascade,
  foreign key (tenant_id, item_id) references items(tenant_id, id)
);
create table goods_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  number text not null, order_id uuid not null, warehouse_id uuid not null,
  supplier_delivery_ref text, status text not null default 'posted' check (status in ('posted','reversed')),
  journal_id uuid,
  created_by uuid, created_at timestamptz not null default now(),
  unique (tenant_id, number), unique (tenant_id, id),
  foreign key (tenant_id, order_id) references purchase_orders(tenant_id, id),
  foreign key (tenant_id, warehouse_id) references warehouses(tenant_id, id)
);
create table goods_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  receipt_id uuid not null, po_line_id uuid not null, item_id uuid not null,
  qty bigint not null check (qty > 0), unit_cost_paise bigint not null,
  unique (tenant_id, id),
  foreign key (tenant_id, receipt_id) references goods_receipts(tenant_id, id) on delete cascade,
  foreign key (tenant_id, po_line_id) references purchase_order_lines(tenant_id, id),
  foreign key (tenant_id, item_id) references items(tenant_id, id)
);
create table supplier_returns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  number text not null, order_id uuid not null, po_line_id uuid not null, warehouse_id uuid not null,
  item_id uuid not null, qty bigint not null check (qty > 0), unit_cost_paise bigint not null,
  reason text not null, journal_id uuid,
  created_by uuid, created_at timestamptz not null default now(),
  unique (tenant_id, number), unique (tenant_id, id),
  foreign key (tenant_id, order_id) references purchase_orders(tenant_id, id),
  foreign key (tenant_id, po_line_id) references purchase_order_lines(tenant_id, id),
  foreign key (tenant_id, warehouse_id) references warehouses(tenant_id, id)
);
create table supplier_bills (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  number text not null, supplier_id uuid not null, order_id uuid,
  supplier_ref text not null, bill_date date not null, due_date date not null,
  status text not null default 'draft' check (status in ('draft','exception','posted','partially_paid','paid','void')),
  match_status text not null default 'unmatched' check (match_status in ('unmatched','matched','exception','exception_approved')),
  match_detail jsonb not null default '{}',
  subtotal_paise bigint not null default 0, tax_paise bigint not null default 0, total_paise bigint not null default 0,
  paid_paise bigint not null default 0,
  journal_id uuid,
  created_by uuid, created_at timestamptz not null default now(),
  check (paid_paise >= 0 and paid_paise <= total_paise),
  unique (tenant_id, number), unique (tenant_id, id),
  unique (tenant_id, supplier_id, supplier_ref),
  foreign key (tenant_id, supplier_id) references suppliers(tenant_id, id),
  foreign key (tenant_id, order_id) references purchase_orders(tenant_id, id)
);
create table supplier_bill_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  bill_id uuid not null, po_line_id uuid not null, item_id uuid not null,
  qty bigint not null check (qty > 0), unit_cost_paise bigint not null,
  net_paise bigint not null, tax_bps int not null default 0, tax_paise bigint not null,
  foreign key (tenant_id, bill_id) references supplier_bills(tenant_id, id) on delete cascade,
  foreign key (tenant_id, po_line_id) references purchase_order_lines(tenant_id, id)
);

-- ---------- fulfilment ----------
create table dispatches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  number text not null, order_id uuid not null, warehouse_id uuid not null,
  status text not null default 'posted' check (status in ('posted','delivered','reversed')),
  carrier text, tracking_ref text, delivered_at timestamptz, delivery_note text,
  journal_id uuid,
  created_by uuid, created_at timestamptz not null default now(),
  unique (tenant_id, number), unique (tenant_id, id),
  foreign key (tenant_id, order_id) references sales_orders(tenant_id, id),
  foreign key (tenant_id, warehouse_id) references warehouses(tenant_id, id)
);
create table dispatch_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  dispatch_id uuid not null, order_line_id uuid not null, item_id uuid not null,
  qty bigint not null check (qty > 0), unit_cost_paise bigint not null,
  unique (tenant_id, id),
  foreign key (tenant_id, dispatch_id) references dispatches(tenant_id, id) on delete cascade,
  foreign key (tenant_id, order_line_id) references sales_order_lines(tenant_id, id)
);
create table customer_returns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  number text not null, order_id uuid not null, order_line_id uuid not null, dispatch_line_id uuid,
  item_id uuid not null, warehouse_id uuid not null,
  qty bigint not null check (qty > 0), unit_cost_paise bigint not null, refund_net_paise bigint not null, refund_tax_paise bigint not null,
  reason text not null,
  status text not null default 'requested' check (status in ('requested','inspected','closed','rejected')),
  outcome text check (outcome in ('restock','reject')),
  inspection_note text, credit_note_id uuid, journal_id uuid,
  created_by uuid, created_at timestamptz not null default now(),
  unique (tenant_id, number), unique (tenant_id, id),
  foreign key (tenant_id, order_id) references sales_orders(tenant_id, id),
  foreign key (tenant_id, order_line_id) references sales_order_lines(tenant_id, id),
  foreign key (tenant_id, warehouse_id) references warehouses(tenant_id, id)
);

-- ---------- finance ----------
create table journals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  number text not null, entry_date date not null, memo text,
  status text not null default 'draft' check (status in ('draft','posted','reversed')),
  source_type text, source_id uuid,
  reverses_id uuid, reversal_reason text,
  posted_by uuid, posted_at timestamptz,
  created_by uuid, created_at timestamptz not null default now(),
  unique (tenant_id, number), unique (tenant_id, id),
  foreign key (tenant_id, reverses_id) references journals(tenant_id, id)
);
create unique index journals_one_reversal on journals(tenant_id, reverses_id) where reverses_id is not null;
create unique index journals_source_uq on journals(tenant_id, source_type, source_id) where source_type is not null and reverses_id is null;
create table journal_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  journal_id uuid not null, account_id uuid not null,
  debit_paise bigint not null default 0 check (debit_paise >= 0),
  credit_paise bigint not null default 0 check (credit_paise >= 0),
  branch_id uuid, memo text,
  check ((debit_paise = 0) <> (credit_paise = 0)),
  foreign key (tenant_id, journal_id) references journals(tenant_id, id) on delete cascade,
  foreign key (tenant_id, account_id) references accounts(tenant_id, id)
);
create index journal_lines_acct_idx on journal_lines(tenant_id, account_id);
create table invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  number text not null, order_id uuid, customer_id uuid not null, branch_id uuid not null,
  status text not null default 'posted' check (status in ('posted','partially_paid','paid','void')),
  issue_date date not null, due_date date not null,
  subtotal_paise bigint not null, tax_paise bigint not null, total_paise bigint not null,
  paid_paise bigint not null default 0, credited_paise bigint not null default 0,
  journal_id uuid,
  created_by uuid, created_at timestamptz not null default now(),
  check (paid_paise >= 0 and credited_paise >= 0 and paid_paise + credited_paise <= total_paise),
  unique (tenant_id, number), unique (tenant_id, id),
  foreign key (tenant_id, order_id) references sales_orders(tenant_id, id),
  foreign key (tenant_id, customer_id) references customers(tenant_id, id),
  foreign key (tenant_id, branch_id) references branches(tenant_id, id)
);
create table invoice_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  invoice_id uuid not null, order_line_id uuid, item_id uuid not null, description text,
  qty bigint not null check (qty > 0), unit_price_paise bigint not null, discount_bps int not null default 0, tax_bps int not null default 0,
  net_paise bigint not null, tax_paise bigint not null, total_paise bigint not null,
  unique (tenant_id, id),
  foreign key (tenant_id, invoice_id) references invoices(tenant_id, id) on delete cascade,
  foreign key (tenant_id, order_line_id) references sales_order_lines(tenant_id, id)
);
create table credit_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  number text not null, kind text not null default 'credit' check (kind in ('credit','debit')),
  invoice_id uuid not null, net_paise bigint not null check (net_paise >= 0), tax_paise bigint not null check (tax_paise >= 0),
  reason text not null, journal_id uuid,
  created_by uuid, created_at timestamptz not null default now(),
  unique (tenant_id, number), unique (tenant_id, id),
  foreign key (tenant_id, invoice_id) references invoices(tenant_id, id)
);
create table receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  number text not null, customer_id uuid not null, amount_paise bigint not null check (amount_paise > 0),
  allocated_paise bigint not null default 0,
  method text not null check (method in ('cash','bank','upi','card','cheque')), reference text, received_on date not null,
  status text not null default 'posted' check (status in ('posted','reversed')),
  journal_id uuid,
  created_by uuid, created_at timestamptz not null default now(),
  check (allocated_paise >= 0 and allocated_paise <= amount_paise),
  unique (tenant_id, number), unique (tenant_id, id),
  foreign key (tenant_id, customer_id) references customers(tenant_id, id)
);
create table receipt_allocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  receipt_id uuid not null, invoice_id uuid not null, amount_paise bigint not null check (amount_paise > 0),
  foreign key (tenant_id, receipt_id) references receipts(tenant_id, id),
  foreign key (tenant_id, invoice_id) references invoices(tenant_id, id)
);
create table supplier_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  number text not null, supplier_id uuid not null, bill_id uuid not null,
  amount_paise bigint not null check (amount_paise > 0),
  method text not null check (method in ('cash','bank','upi','card','cheque')), reference text, paid_on date not null,
  journal_id uuid,
  created_by uuid, created_at timestamptz not null default now(),
  unique (tenant_id, number),
  foreign key (tenant_id, supplier_id) references suppliers(tenant_id, id),
  foreign key (tenant_id, bill_id) references supplier_bills(tenant_id, id)
);
create table expenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  number text not null, branch_id uuid, expense_date date not null, description text not null,
  account_id uuid not null, amount_paise bigint not null check (amount_paise > 0),
  paid_via text not null default 'cash' check (paid_via in ('cash','bank')),
  status text not null default 'draft' check (status in ('draft','pending_approval','approved','posted','rejected')),
  file_id uuid, journal_id uuid,
  created_by uuid, created_at timestamptz not null default now(),
  unique (tenant_id, number), unique (tenant_id, id),
  foreign key (tenant_id, account_id) references accounts(tenant_id, id)
);

-- ---------- files ----------
create table files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  owner_type text not null, owner_id uuid not null,
  filename text not null, mime text not null, size_bytes int not null, sha256 text not null,
  data bytea not null,
  uploaded_by uuid, created_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create index files_owner_idx on files(tenant_id, owner_type, owner_id);

-- ---------- config studio: custom fields, saved views, workforce, projects, assets ----------
create table custom_fields (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  entity text not null check (entity in ('customers','suppliers','items')),
  key text not null, label text not null, kind text not null check (kind in ('text','number','date')),
  version int not null default 1, status text not null default 'active' check (status in ('active','retired')),
  unique (tenant_id, entity, key)
);
create table custom_values (
  tenant_id uuid not null references tenants(id) on delete cascade,
  entity text not null, record_id uuid not null, key text not null, value text,
  primary key (tenant_id, entity, record_id, key)
);
create table saved_views (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null, scope text not null, name text not null, query text not null,
  created_at timestamptz not null default now()
);
create table employees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  code text not null, name text not null, email text, phone text, designation text,
  department_id uuid, branch_id uuid, user_id uuid,
  joined_on date, exit_on date,
  pii_pan text, pii_bank_account text,       -- restricted to hr.sensitive
  status text not null default 'active' check (status in ('active','exited')),
  created_at timestamptz not null default now(),
  unique (tenant_id, code), unique (tenant_id, id)
);
create table leave_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  employee_id uuid not null, leave_type text not null, starts_on date not null, ends_on date not null, reason text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by uuid, decision_reason text, created_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  foreign key (tenant_id, employee_id) references employees(tenant_id, id)
);
create table attendance_summaries (
  tenant_id uuid not null references tenants(id) on delete cascade,
  employee_id uuid not null, month date not null, days_present int not null, days_absent int not null, days_leave int not null,
  primary key (tenant_id, employee_id, month),
  foreign key (tenant_id, employee_id) references employees(tenant_id, id)
);
create table checklist_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  employee_id uuid not null, kind text not null check (kind in ('joining','exit','asset_return')),
  title text not null, done_at timestamptz,
  foreign key (tenant_id, employee_id) references employees(tenant_id, id)
);
create table projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  code text not null, name text not null, customer_id uuid, order_id uuid,
  budget_paise bigint not null default 0, status text not null default 'active' check (status in ('planned','active','closed')),
  created_at timestamptz not null default now(),
  unique (tenant_id, code), unique (tenant_id, id)
);
create table project_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null, title text not null, assignee_id uuid, milestone text,
  status text not null default 'open' check (status in ('open','in_progress','done')),
  foreign key (tenant_id, project_id) references projects(tenant_id, id)
);
create table time_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null, employee_id uuid not null, work_date date not null, minutes int not null check (minutes > 0),
  cost_rate_paise_per_hour bigint not null default 0, note text,
  status text not null default 'submitted' check (status in ('submitted','approved','rejected')),
  decided_by uuid,
  foreign key (tenant_id, project_id) references projects(tenant_id, id),
  foreign key (tenant_id, employee_id) references employees(tenant_id, id)
);
create table project_costs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null, kind text not null check (kind in ('expense','purchase')), description text not null,
  amount_paise bigint not null check (amount_paise > 0), cost_date date not null,
  foreign key (tenant_id, project_id) references projects(tenant_id, id)
);
create table assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  tag text not null, name text not null, branch_id uuid, assigned_to uuid, location text,
  warranty_until date, next_service_on date,
  status text not null default 'in_service' check (status in ('in_service','under_repair','disposal_pending','disposed')),
  created_at timestamptz not null default now(),
  unique (tenant_id, tag), unique (tenant_id, id)
);
create table asset_tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  asset_id uuid not null, number text not null, issue text not null, technician_id uuid,
  status text not null default 'open' check (status in ('open','work_order','resolved')),
  service_report text, spare_item_id uuid, spare_qty bigint, cost_paise bigint not null default 0,
  opened_at timestamptz not null default now(), resolved_at timestamptz,
  unique (tenant_id, number),
  foreign key (tenant_id, asset_id) references assets(tenant_id, id)
);
