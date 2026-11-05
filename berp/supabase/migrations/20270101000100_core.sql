-- BERP core schema: multi-tenant foundation, masters, inventory, sales, purchasing, finance.
-- Conventions: every business table carries tenant_id; money is integer paise (bigint);
-- quantities are numeric(14,3); posted records are immutable and corrected by reversal.

create schema if not exists app;

create type public.app_role as enum ('owner','manager','sales','purchasing','warehouse','accountant','viewer');

-- ---------------------------------------------------------------- plans & tenants
create table public.plans (
  code text primary key,
  name text not null,
  price_monthly_paise bigint not null check (price_monthly_paise >= 0),
  price_yearly_paise bigint not null check (price_yearly_paise >= 0),
  max_users int not null check (max_users > 0),
  max_branches int not null check (max_branches > 0),
  max_warehouses int not null check (max_warehouses > 0),
  active boolean not null default true
);
insert into public.plans values
  ('trial','Trial (14 days)',0,0,3,1,1,true),
  ('starter','Starter',299900,2999000,5,1,2,true),
  ('growth','Growth',799900,7999000,25,5,10,true),
  ('scale','Scale',1999900,19999000,100,25,50,true);

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  plan_code text not null references public.plans(code) default 'trial',
  status text not null default 'trial' check (status in ('trial','active','past_due','suspended','cancelled')),
  trial_ends_at timestamptz not null default now() + interval '14 days',
  currency text not null default 'INR' check (currency = 'INR'),
  bill_tolerance_bp int not null default 200 check (bill_tolerance_bp between 0 and 2000),
  credit_check boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  active_tenant_id uuid references public.tenants(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.memberships (
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  role public.app_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);
create index on public.memberships (tenant_id);

create table public.platform_admins (user_id uuid primary key references auth.users(id) on delete cascade);

create table public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('trial_started','plan_changed','payment_succeeded','payment_failed','cancelled','suspended','reactivated')),
  plan_code text references public.plans(code),
  provider_ref text,
  note text,
  created_at timestamptz not null default now()
);

-- per-tenant gap-free counters (SO-0001 ...)
create table app.counters (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null,
  last bigint not null default 0,
  primary key (tenant_id, kind)
);

-- ---------------------------------------------------------------- organisation & masters
create table public.branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null, name text not null, active boolean not null default true,
  unique (tenant_id, code), unique (tenant_id, id)
);
create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null,
  code text not null, name text not null, active boolean not null default true,
  unique (tenant_id, code), unique (tenant_id, id),
  foreign key (tenant_id, branch_id) references public.branches(tenant_id, id)
);
create table public.tax_codes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null, rate_bp int not null check (rate_bp between 0 and 10000), active boolean not null default true,
  unique (tenant_id, code), unique (tenant_id, id)
);
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) > 0), email text, phone text, gstin text,
  credit_limit_paise bigint check (credit_limit_paise is null or credit_limit_paise >= 0), -- null = no limit
  active boolean not null default true, created_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) > 0), email text, phone text, gstin text,
  active boolean not null default true, created_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create table public.items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sku text not null check (sku ~ '^[A-Za-z0-9._-]{1,40}$'),
  name text not null check (length(trim(name)) > 0),
  kind text not null default 'stock' check (kind in ('stock','service')),
  unit text not null default 'nos',
  sale_price_paise bigint not null default 0 check (sale_price_paise >= 0),
  cost_paise bigint not null default 0 check (cost_paise >= 0),
  tax_code_id uuid,
  reorder_level numeric(14,3) not null default 0 check (reorder_level >= 0),
  active boolean not null default true, created_at timestamptz not null default now(),
  unique (tenant_id, sku), unique (tenant_id, id),
  foreign key (tenant_id, tax_code_id) references public.tax_codes(tenant_id, id)
);

-- ---------------------------------------------------------------- finance
create type public.account_type as enum ('asset','liability','equity','income','expense');
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null, name text not null, type public.account_type not null,
  system_key text, active boolean not null default true,
  unique (tenant_id, code), unique (tenant_id, id), unique (tenant_id, system_key)
);
create table public.period_locks (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  locked_through date not null, locked_by uuid, locked_at timestamptz not null default now()
);
create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  number text not null, entry_date date not null, memo text not null default '',
  source_type text not null, source_id uuid,
  reverses_id uuid, reversal_reason text,
  created_by uuid, created_at timestamptz not null default now(),
  unique (tenant_id, number), unique (tenant_id, id)
);
create unique index journal_one_reversal on public.journal_entries (reverses_id) where reverses_id is not null;
create table public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  entry_id uuid not null,
  account_id uuid not null,
  debit_paise bigint not null default 0 check (debit_paise >= 0),
  credit_paise bigint not null default 0 check (credit_paise >= 0),
  check ((debit_paise = 0) <> (credit_paise = 0)),
  foreign key (tenant_id, entry_id) references public.journal_entries(tenant_id, id),
  foreign key (tenant_id, account_id) references public.accounts(tenant_id, id)
);
create index on public.journal_lines (tenant_id, account_id);
create index on public.journal_lines (entry_id);

-- ---------------------------------------------------------------- sales
create table public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  number text not null,
  customer_id uuid not null, warehouse_id uuid not null,
  status text not null default 'draft' check (status in ('draft','confirmed','partially_dispatched','dispatched','invoiced','cancelled')),
  order_date date not null default current_date,
  credit_override_reason text,
  notes text not null default '',
  created_by uuid, created_at timestamptz not null default now(),
  unique (tenant_id, number), unique (tenant_id, id),
  foreign key (tenant_id, customer_id) references public.customers(tenant_id, id),
  foreign key (tenant_id, warehouse_id) references public.warehouses(tenant_id, id)
);
create table public.sales_order_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  order_id uuid not null, line_no int not null,
  item_id uuid not null,
  qty numeric(14,3) not null check (qty > 0),
  unit_price_paise bigint not null check (unit_price_paise >= 0),
  discount_bp int not null default 0 check (discount_bp between 0 and 10000),
  tax_rate_bp int not null default 0 check (tax_rate_bp between 0 and 10000),
  qty_dispatched numeric(14,3) not null default 0 check (qty_dispatched >= 0),
  qty_invoiced numeric(14,3) not null default 0 check (qty_invoiced >= 0),
  check (qty_dispatched <= qty), check (qty_invoiced <= qty_dispatched),
  unique (tenant_id, id), unique (order_id, line_no),
  foreign key (tenant_id, order_id) references public.sales_orders(tenant_id, id) on delete cascade,
  foreign key (tenant_id, item_id) references public.items(tenant_id, id)
);
create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  so_line_id uuid not null, item_id uuid not null, warehouse_id uuid not null,
  qty numeric(14,3) not null check (qty > 0),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, so_line_id) references public.sales_order_lines(tenant_id, id) on delete cascade,
  foreign key (tenant_id, warehouse_id) references public.warehouses(tenant_id, id)
);
create index on public.reservations (tenant_id, item_id, warehouse_id);
create index on public.reservations (so_line_id);

-- ---------------------------------------------------------------- inventory ledger
create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  item_id uuid not null, warehouse_id uuid not null,
  qty numeric(14,3) not null check (qty <> 0),
  kind text not null check (kind in ('receipt','dispatch','adjustment','customer_return','reversal')),
  unit_cost_paise bigint not null default 0,
  ref_type text not null, ref_id uuid not null, ref_line_id uuid,
  reverses_id uuid, reason text,
  created_by uuid, created_at timestamptz not null default now(),
  foreign key (tenant_id, item_id) references public.items(tenant_id, id),
  foreign key (tenant_id, warehouse_id) references public.warehouses(tenant_id, id)
);
-- duplicate-posting guard: one movement per source line and kind
create unique index stock_no_duplicate_post on public.stock_movements (tenant_id, ref_type, ref_line_id, kind)
  where ref_line_id is not null and kind in ('receipt','dispatch');
create unique index stock_one_reversal on public.stock_movements (reverses_id) where reverses_id is not null;
create index on public.stock_movements (tenant_id, item_id, warehouse_id);

-- ---------------------------------------------------------------- purchasing
create table public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  number text not null,
  item_id uuid not null, warehouse_id uuid not null,
  qty numeric(14,3) not null check (qty > 0),
  so_line_id uuid,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decision_reason text,
  decided_by uuid, created_at timestamptz not null default now(),
  unique (tenant_id, number), unique (tenant_id, id),
  foreign key (tenant_id, item_id) references public.items(tenant_id, id),
  foreign key (tenant_id, warehouse_id) references public.warehouses(tenant_id, id)
);
create unique index pr_one_pending_per_line on public.purchase_requests (so_line_id) where so_line_id is not null and status in ('pending','approved');
create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  number text not null, supplier_id uuid not null, warehouse_id uuid not null,
  status text not null default 'open' check (status in ('open','partially_received','received','billed','cancelled')),
  request_id uuid,
  created_by uuid, created_at timestamptz not null default now(),
  unique (tenant_id, number), unique (tenant_id, id),
  foreign key (tenant_id, supplier_id) references public.suppliers(tenant_id, id),
  foreign key (tenant_id, warehouse_id) references public.warehouses(tenant_id, id)
);
create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null, po_id uuid not null, item_id uuid not null,
  qty numeric(14,3) not null check (qty > 0),
  unit_cost_paise bigint not null check (unit_cost_paise >= 0),
  tax_rate_bp int not null default 0 check (tax_rate_bp between 0 and 10000),
  qty_received numeric(14,3) not null default 0 check (qty_received >= 0),
  qty_billed numeric(14,3) not null default 0 check (qty_billed >= 0),
  check (qty_received <= qty), check (qty_billed <= qty_received),
  unique (tenant_id, id),
  foreign key (tenant_id, po_id) references public.purchase_orders(tenant_id, id) on delete cascade,
  foreign key (tenant_id, item_id) references public.items(tenant_id, id)
);
create table public.goods_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  number text not null, po_id uuid not null, idempotency_key text,
  received_by uuid, created_at timestamptz not null default now(),
  unique (tenant_id, number), unique (tenant_id, idempotency_key), unique (tenant_id, id),
  foreign key (tenant_id, po_id) references public.purchase_orders(tenant_id, id)
);
create table public.goods_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null, receipt_id uuid not null, po_line_id uuid not null,
  qty numeric(14,3) not null check (qty > 0),
  foreign key (tenant_id, receipt_id) references public.goods_receipts(tenant_id, id) on delete cascade,
  foreign key (tenant_id, po_line_id) references public.purchase_order_lines(tenant_id, id)
);
create table public.supplier_bills (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  number text not null, po_id uuid not null, supplier_ref text not null,
  subtotal_paise bigint not null, tax_paise bigint not null, total_paise bigint not null,
  paid_paise bigint not null default 0 check (paid_paise >= 0),
  exception_reason text, created_by uuid, created_at timestamptz not null default now(),
  unique (tenant_id, number), unique (tenant_id, id), unique (tenant_id, po_id, supplier_ref),
  foreign key (tenant_id, po_id) references public.purchase_orders(tenant_id, id),
  check (paid_paise <= total_paise)
);

-- ---------------------------------------------------------------- fulfilment & receivables
create table public.dispatches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  number text not null, order_id uuid not null, carrier_ref text,
  dispatched_by uuid, created_at timestamptz not null default now(),
  unique (tenant_id, number), unique (tenant_id, id),
  foreign key (tenant_id, order_id) references public.sales_orders(tenant_id, id)
);
create table public.dispatch_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null, dispatch_id uuid not null, so_line_id uuid not null,
  qty numeric(14,3) not null check (qty > 0), unit_cost_paise bigint not null default 0,
  foreign key (tenant_id, dispatch_id) references public.dispatches(tenant_id, id) on delete cascade,
  foreign key (tenant_id, so_line_id) references public.sales_order_lines(tenant_id, id)
);
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  number text not null, order_id uuid not null, customer_id uuid not null,
  invoice_date date not null default current_date,
  subtotal_paise bigint not null, tax_paise bigint not null, total_paise bigint not null,
  paid_paise bigint not null default 0 check (paid_paise >= 0),
  status text not null default 'posted' check (status in ('posted','partially_paid','paid','reversed')),
  created_by uuid, created_at timestamptz not null default now(),
  unique (tenant_id, number), unique (tenant_id, id),
  check (paid_paise <= total_paise),
  foreign key (tenant_id, order_id) references public.sales_orders(tenant_id, id),
  foreign key (tenant_id, customer_id) references public.customers(tenant_id, id)
);
create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null, invoice_id uuid not null, so_line_id uuid not null, item_id uuid not null,
  qty numeric(14,3) not null check (qty > 0),
  unit_price_paise bigint not null, discount_bp int not null, tax_rate_bp int not null,
  net_paise bigint not null, tax_paise bigint not null,
  foreign key (tenant_id, invoice_id) references public.invoices(tenant_id, id) on delete cascade,
  foreign key (tenant_id, so_line_id) references public.sales_order_lines(tenant_id, id)
);
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  number text not null, customer_id uuid not null,
  amount_paise bigint not null check (amount_paise > 0),
  method text not null check (method in ('cash','bank','upi','card','cheque')),
  reference text, payment_date date not null default current_date,
  created_by uuid, created_at timestamptz not null default now(),
  unique (tenant_id, number), unique (tenant_id, id),
  foreign key (tenant_id, customer_id) references public.customers(tenant_id, id)
);
create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null, payment_id uuid not null, invoice_id uuid not null,
  amount_paise bigint not null check (amount_paise > 0),
  foreign key (tenant_id, payment_id) references public.payments(tenant_id, id) on delete cascade,
  foreign key (tenant_id, invoice_id) references public.invoices(tenant_id, id)
);

-- ---------------------------------------------------------------- audit
create table public.audit_log (
  id bigint generated always as identity primary key,
  tenant_id uuid, actor uuid, action text not null, table_name text not null,
  row_id text, changed_fields text[], at timestamptz not null default now()
);
create index on public.audit_log (tenant_id, at desc);
