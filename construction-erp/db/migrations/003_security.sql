-- Row-level security, tenant guards, immutability, audit triggers, portal functions.

create function app_org() returns uuid language sql stable as $$ select nullif(current_setting('app.org_id', true), '')::uuid $$;
create function app_user() returns uuid language sql stable as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
create function app_role() returns text language sql stable as $$ select coalesce(nullif(current_setting('app.role', true), ''), 'none') $$;
create function app_party() returns uuid language sql stable as $$ select nullif(current_setting('app.party_id', true), '')::uuid $$;
create function app_is_external() returns boolean language sql stable as $$ select app_role() in ('client','consultant','contractor') $$;

-- Can the current user see this project?  Owner/manager/support: whole org subject to branch assignment.
-- Everyone else: only projects where they hold an effective project_members row.
create function app_can_project(pid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from projects p
    left join memberships m on m.org_id = p.org_id and m.user_id = app_user() and m.status = 'active'
    where p.id = pid and p.org_id = app_org()
      and (cardinality(coalesce(m.branch_ids,'{}')) = 0 or p.branch_id = any(m.branch_ids) or app_role() = 'support')
      and (
        app_role() in ('owner','manager','support','system')
        or exists (select 1 from project_members pm
                   where pm.project_id = p.id and pm.user_id = app_user() and pm.org_id = p.org_id
                     and pm.effective_from <= current_date and (pm.effective_to is null or pm.effective_to >= current_date))
      )
  )
$$;

-- Same-organisation guard for every foreign key into a tenant table (FK checks bypass RLS).
create function guard_same_org() returns trigger language plpgsql as $$
declare i int := 0; col text; ref text; ok boolean; v uuid;
begin
  while i < TG_NARGS loop
    col := TG_ARGV[i]; ref := TG_ARGV[i+1]; i := i + 2;
    execute format('select ($1).%I', col) into v using new;
    if v is not null then
      execute format('select exists(select 1 from %I where id = $1 and org_id = $2)', ref) into ok using v, new.org_id;
      if not ok then raise exception 'cross-tenant or missing reference: %.% -> %', TG_TABLE_NAME, col, ref using errcode = '23503'; end if;
    end if;
  end loop;
  return new;
end $$;

do $$ declare r record; args text; begin
  for r in
    select c.conrelid::regclass::text as tbl, array_agg(a.attname || ',' || (c.confrelid::regclass::text)) as pairs
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    join pg_attribute oa on oa.attrelid = c.confrelid and oa.attname = 'org_id'
    join pg_attribute ta on ta.attrelid = c.conrelid and ta.attname = 'org_id'
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace and cardinality(c.conkey) = 1
      and c.confrelid::regclass::text not in ('orgs')
    group by c.conrelid
  loop
    select string_agg(quote_literal(split_part(p, ',', 1)) || ',' || quote_literal(split_part(p, ',', 2)), ',') into args from unnest(r.pairs) p;
    execute format('create trigger %I before insert or update on %I for each row execute function guard_same_org(%s)', r.tbl || '_orgguard', r.tbl, args);
  end loop;
end $$;

-- Immutable ledgers ---------------------------------------------------------------------
create function forbid_mutation() returns trigger language plpgsql as $$
begin raise exception '% is append-only', TG_TABLE_NAME using errcode = '42501'; end $$;
create trigger audit_log_immutable before update or delete on audit_log for each row execute function forbid_mutation();
create trigger stock_movements_immutable before update or delete on stock_movements for each row execute function forbid_mutation();
create trigger contract_ledger_immutable before update or delete on contract_ledger for each row execute function forbid_mutation();

-- Row audit for money-bearing tables: records changed column names only (no values) --------
create function audit_row() returns trigger language plpgsql as $$
declare cols text[]; oid_ uuid; org_ uuid;
begin
  if TG_OP = 'UPDATE' then
    select array_agg(k) into cols from jsonb_each(to_jsonb(new)) n(k, v) where to_jsonb(old) -> k is distinct from v and k not in ('version','updated_at');
    if cols is null then return new; end if;
  end if;
  oid_ := case when TG_OP = 'DELETE' then old.id else new.id end;
  org_ := case when TG_OP = 'DELETE' then old.org_id else new.org_id end;
  insert into audit_log(org_id, actor_id, actor_role, action, entity, entity_id, detail)
  values (org_, app_user(), app_role(), 'db.' || lower(TG_OP), TG_TABLE_NAME, oid_::text, jsonb_build_object('fields', coalesce(cols, '{}')));
  return coalesce(new, old);
end $$;
do $$ declare t text; begin
  foreach t in array array['contracts','ra_bills','invoices','receipts','disputes','variations','sub_bills','purchase_orders','boq_items','drawing_revisions','measurement_sheets','daily_reports','safety_incidents'] loop
    execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_row()', t||'_audit', t);
  end loop;
end $$;

-- Business-rule guards enforced in the database as well as the app -----------------------------
create function guard_receipt_total() returns trigger language plpgsql as $$
declare tot bigint; amt bigint;
begin
  perform 1 from invoices where id = new.invoice_id for update;
  select amount_paise - written_off_paise into amt from invoices where id = new.invoice_id;
  select coalesce(sum(amount_paise),0) into tot from receipts where invoice_id = new.invoice_id;
  if tot + new.amount_paise > amt then raise exception 'receipts would exceed invoice amount' using errcode = '23514'; end if;
  return new;
end $$;
create trigger receipts_total before insert on receipts for each row execute function guard_receipt_total();

create function guard_closed_project() returns trigger language plpgsql as $$
declare st text;
begin
  select status into st from projects where id = new.project_id;
  if st = 'closed' then raise exception 'project is closed (read-only)' using errcode = '55000'; end if;
  return new;
end $$;
do $$ declare t text; begin
  for t in select c.table_name from information_schema.columns c join information_schema.tables tb on tb.table_name = c.table_name and tb.table_schema = 'public' and tb.table_type = 'BASE TABLE'
           where c.table_schema = 'public' and c.column_name = 'project_id' and c.table_name not in ('project_members','documents','files','invitations','opportunities') loop
    execute format('create trigger %I before insert or update on %I for each row execute function guard_closed_project()', t||'_closed', t);
  end loop;
end $$;

-- RLS -------------------------------------------------------------------------------------
do $$
declare
  t text;
  external_ok text[] := array['projects','drawings','drawing_revisions','rfis','ra_bills','ra_bill_lines','variations','variation_items','inspections','invoices','receipts','disputes','contracts','boq_items','work_orders','wo_items','measurement_sheets','measurement_lines','sub_bills','snags','warranties','completion_checklist','wbs_nodes','project_members','parties','files','documents','transmittals','transmittal_items','cash_forecast_items','final_accounts','contract_milestones'];
  tenant_only text[] := array['branches','memberships','role_permissions','invitations','notifications','files','support_grants'];
begin
  -- org-level tables (org_id only)
  foreach t in array array['branches','role_permissions','invitations','notifications','parties','opportunities','estimate_revisions','estimate_items','files','support_grants'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_sel on %I for select using (org_id = app_org())', t);
    execute format('create policy tenant_ins on %I for insert with check (org_id = app_org() and app_role() <> ''support'')', t);
    execute format('create policy tenant_upd on %I for update using (org_id = app_org() and app_role() <> ''support'') with check (org_id = app_org())', t);
    execute format('create policy tenant_del on %I for delete using (org_id = app_org() and app_role() <> ''support'')', t);
  end loop;
  -- project-scoped tables
  for t in select c.table_name from information_schema.columns c
           where c.table_schema='public' and c.column_name='project_id' and c.table_name not in ('files','invitations','opportunities','documents') loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy proj_sel on %I for select using (org_id = app_org() and app_can_project(project_id))', t);
    execute format('create policy proj_ins on %I for insert with check (org_id = app_org() and app_can_project(project_id) and app_role() not in (''support'',''client'',''consultant'',''contractor'',''viewer''))', t);
    execute format('create policy proj_upd on %I for update using (org_id = app_org() and app_can_project(project_id) and app_role() not in (''support'',''client'',''consultant'',''contractor'',''viewer'')) with check (org_id = app_org())', t);
    execute format('create policy proj_del on %I for delete using (org_id = app_org() and app_can_project(project_id) and app_role() not in (''support'',''client'',''consultant'',''contractor'',''viewer''))', t);
    if t <> all (external_ok) then
      execute format('create policy ext_block on %I as restrictive for select using (not app_is_external())', t);
    end if;
  end loop;
end $$;

-- projects: scoped by id rather than project_id
alter table projects enable row level security;
create policy proj_sel on projects for select using (org_id = app_org() and app_can_project(id));
create policy proj_ins on projects for insert with check (org_id = app_org() and app_role() in ('owner','manager'));
create policy proj_upd on projects for update using (org_id = app_org() and app_can_project(id) and app_role() in ('owner','manager','engineer')) with check (org_id = app_org());
create policy proj_del on projects for delete using (false);

-- documents (project optional)
alter table documents enable row level security;
create policy doc_sel on documents for select using (org_id = app_org() and (project_id is null and not app_is_external() or app_can_project(project_id)));
create policy doc_mod on documents for all using (org_id = app_org() and app_role() not in ('support','client','consultant','contractor','viewer') and (project_id is null or app_can_project(project_id))) with check (org_id = app_org());

-- opportunities / estimating are internal commercial data
create policy ext_block on opportunities as restrictive for select using (not app_is_external());
create policy ext_block on estimate_revisions as restrictive for select using (not app_is_external());
create policy ext_block on estimate_items as restrictive for select using (not app_is_external());
create policy ext_block on branches as restrictive for select using (not app_is_external());
create policy ext_block on role_permissions as restrictive for select using (not app_is_external());
create policy ext_block on invitations as restrictive for select using (not app_is_external());

-- notifications: own only
drop policy tenant_sel on notifications; drop policy tenant_upd on notifications; drop policy tenant_ins on notifications; drop policy tenant_del on notifications;
create policy n_sel on notifications for select using (org_id = app_org() and user_id = app_user());
create policy n_upd on notifications for update using (org_id = app_org() and user_id = app_user()) with check (org_id = app_org() and user_id = app_user());
create policy n_ins on notifications for insert with check (org_id = app_org());

-- files: org-scoped; project files follow project visibility; restricted files need a sensitive grant
drop policy tenant_sel on files;
create policy files_sel on files for select using (
  org_id = app_org()
  and (project_id is null or app_can_project(project_id))
  and (not restricted or current_setting('app.sensitive', true) like '%safety:incidents%' or app_role() = 'owner')
  and (not app_is_external() or project_id is not null)
);

-- Restrictive, per-table "approved only" filters for external parties ------------------------
create policy ext_drawing_rev on drawing_revisions as restrictive for select using (not app_is_external() or status = 'approved');
create policy ext_bills on ra_bills as restrictive for select using (not app_is_external() or app_role() = 'contractor' and false or (app_role() in ('client','consultant') and status in ('submitted','certified','invoiced')));
create policy ext_bill_lines on ra_bill_lines as restrictive for select using (not app_is_external() or (app_role() in ('client','consultant') and exists (select 1 from ra_bills b where b.id = bill_id and b.status in ('submitted','certified','invoiced'))));
create policy ext_variations on variations as restrictive for select using (not app_is_external() or (app_role() in ('client','consultant') and status in ('submitted','approved','rejected')));
create policy ext_variation_items on variation_items as restrictive for select using (not app_is_external() or (app_role() in ('client','consultant') and exists (select 1 from variations v where v.id = variation_id and v.status in ('submitted','approved','rejected'))));
create policy ext_rfis on rfis as restrictive for select using (not app_is_external() or (status <> 'draft' and (assigned_party_id is not distinct from app_party() or app_role() <> 'contractor')));
create policy ext_inspections on inspections as restrictive for select using (not app_is_external() or external_visible);
create policy ext_invoices on invoices as restrictive for select using (not app_is_external() or app_role() in ('client','consultant'));
create policy ext_receipts on receipts as restrictive for select using (not app_is_external() or app_role() in ('client','consultant'));
create policy ext_disputes on disputes as restrictive for select using (not app_is_external() or app_role() in ('client','consultant'));
create policy ext_contracts on contracts as restrictive for select using (not app_is_external() or app_role() in ('client','consultant'));
create policy ext_boq on boq_items as restrictive for select using (not app_is_external());
create policy ext_parties on parties as restrictive for select using (not app_is_external());
create policy ext_files on files as restrictive for select using (not app_is_external() or true);
create policy ext_pm on project_members as restrictive for select using (not app_is_external() or user_id = app_user());
create policy ext_snags on snags as restrictive for select using (not app_is_external() or app_role() in ('client','consultant'));
create policy ext_wo on work_orders as restrictive for select using (not app_is_external() or (app_role() = 'contractor' and subcontractor_id = app_party()));
create policy ext_wo_items on wo_items as restrictive for select using (not app_is_external() or (app_role() = 'contractor' and exists (select 1 from work_orders w where w.id = work_order_id and w.subcontractor_id = app_party())));
create policy ext_sheets on measurement_sheets as restrictive for select using (not app_is_external() or (app_role() = 'contractor' and exists (select 1 from work_orders w where w.id = work_order_id and w.subcontractor_id = app_party())));
create policy ext_mlines on measurement_lines as restrictive for select using (not app_is_external() or (app_role() = 'contractor' and exists (select 1 from measurement_sheets s join work_orders w on w.id = s.work_order_id where s.id = sheet_id and w.subcontractor_id = app_party())));
create policy ext_subbills on sub_bills as restrictive for select using (not app_is_external() or (app_role() = 'contractor' and exists (select 1 from work_orders w where w.id = work_order_id and w.subcontractor_id = app_party())));
create policy ext_final on final_accounts as restrictive for select using (not app_is_external() or app_role() in ('client','consultant'));
create policy ext_ms on contract_milestones as restrictive for select using (not app_is_external() or app_role() in ('client','consultant'));
create policy ext_cf on cash_forecast_items as restrictive for select using (not app_is_external() or app_role() in ('client','consultant'));
create policy ext_checklist on completion_checklist as restrictive for select using (not app_is_external() or app_role() in ('client','consultant'));
create policy ext_warr on warranties as restrictive for select using (not app_is_external() or app_role() in ('client','consultant'));
create policy ext_wbs on wbs_nodes as restrictive for select using (not app_is_external() or true);
create policy ext_transm on transmittals as restrictive for select using (not app_is_external() or status = 'sent');
create policy ext_transm_i on transmittal_items as restrictive for select using (not app_is_external() or exists (select 1 from transmittals t where t.id = transmittal_id and t.status = 'sent'));

-- Safety incidents: restricted record --------------------------------------------------------
create policy incidents_restricted on safety_incidents as restrictive for select using (current_setting('app.sensitive', true) like '%safety:incidents%' or app_role() = 'owner');

-- Org-level tables with their own rules ------------------------------------------------------
alter table memberships enable row level security;
create policy m_sel on memberships for select using (org_id = app_org() or user_id = app_user());
create policy m_ins on memberships for insert with check (org_id = app_org() and app_role() in ('owner','manager'));
create policy m_upd on memberships for update using (org_id = app_org() and app_role() in ('owner','manager')) with check (org_id = app_org());
create policy m_del on memberships for delete using (false);

alter table orgs enable row level security;
create policy o_sel on orgs for select using (id = app_org() or app_role() = 'platform' or id in (select org_id from memberships where user_id = app_user()));
create policy o_ins on orgs for insert with check (true);
create policy o_upd on orgs for update using (id = app_org() and app_role() in ('owner') or app_role() = 'platform' or app_role() = 'system') with check (true);

alter table subscriptions enable row level security;
create policy s_sel on subscriptions for select using (org_id = app_org() or app_role() in ('platform','system'));
create policy s_mod on subscriptions for all using (org_id = app_org() and app_role() = 'owner' or app_role() in ('platform','system')) with check (true);

alter table platform_invoices enable row level security;
create policy pi_sel on platform_invoices for select using (org_id = app_org() and app_role() in ('owner','accounts') or app_role() in ('platform','system'));
create policy pi_mod on platform_invoices for all using (app_role() in ('platform','system') or org_id = app_org() and app_role() = 'owner') with check (true);
alter table platform_payments enable row level security;
create policy pp_sel on platform_payments for select using (org_id = app_org() and app_role() in ('owner','accounts') or app_role() in ('platform','system'));
create policy pp_mod on platform_payments for all using (app_role() in ('platform','system') or org_id = app_org() and app_role() = 'owner') with check (true);

alter table support_tickets enable row level security;
create policy st_sel on support_tickets for select using (org_id = app_org() or app_role() in ('platform','system') or user_id = app_user());
create policy st_mod on support_tickets for all using (org_id = app_org() or app_role() in ('platform','system')) with check (true);

alter table audit_log enable row level security;
create policy al_sel on audit_log for select using ((org_id = app_org() and app_role() in ('owner','manager','accounts')) or app_role() in ('platform','system'));
create policy al_ins on audit_log for insert with check (true);

alter table jobs enable row level security;
create policy j_sel on jobs for select using (org_id = app_org() or app_role() in ('platform','system'));
create policy j_mod on jobs for all using (app_role() in ('platform','system')) with check (true);
create policy j_ins on jobs for insert with check (true);

alter table webhook_events enable row level security;
create policy w_all on webhook_events for all using (app_role() in ('platform','system')) with check (app_role() in ('platform','system'));

alter table email_outbox enable row level security;
create policy e_all on email_outbox for all using (app_role() in ('platform','system') or org_id = app_org()) with check (true);

-- ----- Portal functions: the ONLY way an external party changes anything. They verify identity and authority. -----
create function portal_decide_variation(vid uuid, approve boolean, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare v variations; pm project_members;
begin
  if app_role() not in ('client','consultant') then raise exception 'not permitted' using errcode = '42501'; end if;
  select * into v from variations where id = vid and org_id = app_org();
  if v.id is null or not app_can_project(v.project_id) then raise exception 'not found' using errcode = '42501'; end if;
  select * into pm from project_members where project_id = v.project_id and user_id = app_user() and effective_to is null;
  if pm.id is null or not ('variation:approve' = any(pm.authorities)) then raise exception 'no authority to decide variations' using errcode = '42501'; end if;
  if pm.approval_limit_paise < abs(v.cost_delta_paise) then raise exception 'exceeds your approval limit' using errcode = '42501'; end if;
  if v.status <> 'submitted' then raise exception 'variation is not awaiting decision' using errcode = '55000'; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = '23514'; end if;
  update variations set status = case when approve then 'approved' else 'rejected' end, decided_by = app_user(), decided_at = now(), decision_reason = p_reason where id = vid;
  insert into audit_log(org_id, actor_id, actor_role, action, entity, entity_id, detail)
    values (v.org_id, app_user(), app_role(), 'portal.variation.' || case when approve then 'approve' else 'reject' end, 'variations', vid::text, jsonb_build_object('reason', p_reason));
end $$;

create function portal_respond_rfi(rid uuid, answer text) returns void language plpgsql security definer set search_path = public as $$
declare r rfis;
begin
  if app_role() not in ('client','consultant','contractor') then raise exception 'not permitted' using errcode = '42501'; end if;
  select * into r from rfis where id = rid and org_id = app_org();
  if r.id is null or not app_can_project(r.project_id) then raise exception 'not found' using errcode = '42501'; end if;
  if r.assigned_party_id is not null and r.assigned_party_id is distinct from app_party() and app_role() = 'contractor' then raise exception 'not your RFI' using errcode = '42501'; end if;
  if r.status <> 'open' then raise exception 'RFI is not open' using errcode = '55000'; end if;
  if answer is null or length(trim(answer)) < 3 then raise exception 'a response is required' using errcode = '23514'; end if;
  update rfis set response = answer, status = 'responded', responded_by = app_user(), responded_at = now() where id = rid;
  insert into audit_log(org_id, actor_id, actor_role, action, entity, entity_id, detail) values (r.org_id, app_user(), app_role(), 'portal.rfi.respond', 'rfis', rid::text, '{}');
end $$;

-- Aggregate progress for externals: physical (verified quantities) and financial (certified), never internal cost.
create function portal_progress(pid uuid) returns table(physical_bp int, contract_value_paise bigint, certified_paise bigint, invoiced_paise bigint, collected_paise bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not app_can_project(pid) or not app_is_external() or app_role() = 'contractor' then raise exception 'not permitted' using errcode = '42501'; end if;
  return query
   select coalesce((select (sum(least(b.qty, coalesce(c.cum,0)) * b.rate_paise) * 10000 / nullif(sum(b.qty * b.rate_paise),0))::int
            from boq_items b left join (select boq_item_id, sum(this_qty) cum from ra_bill_lines l join ra_bills rb on rb.id = l.bill_id where rb.status in ('certified','invoiced') group by 1) c on c.boq_item_id = b.id
            where b.project_id = pid), 0),
          coalesce((select sum(qty * rate_paise)::bigint from boq_items where project_id = pid),0),
          coalesce((select max(certified_gross_paise) from ra_bills where project_id = pid and status in ('certified','invoiced')),0),
          coalesce((select sum(amount_paise) from invoices where project_id = pid),0)::bigint,
          coalesce((select sum(collected_paise) from invoices where project_id = pid),0)::bigint;
end $$;

-- Grants -----------------------------------------------------------------------------------
grant usage on schema public to erp_app;
grant select, insert, update, delete on all tables in schema public to erp_app;
grant usage, select on all sequences in schema public to erp_app;
revoke update, delete on audit_log from erp_app;
revoke update, delete on stock_movements from erp_app;
revoke update, delete on contract_ledger from erp_app;
grant execute on all functions in schema public to erp_app;
alter default privileges in schema public grant select, insert, update, delete on tables to erp_app;
