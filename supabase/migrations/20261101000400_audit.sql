-- Audit trail. Append-only for everyone, including admins and the service role.
--
-- What is logged:
--   * every insert / update / delete on clinical, financial and identity tables
--     (trigger) - with the NAMES of changed columns, never their values, so the
--     log does not become a second copy of the health record;
--   * every time a user opens a patient-level record (RPC log_record_access,
--     called by the server data layer, see lib/data/audit.ts).

create table public.audit_log (
  id bigint generated always as identity primary key,
  clinic_id uuid not null references public.clinics (id),
  actor_id uuid,
  actor_role public.app_role,
  action text not null check (action in ('insert', 'update', 'delete', 'view')),
  table_name text not null,
  record_id uuid,
  patient_id uuid,
  changed_fields text[],
  reason text check (reason is null or length(reason) <= 500),
  occurred_at timestamptz not null default now()
);
create index audit_log_clinic_time_idx on public.audit_log (clinic_id, occurred_at desc);
create index audit_log_patient_idx on public.audit_log (patient_id, occurred_at desc);

alter table public.audit_log enable row level security;
create policy audit_log_select on public.audit_log for select to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin')));
-- No insert/update/delete policies; writes come only from definer functions.
revoke insert, update, delete, truncate on public.audit_log from anon, authenticated, service_role;

create or replace function app.audit_log_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_log is append-only' using errcode = '42501';
end $$;
create trigger audit_log_immutable before update or delete on public.audit_log
  for each row execute function app.audit_log_immutable();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function app.audit_log_immutable();

create or replace function app.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r jsonb := to_jsonb(coalesce(new, old));
  changed text[];
  clinic uuid;
  patient uuid;
begin
  if tg_op = 'UPDATE' then
    select array_agg(key order by key) into changed
    from jsonb_each(to_jsonb(new)) n
    where key not in ('updated_at') and n.value is distinct from (to_jsonb(old) -> key);
    if changed is null then
      return null; -- no-op update, nothing to log
    end if;
  end if;

  clinic := case when tg_table_name = 'clinics' then (r ->> 'id')::uuid else (r ->> 'clinic_id')::uuid end;
  patient := case when tg_table_name = 'patients' then (r ->> 'id')::uuid else (r ->> 'patient_id')::uuid end;

  insert into public.audit_log (clinic_id, actor_id, actor_role, action, table_name, record_id, patient_id, changed_fields)
  values (clinic, auth.uid(), app.role(), lower(tg_op), tg_table_name, (r ->> 'id')::uuid, patient, changed);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['clinics', 'profiles', 'patients', 'rooms', 'appointments', 'consultations',
                           'prescriptions', 'invoices', 'invoice_lines', 'payments']
  loop
    execute format(
      'create trigger audit_row after insert or update or delete on public.%I for each row execute function app.audit_row()', t);
  end loop;
end $$;

-- Writes a 'view' entry. Not exposed through the API (app schema).
create or replace function app.write_view_log(p_table text, p_record uuid, p_patient uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id();
begin
  if auth.uid() is null or clinic is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  insert into public.audit_log (clinic_id, actor_id, actor_role, action, table_name, record_id, patient_id, reason)
  values (clinic, auth.uid(), app.role(), 'view', p_table, p_record, p_patient, left(p_reason, 500));
end $$;

-- Public RPC. SECURITY INVOKER: the lookup runs under the caller's RLS, so a
-- user can only log (and thereby confirm the existence of) records they can see.
create or replace function public.log_record_access(p_table text, p_record_id uuid, p_reason text default null)
returns void language plpgsql security invoker set search_path = '' as $$
declare patient uuid;
begin
  case p_table
    when 'patients' then select p.id into patient from public.patients p where p.id = p_record_id;
    when 'appointments' then select a.patient_id into patient from public.appointments a where a.id = p_record_id;
    when 'consultations' then select c.patient_id into patient from public.consultations c where c.id = p_record_id;
    when 'prescriptions' then select x.patient_id into patient from public.prescriptions x where x.id = p_record_id;
    when 'invoices' then select i.patient_id into patient from public.invoices i where i.id = p_record_id;
    else raise exception 'Unsupported table %', p_table using errcode = '22023';
  end case;
  if patient is null then
    raise exception 'Record not found' using errcode = 'P0002';
  end if;
  perform app.write_view_log(p_table, p_record_id, patient, p_reason);
end $$;
revoke all on function public.log_record_access(text, uuid, text) from public, anon;
grant execute on function public.log_record_access(text, uuid, text) to authenticated;

-- New functions created after the grant in the RLS migration need explicit grants.
revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated;
