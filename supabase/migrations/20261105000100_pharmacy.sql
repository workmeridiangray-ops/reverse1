-- Phase 5: pharmacy -- medicine catalogue, batches/expiry, stock ledger, dispensing
-- (partial, FIFO suggestion in the UI), substitution approval, returns with review,
-- quarantine, recall, disposal, and a controlled-item witness rule.
-- Stock changes ONLY through these functions, each writing an append-only movement.

alter table public.prescriptions
  add column medicine_id uuid,
  add column quantity integer check (quantity is null or quantity between 1 and 100000);

create table public.medicines (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  name text not null check (length(trim(name)) between 1 and 120),
  strength text not null default '' check (length(strength) <= 40),
  form text not null default 'tablet' check (length(form) between 1 and 40),
  controlled boolean not null default false,
  on_formulary boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, clinic_id),
  unique (clinic_id, name, strength, form)
);
alter table public.prescriptions add foreign key (medicine_id, clinic_id) references public.medicines (id, clinic_id);

create table public.stock_batches (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  medicine_id uuid not null,
  batch_no text not null check (length(trim(batch_no)) between 1 and 60),
  expiry_date date not null,
  received_qty integer not null check (received_qty > 0),
  on_hand_qty integer not null check (on_hand_qty >= 0),
  status text not null default 'available' check (status in ('available', 'quarantined', 'recalled', 'disposed')),
  status_reason text,
  supplier_ref text check (supplier_ref is null or length(supplier_ref) <= 100),
  received_by uuid references public.profiles (id),
  received_at timestamptz not null default now(),
  unique (id, clinic_id),
  unique (medicine_id, batch_no),
  foreign key (medicine_id, clinic_id) references public.medicines (id, clinic_id),
  check (on_hand_qty <= received_qty),
  check (status in ('available', 'disposed') or length(trim(coalesce(status_reason, ''))) >= 5)
);
create index stock_batches_med_idx on public.stock_batches (medicine_id, expiry_date);

create table public.stock_movements (
  id bigint generated always as identity primary key,
  clinic_id uuid not null references public.clinics (id),
  batch_id uuid not null,
  kind text not null check (kind in ('receipt', 'dispense', 'return_restock', 'disposal', 'adjustment')),
  qty integer not null check (qty <> 0),
  reference_id uuid,
  reason text,
  by_user uuid references public.profiles (id),
  at timestamptz not null default now(),
  foreign key (batch_id, clinic_id) references public.stock_batches (id, clinic_id)
);
create index stock_movements_batch_idx on public.stock_movements (batch_id, at);

create table public.dispensings (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  prescription_id uuid not null,
  patient_id uuid not null,
  medicine_id uuid not null,
  batch_id uuid not null,
  qty integer not null check (qty > 0),
  returned_qty integer not null default 0 check (returned_qty >= 0),
  dispensed_by uuid not null references public.profiles (id),
  witness_id uuid references public.profiles (id),
  dispensed_at timestamptz not null default now(),
  unique (id, clinic_id),
  foreign key (prescription_id, clinic_id) references public.prescriptions (id, clinic_id),
  foreign key (patient_id, clinic_id) references public.patients (id, clinic_id),
  foreign key (batch_id, clinic_id) references public.stock_batches (id, clinic_id),
  check (returned_qty <= qty),
  check (witness_id is null or witness_id <> dispensed_by)
);
create index dispensings_rx_idx on public.dispensings (prescription_id);
create index dispensings_batch_idx on public.dispensings (batch_id);

create table public.substitutions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  prescription_id uuid not null,
  medicine_id uuid not null,
  reason text not null check (length(trim(reason)) >= 5),
  status text not null default 'requested' check (status in ('requested', 'approved', 'rejected')),
  requested_by uuid not null references public.profiles (id),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  unique (prescription_id, medicine_id),
  foreign key (prescription_id, clinic_id) references public.prescriptions (id, clinic_id),
  foreign key (medicine_id, clinic_id) references public.medicines (id, clinic_id),
  check ((status = 'requested') = (decided_by is null))
);

create table public.stock_returns (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  dispensing_id uuid not null,
  qty integer not null check (qty > 0),
  reason text not null check (length(trim(reason)) >= 5),
  claimed_saleable boolean not null,
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'restocked', 'disposed', 'rejected')),
  requested_by uuid not null references public.profiles (id),
  decided_by uuid references public.profiles (id),
  decision_note text,
  decided_at timestamptz,
  foreign key (dispensing_id, clinic_id) references public.dispensings (id, clinic_id),
  check ((status = 'pending') = (decided_by is null)),
  check (decided_by is null or decided_by <> requested_by)
);

do $$
declare t text;
begin
  foreach t in array array['medicines','stock_batches','dispensings','substitutions','stock_returns'] loop
    execute format('create trigger forbid_clinic_change before update on public.%I for each row execute function app.forbid_clinic_change()', t);
    execute format('create trigger audit_row after insert or update or delete on public.%I for each row execute function app.audit_row()', t);
    execute format('create trigger workflow_only before insert or update or delete on public.%I for each row execute function app.workflow_only()', t);
  end loop;
end $$;
create trigger workflow_only before insert or update or delete on public.stock_movements for each row execute function app.workflow_only();
create trigger immutable_row before update or delete on public.stock_movements for each row execute function app.immutable_row();
-- Prescriptions can no longer be flipped to 'dispensed' by a client; only dispensing does that.
drop policy prescriptions_update on public.prescriptions;
create policy prescriptions_update on public.prescriptions for update to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('doctor')) and prescriber_id = (select auth.uid()))
  with check (clinic_id = (select app.clinic_id()));
create or replace function app.prescription_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.status = 'dispensed' and new is distinct from old then
    raise exception 'A dispensed prescription is part of the record.' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' and new.status = 'dispensed' and old.status <> 'dispensed' and app.is_direct_client() then
    raise exception 'Prescriptions become dispensed only through dispensing.' using errcode = '42501';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
create or replace function public.add_medicine(p_name text, p_strength text, p_form text, p_controlled boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); new_id uuid;
begin
  perform app.assert_role('pharmacist', 'admin');
  insert into public.medicines (clinic_id, name, strength, form, controlled) values (clinic, trim(p_name), trim(coalesce(p_strength, '')), trim(p_form), p_controlled)
  returning medicines.id into new_id;
  return new_id;
end $$;

create or replace function public.receive_stock(p_medicine uuid, p_batch text, p_expiry date, p_qty integer, p_supplier text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); new_id uuid;
begin
  perform app.assert_role('pharmacist', 'admin');
  if not exists (select 1 from public.medicines where id = p_medicine and clinic_id = clinic and active) then raise exception 'Medicine not found.' using errcode = 'P0002'; end if;
  if p_expiry <= current_date then raise exception 'That batch is already expired. Do not receive it.' using errcode = '23514'; end if;
  insert into public.stock_batches (clinic_id, medicine_id, batch_no, expiry_date, received_qty, on_hand_qty, supplier_ref, received_by)
  values (clinic, p_medicine, trim(p_batch), p_expiry, p_qty, p_qty, nullif(trim(p_supplier), ''), auth.uid()) returning stock_batches.id into new_id;
  insert into public.stock_movements (clinic_id, batch_id, kind, qty, by_user) values (clinic, new_id, 'receipt', p_qty, auth.uid());
  return new_id;
end $$;

create or replace function public.prescribe(p_patient uuid, p_medicine uuid, p_dose text, p_route text, p_frequency text, p_days integer, p_qty integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); m public.medicines%rowtype; new_id uuid;
begin
  perform app.assert_role('doctor');
  select * into m from public.medicines where id = p_medicine and clinic_id = clinic and active;
  if not found then raise exception 'Medicine not found.' using errcode = 'P0002'; end if;
  if not m.on_formulary then raise exception '% is not on the formulary.', m.name using errcode = '55000'; end if;
  if not exists (select 1 from public.patients where id = p_patient and clinic_id = clinic and archived_at is null) then raise exception 'Patient not found.' using errcode = 'P0002'; end if;
  insert into public.prescriptions (clinic_id, patient_id, prescriber_id, drug_name, dose, route, frequency, duration_days, status, medicine_id, quantity)
  values (clinic, p_patient, auth.uid(), trim(m.name || ' ' || m.strength || ' ' || m.form), trim(p_dose), trim(p_route), trim(p_frequency), p_days, 'active', p_medicine, p_qty)
  returning prescriptions.id into new_id;
  return new_id;
end $$;

create or replace function public.request_substitution(p_rx uuid, p_medicine uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id();
begin
  perform app.assert_role('pharmacist');
  if not exists (select 1 from public.prescriptions where id = p_rx and clinic_id = clinic and status = 'active') then raise exception 'Active prescription not found.' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.medicines where id = p_medicine and clinic_id = clinic and active) then raise exception 'Medicine not found.' using errcode = 'P0002'; end if;
  insert into public.substitutions (clinic_id, prescription_id, medicine_id, reason, requested_by) values (clinic, p_rx, p_medicine, trim(p_reason), auth.uid());
  perform app.notify(clinic, (select prescriber_id from public.prescriptions where id = p_rx), 'substitution', 'Substitution awaiting your approval', '/pharmacy/prescriptions/' || p_rx);
end $$;

create or replace function public.decide_substitution(p_sub uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); s public.substitutions%rowtype; rx public.prescriptions%rowtype;
begin
  perform app.assert_role('doctor');
  select * into s from public.substitutions where id = p_sub and clinic_id = clinic for update;
  if not found then raise exception 'Substitution not found.' using errcode = 'P0002'; end if;
  select * into rx from public.prescriptions where id = s.prescription_id;
  if rx.prescriber_id <> auth.uid() then raise exception 'Only the prescriber can decide a substitution.' using errcode = '42501'; end if;
  if s.status <> 'requested' then raise exception 'Already decided.' using errcode = '55000'; end if;
  update public.substitutions set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now() where id = p_sub;
end $$;

create or replace function public.dispense(p_rx uuid, p_batch uuid, p_qty integer, p_witness uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  clinic uuid := app.clinic_id(); rx public.prescriptions%rowtype; b public.stock_batches%rowtype; m public.medicines%rowtype;
  done integer; new_id uuid;
begin
  perform app.assert_role('pharmacist');
  select * into rx from public.prescriptions where id = p_rx and clinic_id = clinic for update;
  if not found then raise exception 'Prescription not found.' using errcode = 'P0002'; end if;
  if rx.status <> 'active' then raise exception 'This prescription is %, not active.', rx.status using errcode = '55000'; end if;
  if rx.quantity is null or rx.medicine_id is null then raise exception 'This prescription has no medicine or quantity set.' using errcode = '55000'; end if;
  select * into b from public.stock_batches where id = p_batch and clinic_id = clinic for update;
  if not found then raise exception 'Batch not found.' using errcode = 'P0002'; end if;
  if b.status <> 'available' then raise exception 'Batch % is %. It cannot be dispensed.', b.batch_no, b.status using errcode = '55000'; end if;
  if b.expiry_date < current_date then raise exception 'Batch % expired on %.', b.batch_no, b.expiry_date using errcode = '55000'; end if;
  if p_qty > b.on_hand_qty then raise exception 'Only % in stock in batch %.', b.on_hand_qty, b.batch_no using errcode = '23514'; end if;
  select coalesce(sum(qty - returned_qty), 0) into done from public.dispensings where prescription_id = p_rx;
  if done + p_qty > rx.quantity then raise exception 'That would exceed the prescribed quantity (% already dispensed of %).', done, rx.quantity using errcode = '23514'; end if;
  if b.medicine_id <> rx.medicine_id and not exists (
       select 1 from public.substitutions s where s.prescription_id = p_rx and s.medicine_id = b.medicine_id and s.status = 'approved') then
    raise exception 'This batch is a different medicine. The prescriber must approve the substitution first.' using errcode = '55000';
  end if;
  select * into m from public.medicines where id = b.medicine_id;
  if m.controlled then
    if p_witness is null or p_witness = auth.uid() or not exists (
         select 1 from public.profiles w where w.id = p_witness and w.clinic_id = clinic and w.active and w.role in ('pharmacist', 'doctor', 'nurse')) then
      raise exception 'A controlled medicine needs a second, different staff member as witness.' using errcode = '42501';
    end if;
  end if;
  insert into public.dispensings (clinic_id, prescription_id, patient_id, medicine_id, batch_id, qty, dispensed_by, witness_id)
  values (clinic, p_rx, rx.patient_id, b.medicine_id, p_batch, p_qty, auth.uid(), case when m.controlled then p_witness end) returning dispensings.id into new_id;
  update public.stock_batches set on_hand_qty = on_hand_qty - p_qty where id = p_batch;
  insert into public.stock_movements (clinic_id, batch_id, kind, qty, reference_id, by_user) values (clinic, p_batch, 'dispense', -p_qty, new_id, auth.uid());
  if done + p_qty = rx.quantity then update public.prescriptions set status = 'dispensed' where id = p_rx; end if;
  return new_id;
end $$;

create or replace function public.request_return(p_dispensing uuid, p_qty integer, p_reason text, p_saleable boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); d public.dispensings%rowtype; pending integer; new_id uuid;
begin
  perform app.assert_role('pharmacist');
  select * into d from public.dispensings where id = p_dispensing and clinic_id = clinic for update;
  if not found then raise exception 'Dispensing not found.' using errcode = 'P0002'; end if;
  select coalesce(sum(qty), 0) into pending from public.stock_returns where dispensing_id = p_dispensing and status = 'pending';
  if p_qty > d.qty - d.returned_qty - pending then raise exception 'Only % can still be returned.', d.qty - d.returned_qty - pending using errcode = '23514'; end if;
  insert into public.stock_returns (clinic_id, dispensing_id, qty, reason, claimed_saleable, requested_by)
  values (clinic, p_dispensing, p_qty, trim(p_reason), p_saleable, auth.uid()) returning stock_returns.id into new_id;
  return new_id;
end $$;

-- Review by a different person. Saleable stock is restocked only if the batch is
-- still available and in date; anything else is disposed, never silently restocked.
create or replace function public.decide_return(p_return uuid, p_accept boolean, p_note text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); r public.stock_returns%rowtype; d public.dispensings%rowtype; b public.stock_batches%rowtype; outcome text;
begin
  perform app.assert_role('pharmacist', 'admin');
  select * into r from public.stock_returns where id = p_return and clinic_id = clinic for update;
  if not found then raise exception 'Return not found.' using errcode = 'P0002'; end if;
  if r.status <> 'pending' then raise exception 'Already decided.' using errcode = '55000'; end if;
  if r.requested_by = auth.uid() then raise exception 'A return must be reviewed by someone other than the person who requested it.' using errcode = '42501'; end if;
  select * into d from public.dispensings where id = r.dispensing_id for update;
  select * into b from public.stock_batches where id = d.batch_id for update;
  if not p_accept then
    if length(trim(coalesce(p_note, ''))) < 5 then raise exception 'Give a reason for rejecting the return.' using errcode = '23514'; end if;
    update public.stock_returns set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = trim(p_note) where id = p_return;
    return 'rejected';
  end if;
  update public.dispensings set returned_qty = returned_qty + r.qty where id = d.id;
  update public.prescriptions set status = 'active' where id = d.prescription_id and status = 'dispensed';
  if r.claimed_saleable and b.status = 'available' and b.expiry_date >= current_date then
    update public.stock_batches set on_hand_qty = on_hand_qty + r.qty where id = b.id;
    insert into public.stock_movements (clinic_id, batch_id, kind, qty, reference_id, by_user) values (clinic, b.id, 'return_restock', r.qty, r.id, auth.uid());
    outcome := 'restocked';
  else
    -- Not saleable: the units never re-enter stock, so no movement is written; the return record shows the disposal.
    outcome := 'disposed';
  end if;
  update public.stock_returns set status = outcome, decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '') where id = p_return;
  return outcome;
end $$;

create or replace function public.set_batch_status(p_batch uuid, p_status text, p_reason text)
returns integer language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); b public.stock_batches%rowtype; affected integer := 0; r record;
begin
  perform app.assert_role('pharmacist', 'admin');
  if p_status not in ('available', 'quarantined', 'recalled') then raise exception 'Unknown status.' using errcode = '22023'; end if;
  select * into b from public.stock_batches where id = p_batch and clinic_id = clinic for update;
  if not found then raise exception 'Batch not found.' using errcode = 'P0002'; end if;
  if b.status in ('recalled', 'disposed') then raise exception 'A % batch cannot change status.', b.status using errcode = '55000'; end if;
  if p_status <> 'available' and length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Give a reason.' using errcode = '23514'; end if;
  update public.stock_batches set status = p_status, status_reason = case when p_status = 'available' then null else trim(p_reason) end where id = p_batch;
  if p_status = 'recalled' then
    for r in select distinct p.prescriber_id, p.patient_id from public.dispensings d join public.prescriptions p on p.id = d.prescription_id where d.batch_id = p_batch loop
      perform app.notify(clinic, r.prescriber_id, 'recall', 'Recalled batch ' || b.batch_no || ' was dispensed to one of your patients', '/pharmacy/stock');
      affected := affected + 1;
    end loop;
  end if;
  return affected;
end $$;

create or replace function public.dispose_batch(p_batch uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); b public.stock_batches%rowtype;
begin
  perform app.assert_role('pharmacist', 'admin');
  select * into b from public.stock_batches where id = p_batch and clinic_id = clinic for update;
  if not found then raise exception 'Batch not found.' using errcode = 'P0002'; end if;
  if b.status = 'disposed' then raise exception 'Already disposed.' using errcode = '55000'; end if;
  if b.status = 'available' and b.expiry_date >= current_date then raise exception 'Only expired, quarantined or recalled stock is disposed.' using errcode = '55000'; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Give a reason.' using errcode = '23514'; end if;
  if b.on_hand_qty > 0 then
    insert into public.stock_movements (clinic_id, batch_id, kind, qty, reason, by_user) values (clinic, p_batch, 'disposal', -b.on_hand_qty, trim(p_reason), auth.uid());
  end if;
  update public.stock_batches set on_hand_qty = 0, status = 'disposed', status_reason = trim(p_reason) where id = p_batch;
end $$;

-- ---------------------------------------------------------------------------
alter table public.medicines enable row level security;
alter table public.stock_batches enable row level security;
alter table public.stock_movements enable row level security;
alter table public.dispensings enable row level security;
alter table public.substitutions enable row level security;
alter table public.stock_returns enable row level security;
revoke all on public.medicines, public.stock_batches, public.stock_movements, public.dispensings, public.substitutions, public.stock_returns from anon;
revoke insert, update, delete, truncate on public.medicines, public.stock_batches, public.stock_movements, public.dispensings, public.substitutions, public.stock_returns from authenticated;

create policy medicines_select on public.medicines for select to authenticated using (clinic_id = (select app.clinic_id()) and (select app.has_role('pharmacist', 'admin', 'doctor', 'nurse')));
create policy stock_batches_select on public.stock_batches for select to authenticated using (clinic_id = (select app.clinic_id()) and (select app.has_role('pharmacist', 'admin')));
create policy stock_movements_select on public.stock_movements for select to authenticated using (clinic_id = (select app.clinic_id()) and (select app.has_role('pharmacist', 'admin')));
create policy dispensings_select on public.dispensings for select to authenticated using (clinic_id = (select app.clinic_id()) and (select app.has_role('pharmacist', 'admin', 'doctor')));
create policy substitutions_select on public.substitutions for select to authenticated using (clinic_id = (select app.clinic_id()) and (select app.has_role('pharmacist', 'doctor')));
create policy stock_returns_select on public.stock_returns for select to authenticated using (clinic_id = (select app.clinic_id()) and (select app.has_role('pharmacist', 'admin')));

grant execute on function public.add_medicine(text, text, text, boolean), public.receive_stock(uuid, text, date, integer, text),
  public.prescribe(uuid, uuid, text, text, text, integer, integer), public.request_substitution(uuid, uuid, text), public.decide_substitution(uuid, boolean),
  public.dispense(uuid, uuid, integer, uuid), public.request_return(uuid, integer, text, boolean), public.decide_return(uuid, boolean, text),
  public.set_batch_status(uuid, text, text), public.dispose_batch(uuid, text) to authenticated;
revoke all on function public.add_medicine(text, text, text, boolean), public.receive_stock(uuid, text, date, integer, text),
  public.prescribe(uuid, uuid, text, text, text, integer, integer), public.request_substitution(uuid, uuid, text), public.decide_substitution(uuid, boolean),
  public.dispense(uuid, uuid, integer, uuid), public.request_return(uuid, integer, text, boolean), public.decide_return(uuid, boolean, text),
  public.set_batch_status(uuid, text, text), public.dispose_batch(uuid, text) from anon, public;
revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated;
