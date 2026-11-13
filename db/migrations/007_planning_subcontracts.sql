-- Planning (§8) and subcontracts (§12).
CREATE TABLE schedule_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  wbs text NOT NULL, name text NOT NULL,
  start_date date NOT NULL, end_date date NOT NULL,
  base_start date, base_end date,                         -- frozen baseline; never rewritten by updates
  boq_item_id uuid,                                       -- physical progress is measured from this item's verified quantity
  depends_on uuid[] NOT NULL DEFAULT '{}',
  delay_reason text, version int NOT NULL DEFAULT 1,
  created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, wbs), UNIQUE (id, tenant_id),
  FOREIGN KEY (project_id, tenant_id) REFERENCES projects(id, tenant_id),
  FOREIGN KEY (boq_item_id, tenant_id) REFERENCES boq_items(id, tenant_id),
  CHECK (end_date >= start_date)
);
CREATE TABLE schedule_baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  version int NOT NULL, note text, frozen_by uuid REFERENCES users(id), frozen_at timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL, UNIQUE (project_id, version),
  FOREIGN KEY (project_id, tenant_id) REFERENCES projects(id, tenant_id)
);

CREATE TABLE sub_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  number int NOT NULL, name text NOT NULL, supplier_id uuid NOT NULL,
  retention_bp int NOT NULL DEFAULT 500 CHECK (retention_bp BETWEEN 0 AND 3000),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','awarded','closed')),
  created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, number), UNIQUE (id, tenant_id),
  FOREIGN KEY (project_id, tenant_id) REFERENCES projects(id, tenant_id),
  FOREIGN KEY (supplier_id, tenant_id) REFERENCES suppliers(id, tenant_id)
);
CREATE TABLE sub_wo_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL, package_id uuid NOT NULL,
  boq_item_id uuid NOT NULL, qty_milli bigint NOT NULL CHECK (qty_milli > 0), rate_minor bigint NOT NULL CHECK (rate_minor >= 0),
  UNIQUE (package_id, boq_item_id), UNIQUE (id, tenant_id),
  FOREIGN KEY (package_id, tenant_id) REFERENCES sub_packages(id, tenant_id),
  FOREIGN KEY (boq_item_id, tenant_id) REFERENCES boq_items(id, tenant_id)
);
CREATE TABLE sub_measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL, wo_line_id uuid NOT NULL,
  qty_milli bigint NOT NULL CHECK (qty_milli > 0), measured_on date NOT NULL, location text,
  status text NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared','verified','approved','rejected')),
  reject_reason text,
  prepared_by uuid REFERENCES users(id), verified_by uuid REFERENCES users(id), approved_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (wo_line_id, tenant_id) REFERENCES sub_wo_lines(id, tenant_id),
  CHECK (status <> 'rejected' OR reject_reason IS NOT NULL)
);
CREATE UNIQUE INDEX sub_meas_dup ON sub_measurements (wo_line_id, measured_on, coalesce(location,''), qty_milli) WHERE status <> 'rejected';
CREATE TABLE sub_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL, package_id uuid NOT NULL,
  bill_no int NOT NULL, status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','cancelled')),
  gross_minor bigint NOT NULL, retention_minor bigint NOT NULL, material_recovery_minor bigint NOT NULL DEFAULT 0 CHECK (material_recovery_minor >= 0),
  recovery_reason text, net_minor bigint NOT NULL,
  prepared_by uuid REFERENCES users(id), approved_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (package_id, bill_no), UNIQUE (id, tenant_id),
  FOREIGN KEY (package_id, tenant_id) REFERENCES sub_packages(id, tenant_id),
  CHECK (material_recovery_minor = 0 OR recovery_reason IS NOT NULL)
);
CREATE TABLE sub_bill_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL, bill_id uuid NOT NULL, wo_line_id uuid NOT NULL,
  qty_milli bigint NOT NULL CHECK (qty_milli >= 0), amount_minor bigint NOT NULL,
  FOREIGN KEY (bill_id, tenant_id) REFERENCES sub_bills(id, tenant_id), FOREIGN KEY (wo_line_id, tenant_id) REFERENCES sub_wo_lines(id, tenant_id)
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['sub_packages','sub_wo_lines','sub_measurements','sub_bills','sub_bill_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY; ALTER TABLE %I FORCE ROW LEVEL SECURITY', t, t);
    EXECUTE format($p$CREATE POLICY internal_only ON %I USING (tenant_id = app_tenant() AND NOT is_external() AND project_visible(project_id))
      WITH CHECK (tenant_id = app_tenant() AND NOT is_external() AND project_visible(project_id))$p$, t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['schedule_activities','schedule_baselines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY; ALTER TABLE %I FORCE ROW LEVEL SECURITY', t, t);
    EXECUTE format($p$CREATE POLICY tenant_read ON %I FOR SELECT USING (tenant_id = app_tenant() AND project_visible(project_id))$p$, t);
    EXECUTE format($p$CREATE POLICY tenant_write ON %I FOR ALL USING (tenant_id = app_tenant() AND NOT is_external() AND project_visible(project_id))
      WITH CHECK (tenant_id = app_tenant() AND NOT is_external() AND project_visible(project_id))$p$, t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO erp_app;
GRANT DELETE ON schedule_activities TO erp_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO erp_app;

-- Keep the audit log append-only at the privilege level too (the blanket grant above would otherwise re-add UPDATE).
REVOKE UPDATE, DELETE ON audit_log FROM erp_app;
