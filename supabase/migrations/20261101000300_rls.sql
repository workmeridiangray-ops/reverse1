-- Row-level security. Every table has RLS enabled; anything not granted by a
-- policy below is denied. All staff policies are scoped to the caller's own
-- clinic via app.clinic_id(), so no row is ever visible across clinics.
--
-- Access matrix (Phase 1)            admin  doctor  recep  lab  pharm  patient
--   clinics            read           own    own     own    own  own    own
--   profiles           read           clinic clinic  clinic clinic clinic self
--   patients           read           yes    yes     yes    yes  yes    self
--   patients           write          yes    -       yes    -    -      -
--   rooms              read           yes    yes     yes    yes  yes    -
--   rooms              write          yes    -       -      -    -      -
--   appointments       read           yes    yes     yes    -    -      own
--   appointments       write          yes    status* yes    -    -      -
--   consultations      read/write     -      own**   -      -    -      -
--   prescriptions      read           -      yes     -      -    yes    own active
--   invoices/lines/pay read           yes    -       yes    -    -      own issued
--   invoices/lines/pay write          yes    -       yes    -    -      -
--   audit_log          read           yes    -       -      -    -      -
--   * doctors: status of their own appointments only (trigger-enforced)
--   ** doctors read all consultations in their clinic, write only their own

-- Lock down defaults first: anon gets nothing, nobody truncates.
revoke all on all tables in schema public from anon;
revoke truncate on all tables in schema public from authenticated;
revoke all on schema app from public, anon;
grant usage on schema app to authenticated;
revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated;
revoke all on app.clinic_counters from public, anon, authenticated;

alter table public.clinics enable row level security;
alter table public.profiles enable row level security;
alter table public.patients enable row level security;
alter table public.rooms enable row level security;
alter table public.appointments enable row level security;
alter table public.consultations enable row level security;
alter table public.prescriptions enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.payments enable row level security;
alter table app.clinic_counters enable row level security; -- no policies: definer-only

-- clinics -------------------------------------------------------------------
create policy clinics_select on public.clinics for select to authenticated
  using (id = (select app.clinic_id()));
create policy clinics_update on public.clinics for update to authenticated
  using (id = (select app.clinic_id()) and (select app.has_role('admin')))
  with check (id = (select app.clinic_id()));

-- profiles ------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (clinic_id = (select app.clinic_id())
        and (select app.has_role('admin', 'doctor', 'receptionist', 'lab', 'pharmacist')))
  );
create policy profiles_insert on public.profiles for insert to authenticated
  with check (clinic_id = (select app.clinic_id()) and (select app.has_role('admin')));
create policy profiles_update on public.profiles for update to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin')))
  with check (clinic_id = (select app.clinic_id()));

-- patients ------------------------------------------------------------------
create policy patients_select on public.patients for select to authenticated
  using (
    (clinic_id = (select app.clinic_id())
      and (select app.has_role('admin', 'doctor', 'receptionist', 'lab', 'pharmacist')))
    or id = (select app.patient_id())
  );
create policy patients_insert on public.patients for insert to authenticated
  with check (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'receptionist')));
create policy patients_update on public.patients for update to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'receptionist')))
  with check (clinic_id = (select app.clinic_id()));

-- rooms ---------------------------------------------------------------------
create policy rooms_select on public.rooms for select to authenticated
  using (clinic_id = (select app.clinic_id())
         and (select app.has_role('admin', 'doctor', 'receptionist', 'lab', 'pharmacist')));
create policy rooms_insert on public.rooms for insert to authenticated
  with check (clinic_id = (select app.clinic_id()) and (select app.has_role('admin')));
create policy rooms_update on public.rooms for update to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin')))
  with check (clinic_id = (select app.clinic_id()));
create policy rooms_delete on public.rooms for delete to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin')));

-- appointments --------------------------------------------------------------
create policy appointments_select on public.appointments for select to authenticated
  using (
    (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'doctor', 'receptionist')))
    or patient_id = (select app.patient_id())
  );
create policy appointments_insert on public.appointments for insert to authenticated
  with check (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'receptionist')));
create policy appointments_update on public.appointments for update to authenticated
  using (
    clinic_id = (select app.clinic_id())
    and ((select app.has_role('admin', 'receptionist'))
         or ((select app.has_role('doctor')) and doctor_id = (select auth.uid())))
  )
  with check (clinic_id = (select app.clinic_id()));

-- consultations -------------------------------------------------------------
create policy consultations_select on public.consultations for select to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('doctor')));
create policy consultations_insert on public.consultations for insert to authenticated
  with check (clinic_id = (select app.clinic_id()) and (select app.has_role('doctor'))
              and doctor_id = (select auth.uid()));
create policy consultations_update on public.consultations for update to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('doctor'))
         and doctor_id = (select auth.uid()))
  with check (clinic_id = (select app.clinic_id()) and doctor_id = (select auth.uid()));

-- prescriptions -------------------------------------------------------------
create policy prescriptions_select on public.prescriptions for select to authenticated
  using (
    (clinic_id = (select app.clinic_id()) and (select app.has_role('doctor', 'pharmacist')))
    or (patient_id = (select app.patient_id()) and status in ('active', 'dispensed'))
  );
create policy prescriptions_insert on public.prescriptions for insert to authenticated
  with check (clinic_id = (select app.clinic_id()) and (select app.has_role('doctor'))
              and prescriber_id = (select auth.uid()));
create policy prescriptions_update on public.prescriptions for update to authenticated
  using (
    clinic_id = (select app.clinic_id())
    and (((select app.has_role('doctor')) and prescriber_id = (select auth.uid()))
         or (select app.has_role('pharmacist')))
  )
  with check (clinic_id = (select app.clinic_id()));

-- invoices ------------------------------------------------------------------
create policy invoices_select on public.invoices for select to authenticated
  using (
    (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'receptionist')))
    or (patient_id = (select app.patient_id()) and state = 'issued')
  );
create policy invoices_insert on public.invoices for insert to authenticated
  with check (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'receptionist')));
create policy invoices_update on public.invoices for update to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'receptionist')))
  with check (clinic_id = (select app.clinic_id()));

-- invoice_lines / payments: visible exactly when the parent invoice is.
create policy invoice_lines_select on public.invoice_lines for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_lines.invoice_id));
create policy invoice_lines_insert on public.invoice_lines for insert to authenticated
  with check (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'receptionist')));
create policy invoice_lines_update on public.invoice_lines for update to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'receptionist')))
  with check (clinic_id = (select app.clinic_id()));
create policy invoice_lines_delete on public.invoice_lines for delete to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'receptionist')));

create policy payments_select on public.payments for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = payments.invoice_id));
create policy payments_insert on public.payments for insert to authenticated
  with check (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'receptionist')));
-- No update/delete policies on payments: they are append-only.
revoke update, delete on public.payments from authenticated;
