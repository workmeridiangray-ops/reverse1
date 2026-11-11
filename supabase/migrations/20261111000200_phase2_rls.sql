-- Phase 2 row-level security. Same principles as Phase 1: every table has RLS,
-- every policy is scoped to the caller's clinic and role, minimum necessary.
--
--                              admin  doctor  recep  lab  pharm  patient
--   patient_allergies  read     -      yes     -      -    yes    -
--   patient_allergies  write    -      yes     -      -    -      -
--   lab_test_types     read     yes    yes     -      yes  -      (own released results only)
--   lab_test_types     write    yes    -       -      -    -      -
--   lab_reference_rng  read     yes    yes     -      yes  -      -
--   lab_reference_rng  write    yes    -       -      -    -      -
--   lab_orders         read     -      yes     -      yes  -      -
--   lab_orders         write    -      own*    -      yes  -      -
--   lab_results        read     -      yes     -      yes  -      own, RELEASED only
--   lab_results        write    -      own**   -      yes  -      -
--   * doctors create orders and cancel their own; ** acknowledge/release on their own orders
--   Column-level limits (lab enters values, doctors cannot; flag is computed) are trigger-enforced.
--   "Released only" for patients is a rule in the data layer, not a promise in the UI.

alter table public.patient_allergies enable row level security;
alter table public.lab_test_types enable row level security;
alter table public.lab_reference_ranges enable row level security;
alter table public.lab_orders enable row level security;
alter table public.lab_results enable row level security;

-- Default grants on new tables are broad; narrow them. TRUNCATE ignores RLS.
revoke all on public.patient_allergies, public.lab_test_types, public.lab_reference_ranges,
  public.lab_orders, public.lab_results from anon;
revoke truncate, references, trigger on public.patient_allergies, public.lab_test_types,
  public.lab_reference_ranges, public.lab_orders, public.lab_results from authenticated, service_role;
revoke delete on public.patient_allergies, public.lab_test_types, public.lab_reference_ranges,
  public.lab_orders, public.lab_results from authenticated;

-- patient_allergies ---------------------------------------------------------
create policy allergies_select on public.patient_allergies for select to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('doctor', 'pharmacist')));
create policy allergies_insert on public.patient_allergies for insert to authenticated
  with check (clinic_id = (select app.clinic_id()) and (select app.has_role('doctor')));
create policy allergies_update on public.patient_allergies for update to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('doctor')))
  with check (clinic_id = (select app.clinic_id()));

-- lab_test_types ------------------------------------------------------------
create policy lab_types_select on public.lab_test_types for select to authenticated
  using (
    (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'doctor', 'lab')))
    -- a patient can read the name of a test they have a released result for
    or exists (select 1 from public.lab_results r where r.test_type_id = lab_test_types.id)
  );
create policy lab_types_insert on public.lab_test_types for insert to authenticated
  with check (clinic_id = (select app.clinic_id()) and (select app.has_role('admin')));
create policy lab_types_update on public.lab_test_types for update to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin')))
  with check (clinic_id = (select app.clinic_id()));

-- lab_reference_ranges ------------------------------------------------------
create policy lab_ranges_select on public.lab_reference_ranges for select to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'doctor', 'lab')));
create policy lab_ranges_insert on public.lab_reference_ranges for insert to authenticated
  with check (clinic_id = (select app.clinic_id()) and (select app.has_role('admin')));
create policy lab_ranges_update on public.lab_reference_ranges for update to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin')))
  with check (clinic_id = (select app.clinic_id()));

-- lab_orders ----------------------------------------------------------------
create policy lab_orders_select on public.lab_orders for select to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('doctor', 'lab')));
create policy lab_orders_insert on public.lab_orders for insert to authenticated
  with check (clinic_id = (select app.clinic_id()) and (select app.has_role('doctor')) and ordered_by = (select auth.uid()));
create policy lab_orders_update on public.lab_orders for update to authenticated
  using (
    clinic_id = (select app.clinic_id())
    and ((select app.has_role('lab')) or ((select app.has_role('doctor')) and ordered_by = (select auth.uid())))
  )
  with check (clinic_id = (select app.clinic_id()));

-- lab_results ---------------------------------------------------------------
create policy lab_results_select on public.lab_results for select to authenticated
  using (
    (clinic_id = (select app.clinic_id()) and (select app.has_role('doctor', 'lab')))
    or (patient_id = (select app.patient_id()) and released_at is not null)
  );
create policy lab_results_insert on public.lab_results for insert to authenticated
  with check (
    clinic_id = (select app.clinic_id()) and (select app.has_role('doctor'))
    and exists (select 1 from public.lab_orders o where o.id = order_id and o.ordered_by = (select auth.uid()))
  );
create policy lab_results_update on public.lab_results for update to authenticated
  using (
    clinic_id = (select app.clinic_id())
    and ((select app.has_role('lab'))
         or ((select app.has_role('doctor'))
             and exists (select 1 from public.lab_orders o where o.id = lab_results.order_id and o.ordered_by = (select auth.uid()))))
  )
  with check (clinic_id = (select app.clinic_id()));

-- Access logging also covers lab orders. (Replaces the Phase 1 function.)
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
    when 'lab_orders' then select o.patient_id into patient from public.lab_orders o where o.id = p_record_id;
    else raise exception 'Unsupported table %', p_table using errcode = '22023';
  end case;
  if patient is null then
    raise exception 'Record not found' using errcode = 'P0002';
  end if;
  perform app.write_view_log(p_table, p_record_id, patient, p_reason);
end $$;

-- Grants for everything created in Phase 2.
revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated;
revoke all on function public.create_lab_order(uuid, uuid, uuid[], text) from public, anon;
grant execute on function public.create_lab_order(uuid, uuid, uuid[], text) to authenticated;
revoke all on function public.log_record_access(text, uuid, text) from public, anon;
grant execute on function public.log_record_access(text, uuid, text) to authenticated;
