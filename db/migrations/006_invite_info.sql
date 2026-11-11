-- Invitation landing page: read exactly one invitation by its secret token hash, plus the business name, nothing else.
CREATE FUNCTION invite_info(p_hash text)
RETURNS TABLE(email text, role text, tname text, accepted_at timestamptz, revoked_at timestamptz, expired boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.email, i.role, t.name, i.accepted_at, i.revoked_at, i.expires_at < now()
    FROM invitations i JOIN tenants t ON t.id = i.tenant_id WHERE i.token_hash = p_hash
$$;
REVOKE ALL ON FUNCTION invite_info(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION invite_info(text) TO erp_app;
