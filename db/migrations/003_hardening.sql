ALTER TABLE users ADD COLUMN notify_email boolean NOT NULL DEFAULT true;

-- Memberships/tenants can only be created inside a scope that names that tenant (signup, invitation accept).
DROP POLICY mem_ins ON memberships;
CREATE POLICY mem_ins ON memberships FOR INSERT WITH CHECK (tenant_id = app_tenant());
DROP POLICY tenants_ins ON tenants;
CREATE POLICY tenants_ins ON tenants FOR INSERT WITH CHECK (id = app_tenant());
DROP POLICY pc_ins ON plan_changes;
CREATE POLICY pc_ins ON plan_changes FOR INSERT WITH CHECK (tenant_id = app_tenant() OR app_platform());
DROP POLICY audit_ins ON audit_log;
CREATE POLICY audit_ins ON audit_log FOR INSERT WITH CHECK (tenant_id IS NULL OR tenant_id = app_tenant() OR app_platform());

-- Platform staff read tenant metadata only; they have no policy on any project table.
-- Short-lived, audited support access to a tenant's data requires an explicit grant row.
CREATE TABLE support_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  platform_user_id uuid NOT NULL REFERENCES users(id),
  approved_by uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE support_grants ENABLE ROW LEVEL SECURITY; ALTER TABLE support_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY sg_all ON support_grants USING (tenant_id = app_tenant() OR app_platform()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE ON support_grants TO erp_app;
