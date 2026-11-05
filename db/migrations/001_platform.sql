-- Platform: identity, tenants, plans, memberships, audit, outbox.
-- The application connects as `erp_app` (no BYPASSRLS, not owner). Every request
-- sets app.tenant_id / app.user_id / app.role / app.platform for the transaction.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app') THEN
    CREATE ROLE erp_app NOLOGIN;
  END IF;
END $$;

CREATE FUNCTION app_tenant() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
CREATE FUNCTION app_user() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
CREATE FUNCTION app_role() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.role', true), '') $$;
CREATE FUNCTION app_platform() RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT coalesce(current_setting('app.platform', true), '') = 'on' $$;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  name text NOT NULL,
  password_hash text NOT NULL,
  is_platform_admin boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  email_verified_at timestamptz,
  failed_logins int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  user_agent text
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE auth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('reset','verify')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  version int NOT NULL DEFAULT 1,
  name text NOT NULL,
  price_month_minor bigint NOT NULL CHECK (price_month_minor >= 0),
  price_year_minor bigint NOT NULL CHECK (price_year_minor >= 0),
  max_projects int NOT NULL,
  max_users int NOT NULL,
  storage_mb int NOT NULL,
  effective_from date NOT NULL DEFAULT current_date,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (code, version)
);

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','active','past_due','suspended','closed')),
  plan_id uuid NOT NULL REFERENCES plans(id),
  billing_cycle text NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly','yearly')),
  trial_ends_at timestamptz,
  grace_until timestamptz,
  currency text NOT NULL DEFAULT 'INR',
  gstin text,
  address text,
  suspended_reason text,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Plan change history keeps historical billing traceable.
CREATE TABLE plan_changes (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  from_plan_id uuid REFERENCES plans(id),
  to_plan_id uuid NOT NULL REFERENCES plans(id),
  changed_by uuid REFERENCES users(id),
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','manager','engineer','procurement','accounts','viewer','client','consultant')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','manager','engineer','procurement','accounts','viewer','client','consultant')),
  project_ids uuid[] NOT NULL DEFAULT '{}',
  token_hash text NOT NULL UNIQUE,
  invited_by uuid REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  tenant_id uuid,
  user_id uuid,
  action text NOT NULL,
  entity text,
  entity_id text,
  detail jsonb NOT NULL DEFAULT '{}',
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_tenant_idx ON audit_log(tenant_id, at DESC);
CREATE FUNCTION audit_immutable() RETURNS trigger LANGUAGE plpgsql AS
  $$ BEGIN RAISE EXCEPTION 'audit_log is append-only'; END $$;
CREATE TRIGGER audit_no_update BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_immutable();

CREATE TABLE email_outbox (
  id bigserial PRIMARY KEY,
  tenant_id uuid,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE TABLE leads (
  id bigserial PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('demo','contact')),
  name text NOT NULL,
  email text NOT NULL,
  company text,
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotency for duplicate form submissions.
CREATE TABLE request_log (
  request_id uuid NOT NULL,
  scope text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, request_id)
);

CREATE TABLE login_attempts (
  id bigserial PRIMARY KEY,
  key text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_key_idx ON login_attempts(key, at);

CREATE TABLE tenant_counters (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  value bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, name)
);

-- RLS on platform tables that carry tenant data.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY; ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenants_sel ON tenants FOR SELECT USING (id = app_tenant() OR app_platform() OR
  EXISTS (SELECT 1 FROM memberships m WHERE m.tenant_id = tenants.id AND m.user_id = app_user()));
CREATE POLICY tenants_ins ON tenants FOR INSERT WITH CHECK (true);
CREATE POLICY tenants_upd ON tenants FOR UPDATE USING (id = app_tenant() OR app_platform()) WITH CHECK (id = app_tenant() OR app_platform());

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY; ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY mem_sel ON memberships FOR SELECT USING (tenant_id = app_tenant() OR user_id = app_user() OR app_platform());
CREATE POLICY mem_ins ON memberships FOR INSERT WITH CHECK (true);
CREATE POLICY mem_upd ON memberships FOR UPDATE USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY; ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY inv_all ON invitations USING (tenant_id = app_tenant() OR current_setting('app.invite_lookup', true) = 'on')
  WITH CHECK (tenant_id = app_tenant() OR current_setting('app.invite_lookup', true) = 'on');

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY; ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_sel ON audit_log FOR SELECT USING (tenant_id = app_tenant() OR (app_platform() AND tenant_id IS NOT NULL) OR (app_platform() AND tenant_id IS NULL));
CREATE POLICY audit_ins ON audit_log FOR INSERT WITH CHECK (true);

ALTER TABLE tenant_counters ENABLE ROW LEVEL SECURITY; ALTER TABLE tenant_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY cnt_all ON tenant_counters USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

ALTER TABLE plan_changes ENABLE ROW LEVEL SECURITY; ALTER TABLE plan_changes FORCE ROW LEVEL SECURITY;
CREATE POLICY pc_sel ON plan_changes FOR SELECT USING (tenant_id = app_tenant() OR app_platform());
CREATE POLICY pc_ins ON plan_changes FOR INSERT WITH CHECK (true);

-- Gapless-per-tenant document numbers (INV-0001 ...), safe under concurrency.
CREATE FUNCTION next_number(p_name text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v bigint;
BEGIN
  INSERT INTO tenant_counters(tenant_id, name, value) VALUES (app_tenant(), p_name, 1)
  ON CONFLICT (tenant_id, name) DO UPDATE SET value = tenant_counters.value + 1
  RETURNING value INTO v;
  RETURN v;
END $$;

INSERT INTO plans (code, name, price_month_minor, price_year_minor, max_projects, max_users, storage_mb) VALUES
  ('starter','Starter',  499900, 4999000,  3,  10,  2048),
  ('growth', 'Growth',  1499900,14999000, 15,  50, 20480),
  ('scale',  'Scale',   3999900,39999000, 100, 250, 204800);
