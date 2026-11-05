-- Operational tables. Every row carries org_id (tenant) and, where relevant, project_id.
-- Standard columns (version, created_at, updated_at, created_by) are added by std_cols() at the end.

create table parties (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id),
  kind text not null check (kind in ('client','consultant','contractor','supplier','subcontractor')),
  name text not null, gstin text, contact_name text, email text, phone text, address text,
  active boolean not null default true
);
create table projects (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id),
  branch_id uuid references branches(id),
  code text not null, name text not null,
  client_party_id uuid references parties(id),
  owner_user_id uuid references users(id),
  status text not null default 'planning' check (status in ('planning','active','handover','defect_period','closed')),
  start_date date, end_date date, location text, contract_type text default 'item_rate',
  dlp_months int not null default 12, dlp_end date, closed_at timestamptz,
  unique (org_id, code)
);
create table project_members (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id),
  project_id uuid not null, user_id uuid not null references users(id),
  project_role text not null default 'member',
  party_id uuid references parties(id),
  approval_limit_paise bigint not null default 0,
  authorities text[] not null default '{}',   -- e.g. {bill:certify,variation:approve,po:approve}
  effective_from date not null default current_date, effective_to date
);
create unique index project_members_active on project_members(project_id, user_id) where effective_to is null;
create table wbs_nodes (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  parent_id uuid references wbs_nodes(id), kind text not null check (kind in ('site','zone','package')),
  code text not null, name text not null, unique (project_id, code)
);
create table documents (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid,
  entity_type text not null, entity_id uuid, kind text not null default 'document', title text not null,
  file_id uuid references files(id)
);

-- Tender / estimating -------------------------------------------------------
create table opportunities (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id),
  name text not null, client_party_id uuid references parties(id),
  status text not null default 'open' check (status in ('open','bid_submitted','awarded','lost')),
  due_date date, estimated_value_paise bigint not null default 0, notes text, project_id uuid
);
create table estimate_revisions (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id),
  opportunity_id uuid not null references opportunities(id), rev_no int not null,
  status text not null default 'draft' check (status in ('draft','submitted','approved','superseded')),
  overhead_bp int not null default 1000, note text, approved_by uuid, approved_at timestamptz,
  unique (opportunity_id, rev_no)
);
create table estimate_items (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id),
  revision_id uuid not null references estimate_revisions(id) on delete cascade,
  code text not null, description text not null, unit text not null,
  qty numeric(18,3) not null check (qty >= 0), qty_source text,
  rate_paise bigint not null check (rate_paise >= 0), rate_source text,
  mat_paise bigint not null default 0, lab_paise bigint not null default 0, eqp_paise bigint not null default 0,
  unique (revision_id, code)
);
create table boq_items (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  code text not null, description text not null, unit text not null,
  qty numeric(18,3) not null check (qty >= 0),
  rate_paise bigint not null check (rate_paise >= 0),            -- tender / contract rate (billing)
  budget_rate_paise bigint not null default 0 check (budget_rate_paise >= 0),   -- approved internal cost budget
  source text not null default 'tender' check (source in ('tender','import','variation')),
  est_item_id uuid, variation_id uuid, wbs_id uuid,
  unique (project_id, code)
);
create table budget_baselines (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  baseline_no int not null, tender_total_paise bigint not null, budget_total_paise bigint not null,
  contingency_paise bigint not null default 0, snapshot jsonb not null default '[]',
  approved_by uuid, approved_at timestamptz default now(), unique (project_id, baseline_no)
);

-- Contracts -------------------------------------------------------------------
create table contracts (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  number text not null, title text not null,
  status text not null default 'draft' check (status in ('draft','active','closed')),
  value_paise bigint not null default 0,
  advance_bp int not null default 0 check (advance_bp between 0 and 10000),
  advance_recovery_bp int not null default 0 check (advance_recovery_bp between 0 and 10000),
  retention_bp int not null default 0 check (retention_bp between 0 and 10000),
  security_deposit_bp int not null default 0 check (security_deposit_bp between 0 and 10000),
  payment_days int not null default 30, start_date date, end_date date,
  snapshot jsonb, approved_at timestamptz, approved_by uuid,
  unique (project_id, number)
);
create table contract_amendments (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  contract_id uuid not null references contracts(id), no int not null, description text not null,
  delta_paise bigint not null default 0, status text not null default 'draft' check (status in ('draft','approved')),
  unique (contract_id, no)
);
create table contract_milestones (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  contract_id uuid not null references contracts(id), name text not null, due_date date,
  amount_paise bigint not null default 0, status text not null default 'pending' check (status in ('pending','achieved','billed'))
);
create table contract_obligations (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  contract_id uuid not null references contracts(id), description text not null, owner_party text, due_date date,
  status text not null default 'open' check (status in ('open','done'))
);
create table contract_guarantees (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  contract_id uuid not null references contracts(id), kind text not null, issuer text, amount_paise bigint not null default 0,
  expiry date, status text not null default 'active' check (status in ('active','released','expired'))
);
create table contract_ledger (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  contract_id uuid not null references contracts(id),
  kind text not null check (kind in ('advance_paid','advance_recovered','retention_held','retention_released','security_held','security_released')),
  amount_paise bigint not null check (amount_paise >= 0), ref_type text, ref_id uuid, note text
);

-- Planning ----------------------------------------------------------------------
create table activities (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  wbs_id uuid references wbs_nodes(id), code text not null, name text not null,
  start_date date not null, finish_date date not null, base_start date, base_finish date,
  boq_item_id uuid references boq_items(id),
  measure_rule text not null default 'quantity' check (measure_rule in ('quantity','milestone','units')),
  planned_qty numeric(18,3) not null default 0, done_qty numeric(18,3) not null default 0,
  status text not null default 'not_started' check (status in ('not_started','in_progress','complete','blocked')),
  requires_hold_release boolean not null default false,
  delay_reason text, recovery_plan text,
  check (finish_date >= start_date), unique (project_id, code)
);
create table activity_deps (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  pred_id uuid not null references activities(id) on delete cascade, succ_id uuid not null references activities(id) on delete cascade,
  lag_days int not null default 0, check (pred_id <> succ_id), unique (pred_id, succ_id)
);
create table schedule_baselines (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  baseline_no int not null, note text, snapshot jsonb not null, approved_by uuid, approved_at timestamptz default now(),
  unique (project_id, baseline_no)
);
create table resource_plan (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  activity_id uuid references activities(id), resource_type text not null check (resource_type in ('labour','material','equipment')),
  name text not null, qty numeric(18,3) not null default 0, unit text, week_start date
);

-- Drawings & RFIs ------------------------------------------------------------------
create table drawings (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  number text not null, title text not null, discipline text, unique (project_id, number)
);
create table drawing_revisions (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  drawing_id uuid not null references drawings(id), rev text not null,
  status text not null default 'draft' check (status in ('draft','in_review','approved','superseded','rejected')),
  file_id uuid references files(id), note text, reviewed_by uuid, approved_at timestamptz,
  unique (drawing_id, rev)
);
create unique index one_approved_rev on drawing_revisions(drawing_id) where status = 'approved';
create table transmittals (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  number text not null, subject text not null, to_party_id uuid references parties(id),
  status text not null default 'draft' check (status in ('draft','sent')), sent_at timestamptz,
  unique (project_id, number)
);
create table transmittal_items (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  transmittal_id uuid not null references transmittals(id) on delete cascade,
  drawing_revision_id uuid not null references drawing_revisions(id), unique (transmittal_id, drawing_revision_id)
);
create table rfis (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  number text not null, drawing_revision_id uuid references drawing_revisions(id),
  location text not null, question text not null, decision_required text not null,
  owner_user_id uuid references users(id), assigned_party_id uuid references parties(id), due_date date not null,
  status text not null default 'draft' check (status in ('draft','open','responded','closed')),
  response text, responded_by uuid, responded_at timestamptz,
  unique (project_id, number)
);

-- Procurement & stores -----------------------------------------------------------------
create table material_requests (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  number text not null, activity_id uuid references activities(id), site_id uuid references wbs_nodes(id), needed_by date,
  status text not null default 'draft' check (status in ('draft','submitted','approved','rejected','ordered','closed')),
  reject_reason text, approved_by uuid, unique (project_id, number)
);
create table mr_lines (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  mr_id uuid not null references material_requests(id) on delete cascade,
  item_code text not null, description text not null, unit text not null,
  qty numeric(18,3) not null check (qty > 0), boq_item_id uuid references boq_items(id)
);
create table rfqs (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  mr_id uuid not null references material_requests(id), number text not null,
  status text not null default 'open' check (status in ('open','closed')), unique (project_id, number)
);
create table rfq_quotes (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  rfq_id uuid not null references rfqs(id) on delete cascade, supplier_id uuid not null references parties(id),
  rates jsonb not null default '{}', total_paise bigint not null default 0, lead_days int, selected boolean not null default false
);
create table purchase_orders (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  number text not null, supplier_id uuid not null references parties(id), mr_id uuid references material_requests(id),
  status text not null default 'draft' check (status in ('draft','approved','issued','part_received','received','closed','cancelled')),
  total_paise bigint not null default 0, approved_by uuid, delivery_date date, unique (project_id, number)
);
create table po_lines (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  po_id uuid not null references purchase_orders(id) on delete cascade, mr_line_id uuid references mr_lines(id),
  boq_item_id uuid references boq_items(id), item_code text not null, description text not null, unit text not null,
  qty numeric(18,3) not null check (qty > 0), rate_paise bigint not null check (rate_paise >= 0),
  received_qty numeric(18,3) not null default 0, rejected_qty numeric(18,3) not null default 0
);
create table goods_receipts (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  po_id uuid not null references purchase_orders(id), number text not null, site_id uuid not null references wbs_nodes(id),
  received_on date not null default current_date, notes text, unique (project_id, number)
);
create table grn_lines (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  grn_id uuid not null references goods_receipts(id) on delete cascade, po_line_id uuid not null references po_lines(id),
  received_qty numeric(18,3) not null check (received_qty >= 0), accepted_qty numeric(18,3) not null check (accepted_qty >= 0),
  rejected_qty numeric(18,3) not null check (rejected_qty >= 0), reject_reason text,
  expectation text not null default 'none' check (expectation in ('none','replacement','credit')),
  check (accepted_qty + rejected_qty = received_qty)
);
create table stock_movements (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  site_id uuid not null references wbs_nodes(id), item_code text not null, description text, unit text not null,
  qty numeric(18,3) not null check (qty <> 0),
  bucket text not null default 'store' check (bucket in ('store','quarantine')),
  kind text not null check (kind in ('receipt','issue','transfer_out','transfer_in','return','count_adjust','reject_receipt','supplier_return')),
  ref_type text, ref_id uuid, activity_id uuid references activities(id), boq_item_id uuid references boq_items(id),
  note text
);
create index stock_lookup on stock_movements(project_id, site_id, item_code, bucket);
create table site_transfers (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  number text not null, from_site_id uuid not null references wbs_nodes(id), to_site_id uuid not null references wbs_nodes(id),
  status text not null default 'in_transit' check (status in ('in_transit','received')), received_at timestamptz,
  check (from_site_id <> to_site_id), unique (project_id, number)
);
create table transfer_lines (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  transfer_id uuid not null references site_transfers(id) on delete cascade,
  item_code text not null, description text, unit text not null, qty numeric(18,3) not null check (qty > 0)
);
create table stock_counts (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  site_id uuid not null references wbs_nodes(id), counted_on date not null default current_date,
  status text not null default 'draft' check (status in ('draft','applied'))
);
create table stock_count_lines (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  count_id uuid not null references stock_counts(id) on delete cascade,
  item_code text not null, unit text not null, system_qty numeric(18,3) not null, counted_qty numeric(18,3) not null check (counted_qty >= 0)
);

-- Site reporting -------------------------------------------------------------------------
create table daily_reports (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  site_id uuid not null references wbs_nodes(id), report_date date not null, weather text, notes text,
  status text not null default 'draft' check (status in ('draft','submitted','verified','correction_requested')),
  supervisor_note text, submitted_by uuid, verified_by uuid, unique (project_id, site_id, report_date)
);
create table report_labour (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  report_id uuid not null references daily_reports(id) on delete cascade, trade text not null,
  headcount int not null check (headcount >= 0), hours numeric(6,2) not null check (hours between 0 and 24), subcontractor_id uuid references parties(id)
);
create table report_equipment (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  report_id uuid not null references daily_reports(id) on delete cascade, name text not null,
  hours numeric(6,2) not null check (hours between 0 and 24), idle_hours numeric(6,2) not null default 0 check (idle_hours between 0 and 24)
);
create table report_quantities (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  report_id uuid not null references daily_reports(id) on delete cascade,
  activity_id uuid not null references activities(id), claimed_qty numeric(18,3) not null check (claimed_qty >= 0),
  verified_qty numeric(18,3) check (verified_qty >= 0), correction_reason text, applied boolean not null default false
);
create table report_issues (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  report_id uuid not null references daily_reports(id) on delete cascade, text text not null,
  severity text not null default 'low' check (severity in ('low','medium','high'))
);
create table report_photos (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  report_id uuid not null references daily_reports(id) on delete cascade, file_id uuid not null references files(id),
  caption text, activity_id uuid references activities(id)
);

-- Subcontracting ---------------------------------------------------------------------------
create table subcontract_packages (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  name text not null, scope text, status text not null default 'open' check (status in ('open','awarded','closed'))
);
create table sub_bids (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  package_id uuid not null references subcontract_packages(id), subcontractor_id uuid not null references parties(id),
  amount_paise bigint not null check (amount_paise >= 0), selected boolean not null default false, note text
);
create table work_orders (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  package_id uuid references subcontract_packages(id), subcontractor_id uuid not null references parties(id),
  number text not null, status text not null default 'draft' check (status in ('draft','approved','mobilised','closed')),
  retention_bp int not null default 0 check (retention_bp between 0 and 10000),
  advance_paise bigint not null default 0, advance_recovery_bp int not null default 0 check (advance_recovery_bp between 0 and 10000),
  mobilised_on date, unique (project_id, number)
);
create table wo_items (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  work_order_id uuid not null references work_orders(id) on delete cascade,
  boq_item_id uuid not null references boq_items(id), description text not null, unit text not null,
  rate_paise bigint not null check (rate_paise >= 0), qty_limit numeric(18,3) not null check (qty_limit >= 0),
  tolerance_bp int not null default 0 check (tolerance_bp between 0 and 2000)
);
create table measurement_sheets (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  work_order_id uuid not null references work_orders(id), number text not null, period_to date not null,
  status text not null default 'draft' check (status in ('draft','prepared','verified','approved','rejected')),
  prepared_by uuid, verified_by uuid, approved_by uuid, reject_reason text, unique (project_id, number)
);
create table measurement_lines (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  sheet_id uuid not null references measurement_sheets(id) on delete cascade, wo_item_id uuid not null references wo_items(id),
  location text not null, measured_on date not null, qty numeric(18,3) not null check (qty > 0),
  unique (wo_item_id, location, measured_on)       -- the same measured work cannot be entered twice
);
create table sub_bills (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  work_order_id uuid not null references work_orders(id), sheet_id uuid not null unique references measurement_sheets(id),
  number text not null, gross_paise bigint not null, retention_paise bigint not null default 0,
  advance_recovery_paise bigint not null default 0, material_recovery_paise bigint not null default 0,
  other_deductions_paise bigint not null default 0, deduction_reason text, net_paise bigint not null,
  status text not null default 'draft' check (status in ('draft','approved','paid')), approved_by uuid,
  unique (project_id, number)
);

-- Quality & safety ----------------------------------------------------------------------------
create table inspections (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  number text not null, title text not null, location_id uuid references wbs_nodes(id),
  activity_id uuid references activities(id), drawing_revision_id uuid references drawing_revisions(id),
  hold_point boolean not null default false, checklist jsonb not null default '[]',
  status text not null default 'requested' check (status in ('requested','passed','failed','waived')),
  outcome_note text, decided_by uuid, external_visible boolean not null default false, unique (project_id, number)
);
create table ncrs (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  number text not null, inspection_id uuid references inspections(id), description text not null,
  severity text not null default 'minor' check (severity in ('minor','major','critical')),
  owner_user_id uuid references users(id), due_date date,
  status text not null default 'open' check (status in ('open','action_assigned','action_done','verified','closed')),
  unique (project_id, number)
);
create table corrective_actions (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  ncr_id uuid not null references ncrs(id) on delete cascade, action text not null, owner_user_id uuid references users(id),
  due_date date, evidence_file_id uuid references files(id),
  status text not null default 'open' check (status in ('open','done','verified')), verified_by uuid
);
create table safety_observations (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  location text, description text not null, owner_user_id uuid references users(id),
  status text not null default 'open' check (status in ('open','closed'))
);
create table safety_incidents (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  incident_date date not null, severity text not null check (severity in ('near_miss','first_aid','lost_time','serious')),
  description text not null, injured_count int not null default 0,
  status text not null default 'open' check (status in ('open','investigating','closed'))
);

-- Client billing ------------------------------------------------------------------------------
create table measurement_book (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  boq_item_id uuid not null references boq_items(id), location text not null, measured_on date not null,
  qty numeric(18,3) not null check (qty > 0), status text not null default 'draft' check (status in ('draft','verified','billed')),
  verified_by uuid, note text, unique (boq_item_id, location, measured_on)
);
create table ra_bills (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  contract_id uuid not null references contracts(id), bill_no int not null, period_to date not null,
  status text not null default 'draft' check (status in ('draft','submitted','certified','invoiced','rejected')),
  submitted_paise bigint not null default 0,             -- gross value of this-bill quantities, as claimed
  certified_gross_paise bigint not null default 0,       -- gross value as certified (cumulative)
  prev_certified_gross_paise bigint not null default 0,  -- cumulative gross certified in earlier bills
  advance_recovery_paise bigint not null default 0,      -- cumulative recovery
  retention_paise bigint not null default 0,             -- cumulative retention
  net_certified_paise bigint not null default 0,         -- payable for THIS bill after recoveries & previous bills
  certified_by uuid, certified_at timestamptz, reject_reason text,
  unique (contract_id, bill_no)
);
create table ra_bill_lines (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  bill_id uuid not null references ra_bills(id) on delete cascade, boq_item_id uuid not null references boq_items(id),
  rate_paise bigint not null, prev_cum_qty numeric(18,3) not null default 0, this_qty numeric(18,3) not null check (this_qty >= 0),
  certified_this_qty numeric(18,3), amount_submitted_paise bigint not null default 0, amount_certified_paise bigint not null default 0,
  unique (bill_id, boq_item_id)
);
create table invoices (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  bill_id uuid not null unique references ra_bills(id), number text not null, amount_paise bigint not null check (amount_paise >= 0),
  due_date date, status text not null default 'issued' check (status in ('issued','part_paid','paid','disputed','settled')),
  collected_paise bigint not null default 0, written_off_paise bigint not null default 0, unique (org_id, number)
);
create table receipts (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  invoice_id uuid not null references invoices(id), amount_paise bigint not null check (amount_paise > 0),
  received_on date not null default current_date, method text not null default 'bank', reference text not null,
  unique (invoice_id, reference)
);
create table disputes (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  invoice_id uuid not null references invoices(id), amount_paise bigint not null check (amount_paise > 0), reason text not null,
  status text not null default 'open' check (status in ('open','resolved','written_off')), resolution text
);
create table variations (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  number text not null, title text not null, scope text not null, reason text,
  cost_delta_paise bigint not null default 0, time_delta_days int not null default 0,
  status text not null default 'draft' check (status in ('draft','submitted','approved','rejected')),
  decided_by uuid, decided_at timestamptz, decision_reason text, applied boolean not null default false,
  unique (project_id, number)
);
create table variation_items (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  variation_id uuid not null references variations(id) on delete cascade, code text not null, description text not null, unit text not null,
  qty numeric(18,3) not null, rate_paise bigint not null, base_boq_item_id uuid references boq_items(id)
);
create table cash_forecast_items (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  month date not null, kind text not null check (kind in ('inflow','outflow')), amount_paise bigint not null check (amount_paise >= 0),
  basis text not null default 'assumption' check (basis in ('assumption','actual')), note text
);

-- Handover & closure ----------------------------------------------------------------------------
create table snags (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  number text not null, location_id uuid references wbs_nodes(id), description text not null,
  assigned_party_id uuid references parties(id), assigned_user_id uuid references users(id),
  status text not null default 'open' check (status in ('open','rectified','verified','closed')),
  rectification_note text, verified_by uuid, unique (project_id, number)
);
create table completion_checklist (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  item text not null, done boolean not null default false, evidence text, done_by uuid
);
create table warranties (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null,
  item text not null, supplier text, expiry date not null, document_file_id uuid references files(id)
);
create table final_accounts (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id), project_id uuid not null unique,
  status text not null default 'draft' check (status in ('draft','reviewed','agreed')), summary jsonb not null default '{}',
  agreed_by uuid, agreed_at timestamptz
);

-- Standard columns -------------------------------------------------------------------------------
create function bump_row() returns trigger language plpgsql as $$
begin new.version := old.version + 1; new.updated_at := now(); return new; end $$;

create function std_cols(t text) returns void language plpgsql as $$
begin
  execute format('alter table %I add column version int not null default 1, add column created_at timestamptz not null default now(), add column updated_at timestamptz not null default now(), add column created_by uuid', t);
  execute format('create trigger %I before update on %I for each row execute function bump_row()', t || '_bump', t);
end $$;

do $$ declare t text; begin
  foreach t in array array[
    'parties','projects','project_members','wbs_nodes','documents','opportunities','estimate_revisions','estimate_items','boq_items','budget_baselines',
    'contracts','contract_amendments','contract_milestones','contract_obligations','contract_guarantees','contract_ledger',
    'activities','activity_deps','schedule_baselines','resource_plan','drawings','drawing_revisions','transmittals','transmittal_items','rfis',
    'material_requests','mr_lines','rfqs','rfq_quotes','purchase_orders','po_lines','goods_receipts','grn_lines','stock_movements','site_transfers','transfer_lines','stock_counts','stock_count_lines',
    'daily_reports','report_labour','report_equipment','report_quantities','report_issues','report_photos',
    'subcontract_packages','sub_bids','work_orders','wo_items','measurement_sheets','measurement_lines','sub_bills',
    'inspections','ncrs','corrective_actions','safety_observations','safety_incidents',
    'measurement_book','ra_bills','ra_bill_lines','invoices','receipts','disputes','variations','variation_items','cash_forecast_items',
    'snags','completion_checklist','warranties','final_accounts'
  ] loop perform std_cols(t); end loop;
end $$;

alter table project_members add constraint pm_project_fk foreign key (project_id) references projects(id) on delete cascade;
alter table wbs_nodes add constraint wbs_project_fk foreign key (project_id) references projects(id) on delete cascade;

-- project_id foreign keys for every project-scoped table
do $$ declare r record; begin
  for r in select c.table_name from information_schema.columns c
    where c.table_schema='public' and c.column_name='project_id' and c.table_name not in ('project_members','wbs_nodes','documents','files','invitations','opportunities')
  loop
    execute format('alter table %I add constraint %I foreign key (project_id) references projects(id) on delete cascade', r.table_name, r.table_name||'_project_fk');
  end loop;
end $$;
