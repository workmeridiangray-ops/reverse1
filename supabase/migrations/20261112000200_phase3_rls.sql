-- Phase 3 row-level security. Same principles: every table has RLS, scoped to
-- the caller's clinic and role, minimum necessary.
--
--                              admin  doctor  recep  lab  pharm  patient
--   stock_products     read     yes    -       -      -    yes    -
--   stock_products     write    yes    -       -      -    yes    -
--   stock_batches      read     yes    -       -      -    yes    -
--   stock_batches      write    -      -       -      -    yes    -   (receive; quarantine/recall)
--   stock_movements    read     yes    -       -      -    yes    -   (append-only)
--   dispenses (+items) read     -      yes     -      -    yes    own
--   dispenses (+items) write    -      -       -      -    yes    -   (via dispense_prescription only)
--   appointment_requests read   yes    -       yes    -    -      own
--   appointment_requests write  staff: book / decline;  patient: create, cancel own
--   patient_allergies  read     (Phase 2)                           + own, so a patient can see theirs

alter table public.stock_products enable row level security;
alter table public.stock_batches enable row level security;
alter table public.stock_movements enable row level security;
alter table public.dispenses enable row level security;
alter table public.dispense_items enable row level security;
alter table public.appointment_requests enable row level security;

revoke all on public.stock_products, public.stock_batches, public.stock_movements, public.dispenses,
  public.dispense_items, public.appointment_requests from anon;
revoke truncate, references, trigger on public.stock_products, public.stock_batches, public.stock_movements,
  public.dispenses, public.dispense_items, public.appointment_requests from authenticated, service_role;
revoke delete on public.stock_products, public.stock_batches, public.stock_movements, public.dispenses,
  public.dispense_items, public.appointment_requests from authenticated;
revoke update on public.stock_movements, public.dispenses, public.dispense_items from authenticated;

-- stock_products ------------------------------------------------------------
create policy stock_products_select on public.stock_products for select to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'pharmacist')));
create policy stock_products_insert on public.stock_products for insert to authenticated
  with check (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'pharmacist')));
create policy stock_products_update on public.stock_products for update to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'pharmacist')))
  with check (clinic_id = (select app.clinic_id()));

-- stock_batches -------------------------------------------------------------
create policy stock_batches_select on public.stock_batches for select to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'pharmacist')));
create policy stock_batches_insert on public.stock_batches for insert to authenticated
  with check (clinic_id = (select app.clinic_id()) and (select app.has_role('pharmacist')));
create policy stock_batches_update on public.stock_batches for update to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('pharmacist')))
  with check (clinic_id = (select app.clinic_id()));

-- stock_movements (append-only) --------------------------------------------
create policy stock_movements_select on public.stock_movements for select to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'pharmacist')));
create policy stock_movements_insert on public.stock_movements for insert to authenticated
  with check (clinic_id = (select app.clinic_id()) and (select app.has_role('pharmacist')));

-- dispenses and their items -------------------------------------------------
create policy dispenses_select on public.dispenses for select to authenticated
  using (
    (clinic_id = (select app.clinic_id()) and (select app.has_role('doctor', 'pharmacist')))
    or patient_id = (select app.patient_id())
  );
create policy dispenses_insert on public.dispenses for insert to authenticated
  with check (clinic_id = (select app.clinic_id()) and (select app.has_role('pharmacist')) and dispensed_by = (select auth.uid()));
create policy dispense_items_select on public.dispense_items for select to authenticated
  using (exists (select 1 from public.dispenses d where d.id = dispense_items.dispense_id));
create policy dispense_items_insert on public.dispense_items for insert to authenticated
  with check (clinic_id = (select app.clinic_id()) and (select app.has_role('pharmacist')));

-- appointment_requests ------------------------------------------------------
create policy requests_select on public.appointment_requests for select to authenticated
  using (
    (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'receptionist')))
    or patient_id = (select app.patient_id())
  );
create policy requests_insert on public.appointment_requests for insert to authenticated
  with check (patient_id = (select app.patient_id()) and clinic_id = (select app.clinic_id()));
create policy requests_update on public.appointment_requests for update to authenticated
  using (
    (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'receptionist')))
    or patient_id = (select app.patient_id())
  )
  with check (clinic_id = (select app.clinic_id()));

-- A patient may read their own allergy list (Phase 2 policy covered staff only).
create policy allergies_select_own on public.patient_allergies for select to authenticated
  using (patient_id = (select app.patient_id()) and removed_at is null);

-- Grants for everything created in Phase 3.
revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated;
revoke all on function public.dispense_prescription(uuid, uuid, jsonb, integer, text) from public, anon;
grant execute on function public.dispense_prescription(uuid, uuid, jsonb, integer, text) to authenticated;
revoke all on function public.adjust_stock(uuid, integer, text, text) from public, anon;
grant execute on function public.adjust_stock(uuid, integer, text, text) to authenticated;
revoke all on function public.update_my_details(text, text, text, boolean) from public, anon;
grant execute on function public.update_my_details(text, text, text, boolean) to authenticated;
revoke all on function public.analytics_lab_durations(timestamptz, timestamptz) from public, anon;
grant execute on function public.analytics_lab_durations(timestamptz, timestamptz) to authenticated;
