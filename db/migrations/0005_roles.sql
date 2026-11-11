-- Role bootstrap is environment-specific; see docs/deployment.md. This migration only documents the contract:
-- the runtime role must NOT be superuser and must NOT have BYPASSRLS, otherwise tenant isolation is void.
do $$ begin
  if exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise notice 'Applied as a privileged role (expected for the owner). Make sure DATABASE_URL uses a non-privileged role.';
  end if;
end $$;
