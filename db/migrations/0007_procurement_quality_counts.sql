create table purchase_requests (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  number text not null, item_id uuid not null, qty numeric(18,4) not null check (qty > 0), needed_by date not null, reason text,
  status text not null default 'open' check (status in ('open','rfq','approved','rejected','converted')),
  requested_by uuid, decided_by uuid, decision_reason text, po_id uuid, created_at timestamptz not null default now(),
  unique (company_id, number), unique (id, company_id), foreign key (item_id, company_id) references items(id, company_id));
create table rfqs (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  number text not null, pr_id uuid not null, status text not null default 'open' check (status in ('open','awarded','cancelled')),
  awarded_quote_id uuid, created_by uuid, created_at timestamptz not null default now(),
  unique (company_id, number), unique (id, company_id), foreign key (pr_id, company_id) references purchase_requests(id, company_id));
create table rfq_quotes (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  rfq_id uuid not null, supplier_id uuid not null, unit_price_paise bigint not null check (unit_price_paise >= 0), lead_days int not null check (lead_days >= 0), note text,
  unique (rfq_id, supplier_id), unique (id, company_id),
  foreign key (rfq_id, company_id) references rfqs(id, company_id) on delete cascade, foreign key (supplier_id, company_id) references suppliers(id, company_id));
create table inspection_plans (id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  item_id uuid not null, kind text not null check (kind in ('incoming','in_process','final')), characteristic text not null, unit text,
  min_value numeric(18,4), max_value numeric(18,4), unique (item_id, kind, characteristic), foreign key (item_id, company_id) references items(id, company_id),
  check (min_value is null or max_value is null or min_value <= max_value));
alter table stock_counts alter column counted_qty drop not null;
alter table stock_counts add column sheet text, add column batch_code text, add column item_code text;
alter table companies add column closure_requested_at timestamptz;
do $$ declare t text; begin
  foreach t in array array['purchase_requests','rfqs','rfq_quotes','inspection_plans'] loop
    execute format('alter table %I enable row level security', t); execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I using (company_id = nullif(current_setting('app.company_id', true), '')::uuid) with check (company_id = nullif(current_setting('app.company_id', true), '')::uuid)$p$, t);
  end loop; end $$;
grant select, insert, update, delete on purchase_requests, rfqs, rfq_quotes, inspection_plans to mfg_app;
