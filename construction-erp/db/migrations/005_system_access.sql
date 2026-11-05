-- Identity-level access for the trusted server ("system") and platform staff. Neither gets tenant operational data.
alter policy m_sel on memberships using (org_id = app_org() or user_id = app_user() or app_role() in ('system','platform'));
alter policy m_ins on memberships with check (org_id = app_org() and app_role() in ('owner','manager') or app_role() = 'system');
alter policy m_upd on memberships using (org_id = app_org() and app_role() in ('owner','manager') or app_role() = 'system') with check (true);
alter policy tenant_sel on invitations using (org_id = app_org() or app_role() = 'system');
alter policy tenant_ins on invitations with check (org_id = app_org() and app_role() in ('owner','manager') or app_role() = 'system');
alter policy tenant_upd on invitations using (org_id = app_org() and app_role() in ('owner','manager') or app_role() = 'system') with check (true);
alter policy tenant_del on invitations using (org_id = app_org() and app_role() in ('owner','manager'));
alter policy tenant_sel on branches using (org_id = app_org() or app_role() = 'system');
alter policy tenant_sel on role_permissions using (org_id = app_org() or app_role() = 'system');
alter policy tenant_sel on support_grants using (org_id = app_org() or app_role() = 'system' or support_user_id = app_user() or app_role() = 'platform');
alter policy tenant_ins on support_grants with check (app_role() in ('system','platform'));
alter policy tenant_upd on support_grants using (app_role() in ('system','platform') or org_id = app_org() and app_role() = 'owner') with check (true);
alter policy n_ins on notifications with check (org_id = app_org() or app_role() = 'system');
alter policy files_sel on files using (
  org_id = app_org()
  and (project_id is null or app_can_project(project_id))
  and (not restricted or current_setting('app.sensitive', true) like '%safety:incidents%' or app_role() = 'owner')
  and (not app_is_external() or project_id is not null)
);

create function org_usage(oid uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'users',      (select count(*) from memberships where org_id = oid and status = 'active' and role not in ('client','consultant','contractor')),
    'externals',  (select count(*) from memberships where org_id = oid and status = 'active' and role in ('client','consultant','contractor')),
    'projects',   (select count(*) from projects where org_id = oid and status <> 'closed'),
    'branches',   (select count(*) from branches where org_id = oid),
    'storage_mb', (select coalesce(ceil(sum(size_bytes)/1048576.0),0) from files where org_id = oid and status = 'stored'))
$$;
grant execute on function org_usage(uuid) to erp_app;

-- Contract-facing BOQ for clients/consultants: contract rate and billed quantity only — never the internal cost budget.
create function portal_boq(pid uuid) returns table(code text, description text, unit text, qty numeric, rate_paise bigint, billed_qty numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not app_can_project(pid) or app_role() not in ('client','consultant') then raise exception 'not permitted' using errcode = '42501'; end if;
  return query select b.code, b.description, b.unit, b.qty, b.rate_paise,
    coalesce((select sum(l.this_qty) from ra_bill_lines l join ra_bills rb on rb.id = l.bill_id where l.boq_item_id = b.id and rb.status in ('certified','invoiced')), 0)
    from boq_items b where b.project_id = pid order by b.code;
end $$;
grant execute on function portal_boq(uuid) to erp_app;

alter policy o_sel on orgs using (id = app_org() or app_role() in ('platform','system') or id in (select org_id from memberships where user_id = app_user()));

-- Row-based variant for the projects table itself (the row being inserted is not visible to a lookup function).
create function app_can_project_row(pid uuid, porg uuid, pbranch uuid) returns boolean language sql stable security definer set search_path = public as $$
  select porg = app_org() and exists (
    select 1 from (select 1) x
    left join memberships m on m.org_id = porg and m.user_id = app_user() and m.status = 'active'
    where (cardinality(coalesce(m.branch_ids,'{}')) = 0 or pbranch = any(m.branch_ids) or app_role() = 'support')
      and (app_role() in ('owner','manager','support','system')
           or exists (select 1 from project_members pm where pm.project_id = pid and pm.user_id = app_user() and pm.org_id = porg
                      and pm.effective_from <= current_date and (pm.effective_to is null or pm.effective_to >= current_date)))
  )
$$;
grant execute on function app_can_project_row(uuid, uuid, uuid) to erp_app;
alter policy proj_sel on projects using (app_can_project_row(id, org_id, branch_id));
alter policy proj_upd on projects using (app_can_project_row(id, org_id, branch_id) and app_role() in ('owner','manager','engineer')) with check (org_id = app_org());
