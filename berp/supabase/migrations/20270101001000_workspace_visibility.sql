-- A member must be able to read the name/plan/status of every workspace they belong to (not just the active one),
-- otherwise the workspace picker cannot list them.
create policy tenants_member_read on public.tenants for select to authenticated
  using (exists (select 1 from public.memberships m where m.tenant_id = tenants.id and m.user_id = (select auth.uid()) and m.active));
