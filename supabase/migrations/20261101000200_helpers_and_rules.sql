-- Helpers used by RLS policies, and database-side business rules.
--
-- PARITY: functions marked "mirrors lib/rules/..." must stay in lock-step with
-- the TypeScript modules. tests/db/*-parity.test.ts proves they agree.

-- ---------------------------------------------------------------------------
-- Identity helpers (SECURITY DEFINER so policies can read profiles without
-- recursing into profiles' own RLS). Inactive staff resolve to NULL = no access.
-- ---------------------------------------------------------------------------
create or replace function app.clinic_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select p.clinic_id from public.profiles p where p.id = auth.uid() and p.active
$$;

create or replace function app.role()
returns public.app_role language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.active
$$;

create or replace function app.has_role(variadic roles public.app_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(app.role() = any (roles), false)
$$;

-- The patient record linked to the signed-in portal user, if any.
create or replace function app.patient_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select pt.id
  from public.patients pt
  join public.profiles p on p.id = pt.auth_user_id and p.clinic_id = pt.clinic_id
  where pt.auth_user_id = auth.uid() and p.active and p.role = 'patient' and pt.archived_at is null
$$;

-- ---------------------------------------------------------------------------
-- Generic triggers
-- ---------------------------------------------------------------------------
create or replace function app.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- A row can never move to another clinic.
create or replace function app.forbid_clinic_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.clinic_id is distinct from old.clinic_id then
    raise exception 'clinic_id cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'patients', 'rooms', 'appointments', 'consultations', 'prescriptions', 'invoices']
  loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function app.set_updated_at()', t);
  end loop;
  foreach t in array array['profiles', 'patients', 'rooms', 'appointments', 'consultations', 'prescriptions', 'invoices', 'invoice_lines', 'payments']
  loop
    execute format('create trigger forbid_clinic_change before update on public.%I for each row execute function app.forbid_clinic_change()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Human-readable numbers (MRN, invoice number), gap-free per clinic.
-- ---------------------------------------------------------------------------
alter table app.clinic_counters rename column next_mrn to last_mrn;
alter table app.clinic_counters rename column next_invoice to last_invoice;
alter table app.clinic_counters alter column last_mrn set default 0;
alter table app.clinic_counters alter column last_invoice set default 0;

create or replace function app.assign_mrn()
returns trigger language plpgsql security definer set search_path = '' as $$
declare n bigint;
begin
  insert into app.clinic_counters as c (clinic_id, last_mrn) values (new.clinic_id, 1)
  on conflict (clinic_id) do update set last_mrn = c.last_mrn + 1
  returning c.last_mrn into n;
  new.mrn := 'P' || lpad(n::text, 6, '0');
  return new;
end $$;
create trigger assign_mrn before insert on public.patients for each row execute function app.assign_mrn();

-- ---------------------------------------------------------------------------
-- Appointments
-- ---------------------------------------------------------------------------
-- Mirrors lib/rules/appointment-status.ts TRANSITIONS.
create or replace function app.appointment_transition_allowed(
  from_s public.appointment_status, to_s public.appointment_status
) returns boolean language sql immutable set search_path = '' as $$
  select from_s = to_s or case from_s
    when 'scheduled' then to_s in ('arrived', 'cancelled', 'no_show')
    when 'arrived'   then to_s in ('in_room', 'scheduled', 'cancelled')
    when 'in_room'   then to_s in ('completed', 'arrived')
    when 'no_show'   then to_s = 'scheduled'
    else false
  end
$$;

create or replace function app.appointment_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- The booked clinician must be an active doctor of the same clinic.
  if tg_op = 'INSERT' or new.doctor_id is distinct from old.doctor_id then
    perform 1 from public.profiles p
      where p.id = new.doctor_id and p.clinic_id = new.clinic_id and p.role = 'doctor' and p.active;
    if not found then
      raise exception 'Appointments must be booked with an active doctor' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'scheduled' then
      raise exception 'New appointments start as scheduled' using errcode = '23514';
    end if;
    new.created_by := coalesce(auth.uid(), new.created_by);
    return new;
  end if;

  -- Doctors may move their own appointments through the visit, not reschedule them.
  if app.role() = 'doctor' and (new.patient_id, new.doctor_id, new.room_id, new.starts_at, new.ends_at, new.reason)
      is distinct from (old.patient_id, old.doctor_id, old.room_id, old.starts_at, old.ends_at, old.reason) then
    raise exception 'Doctors can update visit status only' using errcode = '42501';
  end if;

  if not app.appointment_transition_allowed(old.status, new.status) then
    raise exception 'Cannot change appointment from % to %', old.status, new.status using errcode = '23514';
  end if;

  if new.status is distinct from old.status then
    case new.status
      when 'arrived' then
        if old.status = 'scheduled' then
          new.checked_in_at := now();
          new.checked_in_by := auth.uid();
        end if;
        new.roomed_at := null;
      when 'scheduled' then
        new.checked_in_at := null;
        new.checked_in_by := null;
      when 'in_room' then
        new.roomed_at := now();
      when 'completed' then
        new.completed_at := now();
      when 'cancelled' then
        if coalesce(trim(new.cancelled_reason), '') = '' then
          raise exception 'Give a reason for cancelling' using errcode = '23514';
        end if;
      else null;
    end case;
  end if;
  return new;
end $$;
create trigger appointment_rules before insert or update on public.appointments
  for each row execute function app.appointment_rules();

-- ---------------------------------------------------------------------------
-- Consultations: author-only, locked once signed.
-- ---------------------------------------------------------------------------
create or replace function app.consultation_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
declare appt record;
begin
  if new.appointment_id is not null then
    select a.patient_id, a.doctor_id into appt from public.appointments a where a.id = new.appointment_id;
    if appt.patient_id is distinct from new.patient_id then
      raise exception 'Consultation patient must match the appointment' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'UPDATE' and old.signed_at is not null then
    -- After signing only the critical flag can change (e.g. resolved). Corrections are addenda (later phase).
    if (new.subjective, new.objective, new.assessment, new.plan, new.signed_at, new.signed_by,
        new.patient_id, new.doctor_id, new.appointment_id)
       is distinct from
       (old.subjective, old.objective, old.assessment, old.plan, old.signed_at, old.signed_by,
        old.patient_id, old.doctor_id, old.appointment_id) then
      raise exception 'Signed notes cannot be edited' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.signed_at is not null and (tg_op = 'INSERT' or old.signed_at is null) then
    if auth.uid() is not null and auth.uid() <> new.doctor_id then
      raise exception 'Only the authoring doctor can sign this note' using errcode = '42501';
    end if;
    if trim(new.assessment) = '' and trim(new.plan) = '' then
      raise exception 'Add an assessment or plan before signing' using errcode = '23514';
    end if;
    new.signed_at := case when auth.uid() is null then new.signed_at else now() end;
    new.signed_by := coalesce(auth.uid(), new.signed_by, new.doctor_id);
  end if;
  return new;
end $$;
create trigger consultation_rules before insert or update on public.consultations
  for each row execute function app.consultation_rules();

-- Pharmacists may only mark an active prescription dispensed.
create or replace function app.prescription_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and app.role() = 'pharmacist' then
    if not (old.status = 'active' and new.status = 'dispensed')
       or (to_jsonb(new) - 'status' - 'updated_at') is distinct from (to_jsonb(old) - 'status' - 'updated_at') then
      raise exception 'Pharmacists can only mark active prescriptions dispensed' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger prescription_rules before update on public.prescriptions
  for each row execute function app.prescription_rules();

-- ---------------------------------------------------------------------------
-- Billing
-- ---------------------------------------------------------------------------
-- Mirrors lib/rules/invoice.ts paymentStatus(). Keep in lock-step.
create or replace function app.invoice_payment_status(
  p_state public.invoice_state,
  p_total bigint,
  p_patient_paid bigint,
  p_insurance public.insurance_status,
  p_claimed bigint
) returns text language plpgsql immutable set search_path = '' as $$
declare
  claimed bigint := case when p_insurance = 'none' then 0 else p_claimed end;
  closed bigint;
  due bigint;
begin
  if p_state = 'void' then return 'void'; end if;
  if p_state = 'draft' then return 'draft'; end if;

  if p_insurance = 'pending' then
    if p_patient_paid > p_total then return 'overpaid'; end if;
    if p_patient_paid >= p_total - claimed then return 'awaiting_insurance'; end if;
    return case when p_patient_paid > 0 then 'partially_paid' else 'unpaid' end;
  end if;

  closed := case when p_insurance = 'settled' then claimed else 0 end;
  due := p_total - p_patient_paid - closed;
  if due < 0 then return 'overpaid'; end if;
  if due = 0 then return 'paid'; end if;
  return case when p_patient_paid > 0 or closed > 0 then 'partially_paid' else 'unpaid' end;
end $$;

-- Mirrors lib/rules/invoice.ts summarizeInvoice(). security_invoker => RLS applies.
create view public.invoice_balances with (security_invoker = true) as
select
  i.id as invoice_id,
  i.clinic_id,
  i.patient_id,
  i.appointment_id,
  i.number,
  i.currency,
  i.state,
  i.insurance_status,
  i.issued_at,
  i.created_at,
  f.total_minor,
  f.patient_paid_minor,
  f.claimed_minor as insurance_claimed_minor,
  case when i.insurance_status = 'settled' then i.insurance_paid_minor else 0 end::bigint as insurance_paid_minor,
  case when i.insurance_status = 'settled' then f.claimed_minor - i.insurance_paid_minor else 0 end::bigint
    as insurance_adjustment_minor,
  f.responsibility_minor as patient_responsibility_minor,
  case when i.state = 'issued'
    then case when i.insurance_status = 'settled'
      then f.total_minor - f.claimed_minor - f.patient_paid_minor
      else f.total_minor - f.patient_paid_minor end
    else 0 end::bigint as balance_due_minor,
  case when i.state = 'issued' then greatest(0, f.responsibility_minor - f.patient_paid_minor) else 0 end::bigint
    as patient_due_now_minor,
  app.invoice_payment_status(i.state, f.total_minor, f.patient_paid_minor, i.insurance_status, f.claimed_minor)
    as payment_status
from public.invoices i
cross join lateral (
  select
    t.total_minor,
    p.patient_paid_minor,
    c.claimed_minor,
    case when i.insurance_status in ('pending', 'settled') then t.total_minor - c.claimed_minor else t.total_minor end
      as responsibility_minor
  from
    (select coalesce(sum(l.quantity::bigint * l.unit_price_minor), 0)::bigint as total_minor
       from public.invoice_lines l where l.invoice_id = i.id) t,
    (select coalesce(sum(pm.amount_minor), 0)::bigint as patient_paid_minor
       from public.payments pm where pm.invoice_id = i.id) p,
    (select case when i.insurance_status = 'none' then 0 else i.insurance_claimed_minor end::bigint as claimed_minor) c
) f;

-- Totals for trigger checks, bypassing RLS (called only from triggers).
create or replace function app.invoice_total(p_invoice uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(l.quantity::bigint * l.unit_price_minor), 0)::bigint
  from public.invoice_lines l where l.invoice_id = p_invoice
$$;

create or replace function app.invoice_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  n bigint;
  total bigint;
  has_payments boolean;
begin
  if tg_op = 'INSERT' then
    if new.state <> 'draft' then
      raise exception 'New invoices start as draft' using errcode = '23514';
    end if;
    if new.currency is null then
      select c.currency into new.currency from public.clinics c where c.id = new.clinic_id;
    end if;
    insert into app.clinic_counters as c (clinic_id, last_invoice) values (new.clinic_id, 1)
    on conflict (clinic_id) do update set last_invoice = c.last_invoice + 1
    returning c.last_invoice into n;
    new.number := 'INV-' || lpad(n::text, 6, '0');
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.issued_at := null;
    new.voided_at := null;
  else
    -- State machine: draft -> issued -> void, draft -> void.
    if new.state is distinct from old.state then
      if old.state = 'void' or (old.state = 'issued' and new.state = 'draft') then
        raise exception 'Cannot change invoice from % to %', old.state, new.state using errcode = '23514';
      end if;
      if new.state = 'issued' then
        new.issued_at := now();
      elsif new.state = 'void' then
        select exists (select 1 from public.payments p where p.invoice_id = new.id) into has_payments;
        if has_payments then
          raise exception 'Invoices with payments cannot be voided' using errcode = '23514';
        end if;
        if coalesce(trim(new.void_reason), '') = '' then
          raise exception 'Give a reason for voiding' using errcode = '23514';
        end if;
        new.voided_at := now();
      end if;
    else
      new.issued_at := old.issued_at;
      new.voided_at := old.voided_at;
    end if;
    if old.state = 'void' and new is distinct from old then
      raise exception 'Void invoices cannot be changed' using errcode = '23514';
    end if;
    if old.state = 'issued' and (new.patient_id, new.currency, new.appointment_id, new.number)
        is distinct from (old.patient_id, old.currency, old.appointment_id, old.number) then
      raise exception 'Issued invoices cannot be re-addressed' using errcode = '23514';
    end if;
    new.number := old.number;
  end if;

  -- Insurance normalisation. Mirrors lib/rules/invoice.ts.
  if new.insurance_status = 'none' then
    new.insurance_claimed_minor := 0;
    new.insurance_paid_minor := 0;
    new.insurer_name := null;
    new.insurance_settled_at := null;
  elsif new.insurance_status = 'settled' then
    new.insurance_settled_at := coalesce(new.insurance_settled_at, now());
  else
    new.insurance_paid_minor := 0;
    new.insurance_settled_at := null;
  end if;

  if tg_op = 'UPDATE' then
    total := app.invoice_total(new.id);
    if new.insurance_claimed_minor > total then
      raise exception 'Insurance claim cannot exceed the invoice total' using errcode = '23514';
    end if;
  elsif new.insurance_claimed_minor > 0 then
    raise exception 'Insurance claim cannot exceed the invoice total' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger invoice_rules before insert or update on public.invoices
  for each row execute function app.invoice_rules();

-- Lines may only change while the invoice is a draft.
create or replace function app.invoice_line_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
declare st public.invoice_state;
begin
  select i.state into st from public.invoices i where i.id = coalesce(new.invoice_id, old.invoice_id);
  if st is distinct from 'draft' and not (tg_op = 'DELETE' and st is null) then
    raise exception 'Invoice lines can only change while the invoice is a draft' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.invoice_id <> old.invoice_id then
    raise exception 'Lines cannot move between invoices' using errcode = '23514';
  end if;
  return coalesce(new, old);
end $$;
create trigger invoice_line_rules before insert or update or delete on public.invoice_lines
  for each row execute function app.invoice_line_rules();

-- Payments: only on issued invoices, never more than the patient owes now,
-- and immutable once written (refunds are a later phase).
create or replace function app.payment_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
declare b record;
begin
  if tg_op <> 'INSERT' then
    raise exception 'Payments cannot be changed or deleted' using errcode = '42501';
  end if;
  -- Serialise concurrent payments on the same invoice.
  perform 1 from public.invoices i where i.id = new.invoice_id for update;
  select ib.state, ib.patient_due_now_minor into b from public.invoice_balances ib where ib.invoice_id = new.invoice_id;
  if b.state is distinct from 'issued' then
    raise exception 'Payments can only be recorded on issued invoices' using errcode = '23514';
  end if;
  if new.amount_minor > b.patient_due_now_minor then
    raise exception 'Payment is more than the patient currently owes' using errcode = '23514';
  end if;
  new.received_by := coalesce(auth.uid(), new.received_by);
  return new;
end $$;
create trigger payment_rules before insert or update or delete on public.payments
  for each row execute function app.payment_rules();
