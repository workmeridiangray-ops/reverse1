-- Phase 3: pharmacy stock and batch dispensing, patient appointment requests,
-- de-identified analytics.
--
-- PARITY with lib/rules (proved by tests/db/*-parity.test.ts):
--   app.expires_mid_course / public.dispense_prescription  <->  lib/rules/dispensing.ts
--   MAX open requests (3)                                  <->  lib/rules/portal.ts
--   percentile_cont                                        <->  lib/rules/analytics.ts quantile()
-- CLINICAL PLACEHOLDER: pack sizes, controlled drugs and cold chain are not modelled.

-- ---------------------------------------------------------------------------
-- Stock
-- ---------------------------------------------------------------------------
create table public.stock_products (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  name text not null check (length(trim(name)) between 1 and 120),
  unit text not null default 'unit' check (length(trim(unit)) between 1 and 20),
  drug_classes text[] not null default '{}',
  reorder_level integer not null default 0 check (reorder_level >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, clinic_id),
  unique (clinic_id, name)
);

create table public.stock_batches (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  product_id uuid not null,
  batch_number text not null check (length(trim(batch_number)) between 1 and 40),
  -- last day the batch may be used, inclusive
  expiry_date date not null,
  quantity_received integer not null check (quantity_received > 0),
  -- Maintained ONLY by the stock ledger below, never edited directly.
  quantity_on_hand integer not null default 0 check (quantity_on_hand >= 0),
  status text not null default 'available' check (status in ('available', 'quarantined', 'recalled')),
  status_note text check (status_note is null or length(status_note) <= 200),
  supplier text check (supplier is null or length(supplier) <= 120),
  received_at timestamptz not null default now(),
  received_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, clinic_id),
  unique (product_id, batch_number),
  foreign key (product_id, clinic_id) references public.stock_products (id, clinic_id),
  foreign key (received_by, clinic_id) references public.profiles (id, clinic_id),
  check (status = 'available' or length(trim(coalesce(status_note, ''))) >= 3)
);
create index stock_batches_product_idx on public.stock_batches (product_id, expiry_date);

-- Append-only ledger: on-hand = sum of movements.
create table public.stock_movements (
  id bigint generated always as identity primary key,
  clinic_id uuid not null references public.clinics (id),
  batch_id uuid not null,
  delta integer not null check (delta <> 0),
  reason text not null check (reason in ('received', 'dispensed', 'adjustment', 'write_off')),
  dispense_id uuid,
  note text check (note is null or length(note) <= 200),
  created_by uuid,
  created_at timestamptz not null default now(),
  foreign key (batch_id, clinic_id) references public.stock_batches (id, clinic_id),
  check (case reason when 'received' then delta > 0 when 'dispensed' then delta < 0 when 'write_off' then delta < 0 else true end),
  check (reason not in ('adjustment', 'write_off') or length(trim(coalesce(note, ''))) >= 3)
);
create index stock_movements_batch_idx on public.stock_movements (batch_id, created_at);

-- ---------------------------------------------------------------------------
-- Dispensing records (immutable)
-- ---------------------------------------------------------------------------
create table public.dispenses (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  prescription_id uuid not null,
  patient_id uuid not null,
  product_id uuid not null,
  quantity integer not null check (quantity > 0),
  cover_days integer check (cover_days is null or cover_days >= 1),
  pharmacist_note text check (pharmacist_note is null or length(pharmacist_note) <= 500),
  mid_course boolean not null,
  fefo_skipped boolean not null,
  allergy_flagged boolean not null,
  dispensed_by uuid not null,
  dispensed_at timestamptz not null default now(),
  unique (id, clinic_id),
  unique (prescription_id),
  foreign key (prescription_id, clinic_id) references public.prescriptions (id, clinic_id),
  foreign key (patient_id, clinic_id) references public.patients (id, clinic_id),
  foreign key (product_id, clinic_id) references public.stock_products (id, clinic_id),
  foreign key (dispensed_by, clinic_id) references public.profiles (id, clinic_id),
  -- Any safety flag needs a real written note.
  check (not (mid_course or fefo_skipped or allergy_flagged) or length(trim(coalesce(pharmacist_note, ''))) >= 10)
);
create index dispenses_patient_idx on public.dispenses (patient_id, dispensed_at desc);

create table public.dispense_items (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  dispense_id uuid not null,
  batch_id uuid not null,
  quantity integer not null check (quantity > 0),
  batch_expiry date not null,
  mid_course boolean not null,
  unique (dispense_id, batch_id),
  foreign key (dispense_id, clinic_id) references public.dispenses (id, clinic_id),
  foreign key (batch_id, clinic_id) references public.stock_batches (id, clinic_id)
);
create index dispense_items_batch_idx on public.dispense_items (batch_id);

-- ---------------------------------------------------------------------------
-- Patient appointment requests
-- ---------------------------------------------------------------------------
create table public.appointment_requests (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  patient_id uuid not null,
  preferred text not null check (length(trim(preferred)) between 1 and 300),
  reason text not null check (length(trim(reason)) between 1 and 500),
  status text not null default 'open' check (status in ('open', 'booked', 'declined', 'cancelled')),
  appointment_id uuid,
  decline_reason text check (decline_reason is null or length(decline_reason) <= 200),
  handled_by uuid,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, clinic_id),
  foreign key (patient_id, clinic_id) references public.patients (id, clinic_id),
  foreign key (appointment_id, clinic_id) references public.appointments (id, clinic_id),
  foreign key (handled_by, clinic_id) references public.profiles (id, clinic_id),
  check ((status = 'booked') = (appointment_id is not null)),
  check ((status = 'declined') = (decline_reason is not null))
);
create index appointment_requests_open_idx on public.appointment_requests (clinic_id, created_at) where status = 'open';
create index appointment_requests_patient_idx on public.appointment_requests (patient_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------
-- Mirrors lib/rules/dispensing.ts expiresMidCourse(): in date on `start`, but
-- expires before the last day of the course (the dispensing day is day 1).
create or replace function app.expires_mid_course(p_expiry date, p_start date, p_cover integer)
returns boolean language sql immutable set search_path = '' as $$
  select p_cover is not null and p_cover >= 1 and p_expiry >= p_start and p_expiry < p_start + (p_cover - 1)
$$;

create or replace function app.clinic_today(p_clinic uuid)
returns date language sql stable security definer set search_path = '' as $$
  select (now() at time zone c.timezone)::date from public.clinics c where c.id = p_clinic
$$;

-- Batches: details are fixed once received; on-hand moves only through the ledger; recall is final.
create or replace function app.stock_batch_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r public.app_role := app.role();
begin
  if tg_op = 'INSERT' then
    if r is not null then
      if new.expiry_date < app.clinic_today(new.clinic_id) then
        raise exception 'That batch has already expired' using errcode = '23514';
      end if;
      new.status := 'available'; new.status_note := null;
    end if;
    new.quantity_on_hand := 0;
    new.received_by := coalesce(auth.uid(), new.received_by);
    new.received_at := now();
    return new;
  end if;
  if (new.product_id, new.batch_number, new.expiry_date, new.quantity_received, new.received_by, new.received_at, new.supplier)
     is distinct from (old.product_id, old.batch_number, old.expiry_date, old.quantity_received, old.received_by, old.received_at, old.supplier) then
    raise exception 'Batch details cannot be changed' using errcode = '42501';
  end if;
  if new.quantity_on_hand is distinct from old.quantity_on_hand and coalesce(current_setting('app.stock_internal', true), '') <> '1' then
    raise exception 'Stock levels change through stock movements only' using errcode = '42501';
  end if;
  if old.status = 'recalled' and new.status <> 'recalled' then
    raise exception 'A recalled batch cannot be released' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger stock_batch_rules before insert or update on public.stock_batches
  for each row execute function app.stock_batch_rules();

-- Receiving a batch writes its first ledger entry.
create or replace function app.stock_batch_received()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('app.stock_internal', '1', true);
  insert into public.stock_movements (clinic_id, batch_id, delta, reason, created_by)
  values (new.clinic_id, new.id, new.quantity_received, 'received', new.received_by);
  perform set_config('app.stock_internal', '', true);
  return null;
end $$;
create trigger stock_batch_received after insert on public.stock_batches
  for each row execute function app.stock_batch_received();

create or replace function app.stock_movement_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
declare b record;
begin
  new.created_by := coalesce(auth.uid(), new.created_by);
  if new.reason = 'received' and coalesce(current_setting('app.stock_internal', true), '') <> '1' then
    raise exception 'Stock is received by adding a batch' using errcode = '42501';
  end if;
  -- A dispensing movement must be backed by a dispense item for that batch and quantity.
  if new.reason = 'dispensed' and not exists (
       select 1 from public.dispense_items i where i.dispense_id = new.dispense_id and i.batch_id = new.batch_id and i.quantity = -new.delta) then
    raise exception 'A dispensing movement must match a dispense' using errcode = '42501';
  end if;
  select sb.quantity_on_hand into b from public.stock_batches sb where sb.id = new.batch_id and sb.clinic_id = new.clinic_id for update;
  if not found then raise exception 'Batch not found' using errcode = '23503'; end if;
  if b.quantity_on_hand + new.delta < 0 then
    raise exception 'Not enough stock in this batch' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger stock_movement_rules before insert on public.stock_movements
  for each row execute function app.stock_movement_rules();

create or replace function app.stock_movement_apply()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('app.stock_internal', '1', true);
  update public.stock_batches set quantity_on_hand = quantity_on_hand + new.delta where id = new.batch_id and clinic_id = new.clinic_id;
  perform set_config('app.stock_internal', '', true);
  return null;
end $$;
create trigger stock_movement_apply after insert on public.stock_movements
  for each row execute function app.stock_movement_apply();

create or replace function app.immutable_record()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '% records cannot be changed or deleted', tg_table_name using errcode = '42501';
end $$;
create trigger immutable_record before update or delete on public.stock_movements for each row execute function app.immutable_record();
create trigger immutable_record before update or delete on public.dispenses for each row execute function app.immutable_record();
create trigger immutable_record before update or delete on public.dispense_items for each row execute function app.immutable_record();

-- Appointment requests: a patient can ask or cancel; staff book or decline.
create or replace function app.appointment_request_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r public.app_role := app.role(); appt_patient uuid;
begin
  if tg_op = 'INSERT' then
    new.status := 'open'; new.appointment_id := null; new.decline_reason := null; new.handled_by := null; new.handled_at := null;
    -- Mirrors MAX_OPEN_REQUESTS in lib/rules/portal.ts.
    if r = 'patient' and (select count(*) from public.appointment_requests x where x.patient_id = new.patient_id and x.status = 'open') >= 3 then
      raise exception 'You already have 3 requests waiting' using errcode = '23514';
    end if;
    return new;
  end if;
  if (new.patient_id, new.preferred, new.reason, new.created_at) is distinct from (old.patient_id, old.preferred, old.reason, old.created_at) then
    raise exception 'A request cannot be edited' using errcode = '42501';
  end if;
  if new.status is not distinct from old.status then
    if r is not null and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
      raise exception 'Nothing to change on this request' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.status <> 'open' then raise exception 'This request is already closed' using errcode = '23514'; end if;
  if r = 'patient' and new.status <> 'cancelled' then raise exception 'You can only cancel a request' using errcode = '42501'; end if;
  if r in ('receptionist', 'admin') and new.status not in ('booked', 'declined') then
    raise exception 'Staff can book or decline a request' using errcode = '42501';
  end if;
  if new.status = 'booked' then
    if new.appointment_id is null then raise exception 'Choose the appointment that was booked' using errcode = '23514'; end if;
    select a.patient_id into appt_patient from public.appointments a where a.id = new.appointment_id;
    if appt_patient is distinct from new.patient_id then raise exception 'The appointment must be for the same patient' using errcode = '23514'; end if;
  end if;
  if new.status <> 'cancelled' then new.handled_by := coalesce(auth.uid(), new.handled_by); end if;
  new.handled_at := now();
  return new;
end $$;
create trigger appointment_request_rules before insert or update on public.appointment_requests
  for each row execute function app.appointment_request_rules();
create trigger set_updated_at before update on public.appointment_requests for each row execute function app.set_updated_at();
create trigger set_updated_at before update on public.stock_batches for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Dispensing: one atomic function. SECURITY INVOKER: RLS applies.
--   p_allocations: [{"batch_id": "...", "quantity": 30}, ...]
-- Refuses unsafe stock (expired, quarantined, recalled, over-drawn, wrong
-- product), and requires a written note whenever a safety flag applies:
--   mid_course   a batch expires before the course ends
--   fefo_skipped a later-expiry batch is used while an earlier one has stock
--   allergy      the patient has a recorded allergy to the medicine's class
-- ---------------------------------------------------------------------------
create or replace function public.dispense_prescription(
  p_prescription uuid, p_product uuid, p_allocations jsonb, p_cover_days integer, p_note text
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  clinic uuid := app.clinic_id();
  today date;
  rx record;
  prod record;
  a record;
  b record;
  total integer := 0;
  latest date;
  mid boolean; skipped boolean; allergy boolean;
  note text := trim(coalesce(p_note, ''));
  reasons text[] := '{}';
  d uuid;
begin
  if app.role() is distinct from 'pharmacist' then
    raise exception 'Only a pharmacist can dispense' using errcode = '42501';
  end if;
  today := app.clinic_today(clinic);

  select p.id, p.patient_id, p.status, p.drug_classes into rx from public.prescriptions p where p.id = p_prescription for update;
  if not found then raise exception 'Prescription not found' using errcode = 'P0002'; end if;
  if rx.status <> 'active' then raise exception 'This prescription is not active' using errcode = '23514'; end if;

  select * into prod from public.stock_products where id = p_product and active;
  if not found then raise exception 'That product is not available' using errcode = '23514'; end if;
  if cardinality(rx.drug_classes) > 0 and cardinality(prod.drug_classes) > 0 and not (rx.drug_classes && prod.drug_classes) then
    raise exception 'This product does not match the prescribed medicine' using errcode = '23514';
  end if;

  if jsonb_typeof(p_allocations) is distinct from 'array' or jsonb_array_length(p_allocations) = 0 then
    raise exception 'Choose at least one batch' using errcode = '23514';
  end if;
  if (select count(distinct (e ->> 'batch_id')) from jsonb_array_elements(p_allocations) e) <> jsonb_array_length(p_allocations) then
    raise exception 'A batch is listed twice' using errcode = '23514';
  end if;

  -- Lock the batches in a stable order, then check each one.
  perform 1 from public.stock_batches sb
   where sb.id in (select (e ->> 'batch_id')::uuid from jsonb_array_elements(p_allocations) e) order by sb.id for update;
  for a in select (e ->> 'batch_id')::uuid as batch_id, (e ->> 'quantity')::integer as qty from jsonb_array_elements(p_allocations) e loop
    if a.qty is null or a.qty <= 0 then raise exception 'Quantities must be positive whole numbers' using errcode = '23514'; end if;
    select * into b from public.stock_batches where id = a.batch_id and product_id = p_product;
    if not found then raise exception 'A chosen batch is not stock of this medicine' using errcode = '23514'; end if;
    if b.status = 'recalled' then raise exception 'Batch % has been recalled', b.batch_number using errcode = '23514'; end if;
    if b.status = 'quarantined' then raise exception 'Batch % is quarantined', b.batch_number using errcode = '23514'; end if;
    if b.expiry_date < today then raise exception 'Batch % has expired', b.batch_number using errcode = '23514'; end if;
    if a.qty > b.quantity_on_hand then raise exception 'Only % left in batch %', b.quantity_on_hand, b.batch_number using errcode = '23514'; end if;
    total := total + a.qty;
  end loop;

  with al as (select (e ->> 'batch_id')::uuid as batch_id, (e ->> 'quantity')::integer as qty from jsonb_array_elements(p_allocations) e)
  select max(sb.expiry_date), coalesce(bool_or(app.expires_mid_course(sb.expiry_date, today, p_cover_days)), false)
    into latest, mid from al join public.stock_batches sb on sb.id = al.batch_id;

  with al as (select (e ->> 'batch_id')::uuid as batch_id, (e ->> 'quantity')::integer as qty from jsonb_array_elements(p_allocations) e)
  select exists (
    select 1 from public.stock_batches b2
     where b2.product_id = p_product and b2.status = 'available' and b2.expiry_date >= today and b2.expiry_date < latest
       and b2.quantity_on_hand - coalesce((select sum(al.qty) from al where al.batch_id = b2.id), 0) > 0) into skipped;

  select exists (
    select 1 from public.patient_allergies pa
     where pa.patient_id = rx.patient_id and pa.kind = 'allergy' and pa.removed_at is null
       and pa.allergen_class = any (rx.drug_classes || prod.drug_classes)) into allergy;

  if mid then reasons := reasons || 'a batch expires before the course ends'::text; end if;
  if skipped then reasons := reasons || 'an earlier-expiry batch was skipped'::text; end if;
  if allergy then reasons := reasons || 'the patient has a recorded allergy to this medicine''s class'::text; end if;
  if cardinality(reasons) > 0 and length(note) < 10 then
    raise exception 'A written note (at least 10 characters) is required because %', array_to_string(reasons, ' and ') using errcode = '23514';
  end if;

  insert into public.dispenses (clinic_id, prescription_id, patient_id, product_id, quantity, cover_days, pharmacist_note, mid_course, fefo_skipped, allergy_flagged, dispensed_by)
  values (clinic, p_prescription, rx.patient_id, p_product, total, p_cover_days, nullif(note, ''), mid, skipped, allergy, auth.uid())
  returning id into d;

  for a in select (e ->> 'batch_id')::uuid as batch_id, (e ->> 'quantity')::integer as qty from jsonb_array_elements(p_allocations) e loop
    insert into public.dispense_items (clinic_id, dispense_id, batch_id, quantity, batch_expiry, mid_course)
    select clinic, d, sb.id, a.qty, sb.expiry_date, app.expires_mid_course(sb.expiry_date, today, p_cover_days)
      from public.stock_batches sb where sb.id = a.batch_id;
    insert into public.stock_movements (clinic_id, batch_id, delta, reason, dispense_id) values (clinic, a.batch_id, -a.qty, 'dispensed', d);
  end loop;

  update public.prescriptions set status = 'dispensed' where id = p_prescription;
  return d;
end $$;

-- Write off or correct stock with a recorded reason.
create or replace function public.adjust_stock(p_batch uuid, p_delta integer, p_reason text, p_note text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if app.role() is distinct from 'pharmacist' then raise exception 'Only a pharmacist can adjust stock' using errcode = '42501'; end if;
  if p_reason not in ('adjustment', 'write_off') then raise exception 'Unknown reason' using errcode = '23514'; end if;
  insert into public.stock_movements (clinic_id, batch_id, delta, reason, note)
  values (app.clinic_id(), p_batch, p_delta, p_reason, p_note);
end $$;

-- ---------------------------------------------------------------------------
-- Patient self-service: contact details and reminder consent only.
-- ---------------------------------------------------------------------------
create or replace function public.update_my_details(p_phone text, p_email text, p_address text, p_communication boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare pid uuid := app.patient_id();
begin
  if pid is null then raise exception 'Not a patient account' using errcode = '42501'; end if;
  if nullif(trim(p_phone), '') is not null and trim(p_phone) !~ '^\+?[0-9 ()\-]{6,20}$' then
    raise exception 'Enter a valid phone number' using errcode = '23514'; end if;
  if nullif(trim(p_email), '') is not null and trim(p_email) !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'Enter a valid email address' using errcode = '23514'; end if;
  if length(coalesce(p_address, '')) > 300 then raise exception 'Address is too long' using errcode = '23514'; end if;
  update public.patients
     set phone = nullif(trim(p_phone), ''), email = nullif(trim(p_email), ''), address = nullif(trim(p_address), ''),
         consent_communication = coalesce(p_communication, consent_communication)
   where id = pid;
end $$;

-- ---------------------------------------------------------------------------
-- Analytics for administrators: durations only, no patient information.
-- Admins cannot read lab records (minimum necessary), so lab turnaround and
-- critical-result timings come through this function as bare numbers.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_lab_durations(p_from timestamptz, p_to timestamptz)
returns table (kind text, minutes numeric) language plpgsql stable security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id();
begin
  if app.role() is distinct from 'admin' then raise exception 'Administrators only' using errcode = '42501'; end if;
  return query
    select 'lab_turnaround'::text, (extract(epoch from (x.done - x.ordered_at)) / 60.0)::numeric
      from (select o.ordered_at, max(r.entered_at) as done from public.lab_orders o
              join public.lab_results r on r.order_id = o.id
             where o.clinic_id = clinic and o.status = 'resulted' and o.ordered_at >= p_from and o.ordered_at < p_to
             group by o.id, o.ordered_at) x
     where x.done is not null
    union all
    select 'critical_acknowledged'::text, (extract(epoch from (r.acknowledged_at - r.entered_at)) / 60.0)::numeric
      from public.lab_results r
     where r.clinic_id = clinic and r.flag in ('critical_low', 'critical_high') and r.acknowledged_at is not null
       and r.entered_at >= p_from and r.entered_at < p_to
    union all
    select 'critical_open'::text, (extract(epoch from (now() - r.entered_at)) / 60.0)::numeric
      from public.lab_results r
     where r.clinic_id = clinic and r.flag in ('critical_low', 'critical_high') and r.acknowledged_at is null and r.entered_at is not null
    limit 20000;
end $$;

-- ---------------------------------------------------------------------------
-- Housekeeping
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['stock_products', 'stock_batches', 'stock_movements', 'dispenses', 'dispense_items', 'appointment_requests']
  loop
    execute format('create trigger forbid_clinic_change before update on public.%I for each row execute function app.forbid_clinic_change()', t);
  end loop;
  foreach t in array array['stock_products', 'stock_batches', 'dispenses', 'appointment_requests']
  loop
    execute format('create trigger audit_row after insert or update or delete on public.%I for each row execute function app.audit_row()', t);
  end loop;
end $$;
