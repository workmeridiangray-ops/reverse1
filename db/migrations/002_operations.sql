-- Operational tables. Money = bigint paise, quantities = bigint milli-units, percentages = basis points.
-- Every child row references its parent by (id, tenant_id) so a row can never point at another tenant's record.

CREATE FUNCTION app_all_projects() RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT coalesce(current_setting('app.all_projects', true), 'on') = 'on' $$;
CREATE FUNCTION is_external() RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT coalesce(app_role() IN ('client','consultant'), false) $$;

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL,
  name text NOT NULL,
  client_name text NOT NULL,
  location text,
  status text NOT NULL DEFAULT 'tender' CHECK (status IN ('tender','active','handover','closed')),
  start_date date, end_date date,
  closed_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code), UNIQUE (id, tenant_id)
);

CREATE TABLE project_access (
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, user_id),
  FOREIGN KEY (project_id, tenant_id) REFERENCES projects(id, tenant_id)
);

CREATE FUNCTION project_visible(pid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT app_all_projects() OR EXISTS (SELECT 1 FROM project_access pa
    WHERE pa.project_id = pid AND pa.user_id = app_user() AND pa.tenant_id = app_tenant()) $$;

CREATE TABLE boq_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  code text NOT NULL, description text NOT NULL, unit text NOT NULL,
  qty_milli bigint NOT NULL CHECK (qty_milli >= 0),
  rate_minor bigint NOT NULL CHECK (rate_minor >= 0),
  source text NOT NULL DEFAULT 'manual',   -- where quantity/rate came from (csv import, manual, variation)
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, code), UNIQUE (id, tenant_id),
  FOREIGN KEY (project_id, tenant_id) REFERENCES projects(id, tenant_id)
);

-- Internal cost budget (never visible to external parties).
CREATE TABLE budget_lines (
  boq_item_id uuid PRIMARY KEY, tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  cost_rate_minor bigint NOT NULL CHECK (cost_rate_minor >= 0),
  contingency_bp int NOT NULL DEFAULT 0 CHECK (contingency_bp BETWEEN 0 AND 10000),
  FOREIGN KEY (boq_item_id, tenant_id) REFERENCES boq_items(id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, project_id uuid NOT NULL UNIQUE,
  contract_no text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved')),
  retention_bp int NOT NULL DEFAULT 500 CHECK (retention_bp BETWEEN 0 AND 3000),
  retention_cap_bp int NOT NULL DEFAULT 500 CHECK (retention_cap_bp BETWEEN 0 AND 3000),
  advance_minor bigint NOT NULL DEFAULT 0 CHECK (advance_minor >= 0),
  advance_recovery_bp int NOT NULL DEFAULT 1000 CHECK (advance_recovery_bp BETWEEN 0 AND 10000),
  payment_days int NOT NULL DEFAULT 30 CHECK (payment_days BETWEEN 0 AND 365),
  approved_by uuid REFERENCES users(id), approved_at timestamptz,
  snapshot jsonb,                                  -- terms + contract value frozen at approval
  UNIQUE (id, tenant_id),
  FOREIGN KEY (project_id, tenant_id) REFERENCES projects(id, tenant_id)
);

CREATE TABLE variations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  number int NOT NULL, title text NOT NULL, description text,
  boq_item_id uuid,
  qty_delta_milli bigint NOT NULL DEFAULT 0,
  cost_minor bigint NOT NULL DEFAULT 0,
  time_days int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected')),
  decision_reason text,
  requested_by uuid REFERENCES users(id), decided_by uuid REFERENCES users(id), decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, number), UNIQUE (id, tenant_id),
  FOREIGN KEY (project_id, tenant_id) REFERENCES projects(id, tenant_id),
  FOREIGN KEY (boq_item_id, tenant_id) REFERENCES boq_items(id, tenant_id),
  CHECK (status <> 'rejected' OR decision_reason IS NOT NULL)
);

CREATE TABLE inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  number int NOT NULL, title text NOT NULL, location text,
  boq_item_id uuid, drawing_ref text,
  hold_point boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','passed','failed')),
  result_note text, decided_by uuid REFERENCES users(id), decided_at timestamptz,
  created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, number), UNIQUE (id, tenant_id),
  FOREIGN KEY (project_id, tenant_id) REFERENCES projects(id, tenant_id),
  FOREIGN KEY (boq_item_id, tenant_id) REFERENCES boq_items(id, tenant_id)
);

CREATE TABLE daily_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  report_date date NOT NULL, weather text, labour_count int NOT NULL DEFAULT 0 CHECK (labour_count >= 0),
  equipment_hours numeric(8,2) NOT NULL DEFAULT 0 CHECK (equipment_hours >= 0),
  summary text, issues text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','verified','returned')),
  correction_reason text,
  created_by uuid REFERENCES users(id), verified_by uuid REFERENCES users(id),
  version int NOT NULL DEFAULT 1,
  UNIQUE (project_id, report_date), UNIQUE (id, tenant_id),
  FOREIGN KEY (project_id, tenant_id) REFERENCES projects(id, tenant_id)
);

CREATE TABLE bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  bill_no int NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','certified','invoiced','cancelled')),
  version int NOT NULL DEFAULT 1,
  claimed_gross_minor bigint NOT NULL DEFAULT 0,
  certified_gross_minor bigint NOT NULL DEFAULT 0,
  retention_minor bigint NOT NULL DEFAULT 0,
  advance_recovery_minor bigint NOT NULL DEFAULT 0,
  other_deduction_minor bigint NOT NULL DEFAULT 0 CHECK (other_deduction_minor >= 0),
  other_deduction_reason text,
  net_minor bigint NOT NULL DEFAULT 0,
  terms jsonb NOT NULL,                              -- contract terms snapshot used for this bill
  prepared_by uuid REFERENCES users(id), certified_by uuid REFERENCES users(id),
  certified_at timestamptz, certify_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, bill_no), UNIQUE (id, tenant_id),
  FOREIGN KEY (project_id, tenant_id) REFERENCES projects(id, tenant_id),
  CHECK (other_deduction_minor = 0 OR other_deduction_reason IS NOT NULL)
);

CREATE TABLE bill_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, bill_id uuid NOT NULL, boq_item_id uuid NOT NULL,
  rate_minor bigint NOT NULL,
  contract_qty_milli bigint NOT NULL,
  prev_qty_milli bigint NOT NULL,
  claimed_qty_milli bigint NOT NULL CHECK (claimed_qty_milli >= 0),
  certified_qty_milli bigint NOT NULL CHECK (certified_qty_milli >= 0),
  claimed_amount_minor bigint NOT NULL,
  certified_amount_minor bigint NOT NULL,
  UNIQUE (bill_id, boq_item_id),
  FOREIGN KEY (bill_id, tenant_id) REFERENCES bills(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (boq_item_id, tenant_id) REFERENCES boq_items(id, tenant_id),
  CHECK (certified_qty_milli <= claimed_qty_milli)
);

CREATE TABLE measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, boq_item_id uuid NOT NULL,
  qty_milli bigint NOT NULL CHECK (qty_milli > 0),
  location text, measured_on date NOT NULL, note text,
  status text NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded','verified','rejected')),
  reject_reason text,
  recorded_by uuid REFERENCES users(id), verified_by uuid REFERENCES users(id), verified_at timestamptz,
  bill_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (project_id, tenant_id) REFERENCES projects(id, tenant_id),
  FOREIGN KEY (boq_item_id, tenant_id) REFERENCES boq_items(id, tenant_id),
  FOREIGN KEY (bill_id, tenant_id) REFERENCES bills(id, tenant_id),
  CHECK (status <> 'rejected' OR reject_reason IS NOT NULL)
);
-- A measurement can be consumed by at most one bill; no duplicate (item, location, date, qty) entries.
CREATE UNIQUE INDEX measurement_dup_key ON measurements (boq_item_id, coalesce(location,''), measured_on, qty_milli) WHERE status <> 'rejected';

CREATE TABLE client_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, bill_id uuid NOT NULL UNIQUE,
  number text NOT NULL, amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  issued_on date NOT NULL, due_on date NOT NULL,
  created_by uuid REFERENCES users(id),
  UNIQUE (tenant_id, number), UNIQUE (id, tenant_id),
  FOREIGN KEY (bill_id, tenant_id) REFERENCES bills(id, tenant_id),
  FOREIGN KEY (project_id, tenant_id) REFERENCES projects(id, tenant_id)
);

CREATE TABLE receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, invoice_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  received_on date NOT NULL, method text NOT NULL DEFAULT 'bank', reference text,
  recorded_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (invoice_id, tenant_id) REFERENCES client_invoices(id, tenant_id)
);

CREATE TABLE disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, invoice_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0), reason text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolution text, raised_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (invoice_id, tenant_id) REFERENCES client_invoices(id, tenant_id)
);

CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL, contact text, gstin text,
  UNIQUE (id, tenant_id), UNIQUE (tenant_id, name)
);

CREATE TABLE material_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  number int NOT NULL, needed_by date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected')),
  decision_reason text,
  requested_by uuid REFERENCES users(id), decided_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, number), UNIQUE (id, tenant_id),
  FOREIGN KEY (project_id, tenant_id) REFERENCES projects(id, tenant_id),
  CHECK (status <> 'rejected' OR decision_reason IS NOT NULL)
);
CREATE TABLE material_request_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, request_id uuid NOT NULL,
  boq_item_id uuid, description text NOT NULL, unit text NOT NULL,
  qty_milli bigint NOT NULL CHECK (qty_milli > 0),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (request_id, tenant_id) REFERENCES material_requests(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (boq_item_id, tenant_id) REFERENCES boq_items(id, tenant_id)
);

CREATE TABLE purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  number int NOT NULL, supplier_id uuid NOT NULL, request_id uuid,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','part_received','received','cancelled')),
  created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, number), UNIQUE (id, tenant_id),
  FOREIGN KEY (project_id, tenant_id) REFERENCES projects(id, tenant_id),
  FOREIGN KEY (supplier_id, tenant_id) REFERENCES suppliers(id, tenant_id),
  FOREIGN KEY (request_id, tenant_id) REFERENCES material_requests(id, tenant_id)
);
CREATE TABLE po_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, po_id uuid NOT NULL,
  request_line_id uuid, boq_item_id uuid, description text NOT NULL, unit text NOT NULL,
  qty_milli bigint NOT NULL CHECK (qty_milli > 0),
  rate_minor bigint NOT NULL CHECK (rate_minor >= 0),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (po_id, tenant_id) REFERENCES purchase_orders(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (request_line_id, tenant_id) REFERENCES material_request_lines(id, tenant_id),
  FOREIGN KEY (boq_item_id, tenant_id) REFERENCES boq_items(id, tenant_id)
);
CREATE TABLE goods_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, po_id uuid NOT NULL,
  received_on date NOT NULL, note text, received_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (po_id, tenant_id) REFERENCES purchase_orders(id, tenant_id)
);
CREATE TABLE grn_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, grn_id uuid NOT NULL, po_line_id uuid NOT NULL,
  accepted_qty_milli bigint NOT NULL CHECK (accepted_qty_milli >= 0),
  rejected_qty_milli bigint NOT NULL DEFAULT 0 CHECK (rejected_qty_milli >= 0),
  reject_reason text,
  FOREIGN KEY (grn_id, tenant_id) REFERENCES goods_receipts(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (po_line_id, tenant_id) REFERENCES po_lines(id, tenant_id),
  CHECK (accepted_qty_milli + rejected_qty_milli > 0),
  CHECK (rejected_qty_milli = 0 OR reject_reason IS NOT NULL)
);

CREATE TABLE files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id), project_id uuid,
  entity text NOT NULL, entity_id uuid,
  name text NOT NULL, mime text NOT NULL, size_bytes bigint NOT NULL, sha256 text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  uploaded_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id)
);

CREATE TABLE drawings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  number text NOT NULL, title text NOT NULL, discipline text NOT NULL DEFAULT 'general',
  UNIQUE (project_id, number), UNIQUE (id, tenant_id),
  FOREIGN KEY (project_id, tenant_id) REFERENCES projects(id, tenant_id)
);
CREATE TABLE drawing_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, drawing_id uuid NOT NULL,
  rev text NOT NULL, note text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','superseded')),
  file_id uuid NOT NULL,
  uploaded_by uuid REFERENCES users(id), approved_by uuid REFERENCES users(id), approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (drawing_id, rev), UNIQUE (id, tenant_id),
  FOREIGN KEY (drawing_id, tenant_id) REFERENCES drawings(id, tenant_id),
  FOREIGN KEY (file_id, tenant_id) REFERENCES files(id, tenant_id)
);
CREATE UNIQUE INDEX one_approved_revision ON drawing_revisions(drawing_id) WHERE status = 'approved';
CREATE TABLE drawing_distribution (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, revision_id uuid NOT NULL, user_id uuid,
  was_current boolean NOT NULL, at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (revision_id, tenant_id) REFERENCES drawing_revisions(id, tenant_id)
);

CREATE TABLE rfis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, number int NOT NULL,
  drawing_id uuid, location text, question text NOT NULL, decision_needed text NOT NULL,
  owner_id uuid REFERENCES users(id), due_date date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','closed')),
  response text, responded_by uuid REFERENCES users(id), responded_at timestamptz,
  raised_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, number), UNIQUE (id, tenant_id),
  FOREIGN KEY (project_id, tenant_id) REFERENCES projects(id, tenant_id),
  FOREIGN KEY (drawing_id, tenant_id) REFERENCES drawings(id, tenant_id)
);

CREATE TABLE snags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, number int NOT NULL,
  location text NOT NULL, description text NOT NULL, assigned_to text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','rectified','verified')),
  rectification_note text, verified_by uuid REFERENCES users(id), verified_at timestamptz,
  raised_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, number), UNIQUE (id, tenant_id),
  FOREIGN KEY (project_id, tenant_id) REFERENCES projects(id, tenant_id)
);

-- Row-level security -----------------------------------------------------------------
-- internal: tenant + project visibility, hidden from external roles.
-- shared:   tenant + project visibility, with an extra predicate for external roles.
DO $$
DECLARE t text;
  internal text[] := ARRAY['budget_lines','material_requests','material_request_lines','purchase_orders','po_lines',
    'goods_receipts','grn_lines'];
  shared text[] := ARRAY['projects','boq_items','contracts','client_invoices','receipts','disputes',
    'inspections','drawings','rfis','snags','project_access','files','drawing_distribution'];
BEGIN
  FOREACH t IN ARRAY internal LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY; ALTER TABLE %I FORCE ROW LEVEL SECURITY', t, t);
    EXECUTE format($p$CREATE POLICY tenant_internal ON %I USING (tenant_id = app_tenant() AND NOT is_external() AND project_visible(project_id))
      WITH CHECK (tenant_id = app_tenant() AND NOT is_external() AND project_visible(project_id))$p$, t);
  END LOOP;
  FOREACH t IN ARRAY shared LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY; ALTER TABLE %I FORCE ROW LEVEL SECURITY', t, t);
  END LOOP;
END $$;

CREATE POLICY p_projects ON projects USING (tenant_id = app_tenant() AND project_visible(id)) WITH CHECK (tenant_id = app_tenant());
CREATE POLICY p_access ON project_access USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
CREATE POLICY p_boq ON boq_items USING (tenant_id = app_tenant() AND project_visible(project_id)) WITH CHECK (tenant_id = app_tenant() AND NOT is_external());
CREATE POLICY p_contracts ON contracts USING (tenant_id = app_tenant() AND project_visible(project_id) AND (NOT is_external() OR status = 'approved')) WITH CHECK (tenant_id = app_tenant() AND NOT is_external());
CREATE POLICY p_invoices ON client_invoices USING (tenant_id = app_tenant() AND project_visible(project_id)) WITH CHECK (tenant_id = app_tenant() AND NOT is_external());
CREATE POLICY p_receipts ON receipts USING (tenant_id = app_tenant() AND project_visible(project_id)) WITH CHECK (tenant_id = app_tenant() AND NOT is_external());
CREATE POLICY p_disputes ON disputes USING (tenant_id = app_tenant() AND project_visible(project_id)) WITH CHECK (tenant_id = app_tenant() AND project_visible(project_id));
CREATE POLICY p_inspections ON inspections USING (tenant_id = app_tenant() AND project_visible(project_id)) WITH CHECK (tenant_id = app_tenant() AND NOT is_external());
CREATE POLICY p_drawings ON drawings USING (tenant_id = app_tenant() AND project_visible(project_id)) WITH CHECK (tenant_id = app_tenant() AND NOT is_external());
CREATE POLICY p_rfis ON rfis USING (tenant_id = app_tenant() AND project_visible(project_id)) WITH CHECK (tenant_id = app_tenant() AND project_visible(project_id));
CREATE POLICY p_snags ON snags USING (tenant_id = app_tenant() AND project_visible(project_id)) WITH CHECK (tenant_id = app_tenant() AND NOT is_external());
CREATE POLICY p_files ON files USING (tenant_id = app_tenant() AND (project_id IS NULL OR project_visible(project_id))) WITH CHECK (tenant_id = app_tenant() AND NOT is_external());
CREATE POLICY p_dist ON drawing_distribution USING (tenant_id = app_tenant() AND project_visible(project_id)) WITH CHECK (tenant_id = app_tenant() AND project_visible(project_id));

ALTER TABLE drawing_revisions ENABLE ROW LEVEL SECURITY; ALTER TABLE drawing_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY p_revs ON drawing_revisions USING (tenant_id = app_tenant() AND project_visible(project_id) AND (NOT is_external() OR status = 'approved'))
  WITH CHECK (tenant_id = app_tenant() AND NOT is_external());

ALTER TABLE bills ENABLE ROW LEVEL SECURITY; ALTER TABLE bills FORCE ROW LEVEL SECURITY;
CREATE POLICY p_bills ON bills USING (tenant_id = app_tenant() AND project_visible(project_id) AND (NOT is_external() OR status IN ('submitted','certified','invoiced')))
  WITH CHECK (tenant_id = app_tenant() AND project_visible(project_id));
ALTER TABLE bill_lines ENABLE ROW LEVEL SECURITY; ALTER TABLE bill_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY p_bill_lines ON bill_lines USING (tenant_id = app_tenant() AND project_visible(project_id) AND (NOT is_external() OR EXISTS (SELECT 1 FROM bills b WHERE b.id = bill_id)))
  WITH CHECK (tenant_id = app_tenant() AND project_visible(project_id));

ALTER TABLE measurements ENABLE ROW LEVEL SECURITY; ALTER TABLE measurements FORCE ROW LEVEL SECURITY;
CREATE POLICY p_meas ON measurements USING (tenant_id = app_tenant() AND project_visible(project_id) AND (NOT is_external() OR status = 'verified'))
  WITH CHECK (tenant_id = app_tenant() AND NOT is_external());
ALTER TABLE daily_reports ENABLE ROW LEVEL SECURITY; ALTER TABLE daily_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY p_dr ON daily_reports USING (tenant_id = app_tenant() AND project_visible(project_id) AND (NOT is_external() OR status = 'verified'))
  WITH CHECK (tenant_id = app_tenant() AND NOT is_external());
ALTER TABLE variations ENABLE ROW LEVEL SECURITY; ALTER TABLE variations FORCE ROW LEVEL SECURITY;
CREATE POLICY p_var ON variations USING (tenant_id = app_tenant() AND project_visible(project_id) AND (NOT is_external() OR status <> 'draft'))
  WITH CHECK (tenant_id = app_tenant() AND project_visible(project_id));
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY; ALTER TABLE suppliers FORCE ROW LEVEL SECURITY;
CREATE POLICY p_sup ON suppliers USING (tenant_id = app_tenant() AND NOT is_external()) WITH CHECK (tenant_id = app_tenant() AND NOT is_external());

-- Grants. erp_app has no DELETE on financial/audit tables.
GRANT USAGE ON SCHEMA public TO erp_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO erp_app;
GRANT DELETE ON project_access, boq_items, budget_lines, material_request_lines, po_lines, bill_lines, sessions, auth_tokens, invitations, request_log, login_attempts, measurements, memberships TO erp_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO erp_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO erp_app;
REVOKE UPDATE, DELETE ON audit_log FROM erp_app;
