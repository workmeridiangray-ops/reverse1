-- Phase 3: tariffs, charge capture, deposits, interim/final bills from charges, refunds.
-- Money is bigint minor units. Tariff prices are SNAPSHOTTED onto each charge, so a
-- later tariff change never rewrites history. A clinical order is not a charge:
-- charges are captured deliberately by authorised staff.

create table public.tariff_versions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  name text not null check (length(trim(name)) between 1 and 100),
  effective_from date not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  activated_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (id, clinic_id)
);
create unique index tariff_one_active on public.tariff_versions (clinic_id) where status = 'active';

create table public.tariff_items (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  version_id uuid not null,
  code text not null check (code ~ '^[A-Z0-9_-]{1,20}$'),
  description text not null check (length(trim(description)) between 1 and 200),
  category text not null default 'service' check (category in ('bed', 'consultation', 'procedure', 'service', 'other')),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  unique (version_id, code),
  unique (id, clinic_id),
  foreign key (version_id, clinic_id) references public.tariff_versions (id, clinic_id)
);

create table public.charges (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  patient_id uuid not null,
  admission_id uuid,
  tariff_version_id uuid not null,
  item_code text not null,
  category text not null,
  description text not null,
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  quantity integer not null check (quantity between 1 and 10000),
  status text not null default 'captured' check (status in ('captured', 'billed', 'cancelled')),
  cancel_reason text,
  invoice_id uuid,
  captured_by uuid references public.profiles (id),
  captured_at timestamptz not null default now(),
  unique (id, clinic_id),
  foreign key (patient_id, clinic_id) references public.patients (id, clinic_id),
  foreign key (admission_id, clinic_id) references public.admissions (id, clinic_id),
  foreign key (tariff_version_id, clinic_id) references public.tariff_versions (id, clinic_id),
  foreign key (invoice_id, clinic_id) references public.invoices (id, clinic_id),
  check (status <> 'cancelled' or length(trim(coalesce(cancel_reason, ''))) >= 5),
  check ((status = 'billed') = (invoice_id is not null) or status = 'cancelled')
);
create index charges_admission_idx on public.charges (admission_id, status);
create index charges_patient_idx on public.charges (patient_id);

create table public.deposits (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  patient_id uuid not null,
  admission_id uuid,
  amount_minor bigint not null check (amount_minor > 0),
  applied_minor bigint not null default 0 check (applied_minor >= 0),
  refunded_minor bigint not null default 0 check (refunded_minor >= 0),
  method public.payment_method not null,
  reference text not null check (length(trim(reference)) between 1 and 100),
  received_by uuid references public.profiles (id),
  received_at timestamptz not null default now(),
  unique (id, clinic_id),
  foreign key (patient_id, clinic_id) references public.patients (id, clinic_id),
  foreign key (admission_id, clinic_id) references public.admissions (id, clinic_id),
  check (applied_minor + refunded_minor <= amount_minor)
);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  patient_id uuid not null,
  invoice_id uuid,
  deposit_id uuid,
  amount_minor bigint not null check (amount_minor > 0),
  reason text not null check (length(trim(reason)) >= 5),
  status text not null default 'requested' check (status in ('requested', 'approved', 'rejected')),
  requested_by uuid not null references public.profiles (id),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_reason text,
  unique (id, clinic_id),
  foreign key (patient_id, clinic_id) references public.patients (id, clinic_id),
  foreign key (invoice_id, clinic_id) references public.invoices (id, clinic_id),
  foreign key (deposit_id, clinic_id) references public.deposits (id, clinic_id),
  check ((invoice_id is null) <> (deposit_id is null)),
  check (status = 'requested' or (decided_by is not null and decided_at is not null)),
  check (status <> 'rejected' or length(trim(coalesce(decision_reason, ''))) >= 5),
  check (decided_by is null or decided_by <> requested_by)
);

do $$
declare t text;
begin
  foreach t in array array['tariff_versions','tariff_items','charges','deposits','refunds'] loop
    execute format('create trigger forbid_clinic_change before update on public.%I for each row execute function app.forbid_clinic_change()', t);
    execute format('create trigger audit_row after insert or update or delete on public.%I for each row execute function app.audit_row()', t);
  end loop;
end $$;

-- Workflow-only writes (same pattern as the inpatient module).
create trigger workflow_only before insert or update or delete on public.charges for each row execute function app.workflow_only();
create trigger workflow_only before insert or update or delete on public.deposits for each row execute function app.workflow_only();
create trigger workflow_only before insert or update or delete on public.refunds for each row execute function app.workflow_only();

-- Tariff items are editable only while their version is a draft; active/retired versions are history.
create or replace function app.tariff_item_guard()
returns trigger language plpgsql set search_path = '' as $$
declare st text;
begin
  select status into st from public.tariff_versions where id = coalesce(new.version_id, old.version_id);
  if st is distinct from 'draft' then
    raise exception 'Only a draft tariff can be edited. Create a new version to change prices.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end $$;
create trigger tariff_item_guard before insert or update or delete on public.tariff_items for each row execute function app.tariff_item_guard();

create or replace function app.tariff_version_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'Only a draft tariff can be deleted.' using errcode = '55000'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and app.is_direct_client() and (new.status is distinct from old.status or new.effective_from is distinct from old.effective_from and old.status <> 'draft') then
    raise exception 'Use activate to change a tariff''s status.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger tariff_version_guard before update or delete on public.tariff_versions for each row execute function app.tariff_version_guard();

-- Returning a billed charge to "captured" when its draft invoice is voided.
create or replace function app.release_charges_on_void()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.state = 'void' and old.state <> 'void' then
    update public.charges set status = 'captured', invoice_id = null where invoice_id = new.id and status = 'billed';
  end if;
  return null;
end $$;
create trigger release_charges_on_void after update on public.invoices for each row execute function app.release_charges_on_void();

-- ---------------------------------------------------------------------------
-- Workflow functions
-- ---------------------------------------------------------------------------
create or replace function public.activate_tariff(p_version uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); v public.tariff_versions%rowtype;
begin
  perform app.assert_role('admin');
  select * into v from public.tariff_versions where id = p_version and clinic_id = clinic for update;
  if not found then raise exception 'Tariff not found.' using errcode = 'P0002'; end if;
  if v.status <> 'draft' then raise exception 'Only a draft tariff can be activated.' using errcode = '55000'; end if;
  if not exists (select 1 from public.tariff_items where version_id = p_version) then
    raise exception 'Add at least one price before activating.' using errcode = '23514';
  end if;
  update public.tariff_versions set status = 'retired' where clinic_id = clinic and status = 'active';
  update public.tariff_versions set status = 'active', activated_at = now() where id = p_version;
end $$;

create or replace function public.capture_charge(p_patient uuid, p_admission uuid, p_code text, p_qty integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); v public.tariff_versions%rowtype; it public.tariff_items%rowtype; new_id uuid;
begin
  perform app.assert_role('admin', 'receptionist', 'nurse', 'doctor');
  select * into v from public.tariff_versions where clinic_id = clinic and status = 'active';
  if not found then raise exception 'There is no active tariff. Ask an administrator to activate one.' using errcode = '55000'; end if;
  select * into it from public.tariff_items where version_id = v.id and code = upper(trim(p_code));
  if not found then raise exception 'Unknown tariff code %.', p_code using errcode = 'P0002'; end if;
  if p_admission is not null and not exists (
      select 1 from public.admissions a where a.id = p_admission and a.clinic_id = clinic and a.patient_id = p_patient and a.status = 'admitted') then
    raise exception 'Charges can only be added to a patient who is currently admitted.' using errcode = '55000';
  end if;
  if not exists (select 1 from public.patients where id = p_patient and clinic_id = clinic) then
    raise exception 'Patient not found.' using errcode = 'P0002';
  end if;
  insert into public.charges (clinic_id, patient_id, admission_id, tariff_version_id, item_code, category, description, unit_price_minor, quantity, captured_by)
  values (clinic, p_patient, p_admission, v.id, it.code, it.category, it.description, it.unit_price_minor, p_qty, auth.uid())
  returning charges.id into new_id;
  return new_id;
end $$;

-- Idempotent: tops up bed-day charges to the admission's billed bed-days.
create or replace function public.capture_bed_days(p_admission uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  clinic uuid := app.clinic_id(); adm public.admissions%rowtype; v public.tariff_versions%rowtype; it public.tariff_items%rowtype;
  days integer; have integer; add_qty integer;
begin
  perform app.assert_role('admin', 'receptionist');
  select * into adm from public.admissions where id = p_admission and clinic_id = clinic;
  if not found then raise exception 'Admission not found.' using errcode = 'P0002'; end if;
  select * into v from public.tariff_versions where clinic_id = clinic and status = 'active';
  if not found then raise exception 'There is no active tariff.' using errcode = '55000'; end if;
  select * into it from public.tariff_items where version_id = v.id and category = 'bed' order by code limit 1;
  if not found then raise exception 'The active tariff has no bed-day price.' using errcode = '55000'; end if;
  days := public.billed_bed_days(p_admission);
  select coalesce(sum(quantity), 0) into have from public.charges where admission_id = p_admission and category = 'bed' and status <> 'cancelled';
  add_qty := days - have;
  if add_qty > 0 then
    insert into public.charges (clinic_id, patient_id, admission_id, tariff_version_id, item_code, category, description, unit_price_minor, quantity, captured_by)
    values (clinic, adm.patient_id, p_admission, v.id, it.code, it.category, it.description, it.unit_price_minor, add_qty, auth.uid());
  end if;
  return greatest(add_qty, 0);
end $$;

create or replace function public.cancel_charge(p_charge uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); c public.charges%rowtype;
begin
  perform app.assert_role('admin', 'receptionist');
  select * into c from public.charges where id = p_charge and clinic_id = clinic for update;
  if not found then raise exception 'Charge not found.' using errcode = 'P0002'; end if;
  if c.status <> 'captured' then
    raise exception 'Only a charge that has not been billed can be cancelled. For a billed charge, void the draft invoice or request a refund.' using errcode = '55000';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Give a reason for cancelling the charge.' using errcode = '23514'; end if;
  update public.charges set status = 'cancelled', cancel_reason = trim(p_reason) where id = p_charge;
end $$;

-- Turns un-billed charges into a DRAFT invoice for staff to review, then issue.
create or replace function public.generate_bill(p_patient uuid, p_admission uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); inv uuid; n integer;
begin
  perform app.assert_role('admin', 'receptionist');
  if not exists (select 1 from public.patients where id = p_patient and clinic_id = clinic) then
    raise exception 'Patient not found.' using errcode = 'P0002';
  end if;
  perform 1 from public.charges where clinic_id = clinic and patient_id = p_patient and status = 'captured'
    and admission_id is not distinct from p_admission for update;
  select count(*) into n from public.charges where clinic_id = clinic and patient_id = p_patient and status = 'captured'
    and admission_id is not distinct from p_admission;
  if n = 0 then raise exception 'There are no unbilled charges.' using errcode = '55000'; end if;
  insert into public.invoices (clinic_id, patient_id, currency)
  values (clinic, p_patient, (select currency from public.clinics where id = clinic)) returning id into inv;
  insert into public.invoice_lines (clinic_id, invoice_id, description, quantity, unit_price_minor)
  select clinic, inv, c.description, c.quantity, c.unit_price_minor from public.charges c
   where c.clinic_id = clinic and c.patient_id = p_patient and c.status = 'captured' and c.admission_id is not distinct from p_admission
   order by c.captured_at;
  update public.charges set status = 'billed', invoice_id = inv
   where clinic_id = clinic and patient_id = p_patient and status = 'captured' and admission_id is not distinct from p_admission;
  return inv;
end $$;

create or replace function public.record_deposit(p_patient uuid, p_admission uuid, p_amount bigint, p_method public.payment_method, p_reference text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); new_id uuid;
begin
  perform app.assert_role('admin', 'receptionist');
  if not exists (select 1 from public.patients where id = p_patient and clinic_id = clinic) then
    raise exception 'Patient not found.' using errcode = 'P0002';
  end if;
  insert into public.deposits (clinic_id, patient_id, admission_id, amount_minor, method, reference, received_by)
  values (clinic, p_patient, p_admission, p_amount, p_method, p_reference, auth.uid()) returning deposits.id into new_id;
  return new_id;
end $$;

-- Applies as much of a deposit as the invoice currently owes, as an ordinary payment.
create or replace function public.apply_deposit(p_deposit uuid, p_invoice uuid)
returns bigint language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); d public.deposits%rowtype; due bigint; amt bigint; inv public.invoices%rowtype;
begin
  perform app.assert_role('admin', 'receptionist');
  select * into d from public.deposits where id = p_deposit and clinic_id = clinic for update;
  if not found then raise exception 'Deposit not found.' using errcode = 'P0002'; end if;
  select * into inv from public.invoices where id = p_invoice and clinic_id = clinic for update;
  if not found then raise exception 'Invoice not found.' using errcode = 'P0002'; end if;
  if inv.patient_id <> d.patient_id then raise exception 'The deposit belongs to a different patient.' using errcode = '23514'; end if;
  if inv.state <> 'issued' then raise exception 'Issue the invoice before applying a deposit.' using errcode = '55000'; end if;
  select patient_due_now_minor into due from public.invoice_balances where invoice_id = p_invoice;
  amt := least(d.amount_minor - d.applied_minor - d.refunded_minor, due);
  if amt <= 0 then raise exception 'Nothing to apply: the deposit is used up or the invoice owes nothing now.' using errcode = '55000'; end if;
  insert into public.payments (clinic_id, invoice_id, amount_minor, method, reference)
  values (clinic, p_invoice, amt, d.method, 'Deposit ' || d.reference);
  update public.deposits set applied_minor = applied_minor + amt where id = p_deposit;
  return amt;
end $$;

-- Cash collected on an invoice, less approved refunds.
create or replace function app.invoice_net_collected(p_invoice uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(amount_minor) from public.payments where invoice_id = p_invoice), 0)
       - coalesce((select sum(amount_minor) from public.refunds where invoice_id = p_invoice and status = 'approved'), 0)
$$;

create or replace function public.request_refund(p_invoice uuid, p_deposit uuid, p_amount bigint, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); pid uuid; avail bigint; new_id uuid; pending bigint;
begin
  perform app.assert_role('admin', 'receptionist');
  if (p_invoice is null) = (p_deposit is null) then raise exception 'Refund either an invoice or a deposit.' using errcode = '22023'; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Give a reason for the refund.' using errcode = '23514'; end if;
  if p_invoice is not null then
    select patient_id into pid from public.invoices where id = p_invoice and clinic_id = clinic for update;
    if pid is null then raise exception 'Invoice not found.' using errcode = 'P0002'; end if;
    avail := app.invoice_net_collected(p_invoice);
    select coalesce(sum(amount_minor), 0) into pending from public.refunds where invoice_id = p_invoice and status = 'requested';
  else
    select patient_id, amount_minor - applied_minor - refunded_minor into pid, avail from public.deposits where id = p_deposit and clinic_id = clinic for update;
    if pid is null then raise exception 'Deposit not found.' using errcode = 'P0002'; end if;
    select coalesce(sum(amount_minor), 0) into pending from public.refunds where deposit_id = p_deposit and status = 'requested';
  end if;
  if p_amount > avail - pending then
    raise exception 'The refund is more than can be refunded (available % after pending requests).', avail - pending using errcode = '23514';
  end if;
  insert into public.refunds (clinic_id, patient_id, invoice_id, deposit_id, amount_minor, reason, requested_by)
  values (clinic, pid, p_invoice, p_deposit, p_amount, trim(p_reason), auth.uid()) returning refunds.id into new_id;
  return new_id;
end $$;

create or replace function public.decide_refund(p_refund uuid, p_approve boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); r public.refunds%rowtype; avail bigint;
begin
  perform app.assert_role('admin');
  select * into r from public.refunds where id = p_refund and clinic_id = clinic for update;
  if not found then raise exception 'Refund not found.' using errcode = 'P0002'; end if;
  if r.status <> 'requested' then raise exception 'This refund has already been decided.' using errcode = '55000'; end if;
  if r.requested_by = auth.uid() then raise exception 'A refund must be approved by someone other than the person who requested it.' using errcode = '42501'; end if;
  if not p_approve then
    if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Give a reason for rejecting the refund.' using errcode = '23514'; end if;
    update public.refunds set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_reason = trim(p_reason) where id = p_refund;
    return;
  end if;
  if r.invoice_id is not null then
    avail := app.invoice_net_collected(r.invoice_id);
  else
    select amount_minor - applied_minor - refunded_minor into avail from public.deposits where id = r.deposit_id for update;
  end if;
  if r.amount_minor > avail then raise exception 'The money is no longer available to refund.' using errcode = '23514'; end if;
  update public.refunds set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_reason = nullif(trim(p_reason), '') where id = p_refund;
  if r.deposit_id is not null then
    update public.deposits set refunded_minor = refunded_minor + r.amount_minor where id = r.deposit_id;
  end if;
end $$;

create or replace function public.create_tariff_draft(p_name text, p_effective date, p_copy_from uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); new_id uuid;
begin
  perform app.assert_role('admin');
  insert into public.tariff_versions (clinic_id, name, effective_from, created_by) values (clinic, p_name, p_effective, auth.uid()) returning tariff_versions.id into new_id;
  if p_copy_from is not null then
    insert into public.tariff_items (clinic_id, version_id, code, description, category, unit_price_minor)
    select clinic, new_id, code, description, category, unit_price_minor from public.tariff_items where version_id = p_copy_from and clinic_id = clinic;
  end if;
  return new_id;
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.tariff_versions enable row level security;
alter table public.tariff_items enable row level security;
alter table public.charges enable row level security;
alter table public.deposits enable row level security;
alter table public.refunds enable row level security;
revoke all on public.tariff_versions, public.tariff_items, public.charges, public.deposits, public.refunds from anon;
revoke truncate on public.tariff_versions, public.tariff_items, public.charges, public.deposits, public.refunds from authenticated;
revoke delete on public.charges, public.deposits, public.refunds from authenticated;

create policy tariff_versions_select on public.tariff_versions for select to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'receptionist', 'nurse', 'doctor')));
create policy tariff_versions_write on public.tariff_versions for update to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin'))) with check (clinic_id = (select app.clinic_id()));
create policy tariff_items_select on public.tariff_items for select to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'receptionist', 'nurse', 'doctor')));
create policy tariff_items_insert on public.tariff_items for insert to authenticated
  with check (clinic_id = (select app.clinic_id()) and (select app.has_role('admin')));
create policy tariff_items_update on public.tariff_items for update to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin'))) with check (clinic_id = (select app.clinic_id()));
create policy tariff_items_delete on public.tariff_items for delete to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin')));
create policy charges_select on public.charges for select to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'receptionist')));
create policy deposits_select on public.deposits for select to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'receptionist')));
create policy refunds_select on public.refunds for select to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'receptionist')));

grant execute on function public.activate_tariff(uuid), public.capture_charge(uuid, uuid, text, integer), public.capture_bed_days(uuid),
  public.cancel_charge(uuid, text), public.generate_bill(uuid, uuid), public.record_deposit(uuid, uuid, bigint, public.payment_method, text),
  public.apply_deposit(uuid, uuid), public.request_refund(uuid, uuid, bigint, text), public.decide_refund(uuid, boolean, text),
  public.create_tariff_draft(text, date, uuid) to authenticated;
revoke all on function public.activate_tariff(uuid), public.capture_charge(uuid, uuid, text, integer), public.capture_bed_days(uuid),
  public.cancel_charge(uuid, text), public.generate_bill(uuid, uuid), public.record_deposit(uuid, uuid, bigint, public.payment_method, text),
  public.apply_deposit(uuid, uuid), public.request_refund(uuid, uuid, bigint, text), public.decide_refund(uuid, boolean, text),
  public.create_tariff_draft(text, date, uuid) from anon, public;
revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then null; end if;
end $$;
