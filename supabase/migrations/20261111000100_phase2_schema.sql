-- Phase 2: allergies, allergy-checked prescribing, laboratory.
--
-- PARITY with lib/rules (proved by tests/db/*-parity.test.ts):
--   app.prescription_allergy_rules  <->  lib/rules/allergy.ts (direct match + stored status)
--   app.age_years / pick_reference_range / flag_value  <->  lib/rules/lab-flags.ts
--   app.lab_order_transition_allowed  <->  lib/rules/lab-orders.ts
--
-- CLINICAL PLACEHOLDER: reference ranges and drug classes are DATA a clinician
-- must review. Ranges carry reviewed_at / reviewed_by_name; results show when
-- they were flagged from an unreviewed range.

-- ---------------------------------------------------------------------------
-- Allergies
-- ---------------------------------------------------------------------------
create type public.allergy_severity as enum ('mild', 'moderate', 'severe');

create table public.patient_allergies (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  patient_id uuid not null,
  -- 'nkda' = a clinician confirmed "no known drug allergies". Absence of any
  -- row means "not recorded", which is different and is reported as such.
  kind text not null check (kind in ('allergy', 'nkda')),
  allergen text check (allergen is null or length(trim(allergen)) between 1 and 120),
  allergen_class text,
  severity public.allergy_severity,
  reaction text check (reaction is null or length(reaction) <= 200),
  recorded_by uuid,
  recorded_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid,
  removed_reason text check (removed_reason is null or length(removed_reason) <= 200),
  created_at timestamptz not null default now(),
  unique (id, clinic_id),
  foreign key (patient_id, clinic_id) references public.patients (id, clinic_id),
  foreign key (recorded_by, clinic_id) references public.profiles (id, clinic_id),
  foreign key (removed_by, clinic_id) references public.profiles (id, clinic_id),
  check ((kind = 'allergy') = (allergen is not null and severity is not null)),
  check (kind = 'allergy' or (allergen_class is null and reaction is null)),
  check (removed_at is null or length(trim(coalesce(removed_reason, ''))) >= 3)
);
create index patient_allergies_patient_idx on public.patient_allergies (patient_id) where removed_at is null;
create unique index patient_allergies_one_nkda on public.patient_allergies (patient_id) where kind = 'nkda' and removed_at is null;

create or replace function app.patient_allergy_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.recorded_by := coalesce(auth.uid(), new.recorded_by);
    new.recorded_at := now();
    new.removed_at := null; new.removed_by := null; new.removed_reason := null;
    if new.kind = 'nkda' and exists (
      select 1 from public.patient_allergies a
      where a.patient_id = new.patient_id and a.kind = 'allergy' and a.removed_at is null) then
      raise exception 'Remove the recorded allergies before confirming no known allergies' using errcode = '23514';
    end if;
    return new;
  end if;
  -- An allergy entry is a clinical record: it can be removed (with a reason), never edited.
  if old.removed_at is not null then
    raise exception 'Removed entries cannot be changed' using errcode = '42501';
  end if;
  if (to_jsonb(new) - 'removed_at' - 'removed_by' - 'removed_reason')
     is distinct from (to_jsonb(old) - 'removed_at' - 'removed_by' - 'removed_reason') then
    raise exception 'Allergy entries cannot be edited: remove it and add a new one' using errcode = '42501';
  end if;
  if new.removed_at is not null then
    new.removed_at := now();
    new.removed_by := coalesce(auth.uid(), new.removed_by);
  end if;
  return new;
end $$;
create trigger patient_allergy_rules before insert or update on public.patient_allergies
  for each row execute function app.patient_allergy_rules();

-- Recording a real allergy supersedes an earlier "no known allergies" entry.
create or replace function app.patient_allergy_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'allergy' and new.removed_at is null then
    update public.patient_allergies
       set removed_at = now(), removed_by = new.recorded_by, removed_reason = 'Allergy recorded'
     where patient_id = new.patient_id and kind = 'nkda' and removed_at is null;
  end if;
  return null;
end $$;
create trigger patient_allergy_after after insert on public.patient_allergies
  for each row execute function app.patient_allergy_after();

-- ---------------------------------------------------------------------------
-- Prescriptions: class-based allergy enforcement
-- ---------------------------------------------------------------------------
alter table public.prescriptions
  add column drug_classes text[] not null default '{}',
  add column allergy_check_status text not null default 'unchecked'
    check (allergy_check_status in ('clear', 'overridden', 'unchecked', 'no_allergy_record')),
  add constraint prescriptions_override_reason_len check (allergy_override_reason is null or length(allergy_override_reason) <= 500);

-- Mirrors lib/rules/allergy.ts: a DIRECT class match needs a written reason
-- (>= 10 characters) -- warn-and-justify, never a hard block. The stored
-- status is computed here so a client cannot claim "clear".
create or replace function app.prescription_allergy_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  conflict boolean;
  has_any boolean;
  reason text := trim(coalesce(new.allergy_override_reason, ''));
begin
  if tg_op = 'UPDATE'
     and (new.patient_id, new.drug_classes, new.allergy_override_reason)
         is not distinct from (old.patient_id, old.drug_classes, old.allergy_override_reason) then
    new.allergy_check_status := old.allergy_check_status; -- not client-editable
    return new;
  end if;

  select exists (
    select 1 from public.patient_allergies a
    where a.patient_id = new.patient_id and a.clinic_id = new.clinic_id
      and a.kind = 'allergy' and a.removed_at is null
      and a.allergen_class = any (new.drug_classes)) into conflict;

  if conflict and length(reason) < 10 then
    raise exception 'Allergy conflict: a written override reason (at least 10 characters) is required'
      using errcode = '23514';
  end if;

  select exists (
    select 1 from public.patient_allergies a
    where a.patient_id = new.patient_id and a.clinic_id = new.clinic_id and a.removed_at is null) into has_any;

  new.allergy_check_status := case
    when conflict or length(reason) > 0 then 'overridden'
    when coalesce(cardinality(new.drug_classes), 0) = 0 then 'unchecked'
    when not has_any then 'no_allergy_record'
    else 'clear' end;
  return new;
end $$;
create trigger prescription_allergy_rules before insert or update on public.prescriptions
  for each row execute function app.prescription_allergy_rules();

-- ---------------------------------------------------------------------------
-- Laboratory catalogue and reference ranges
-- ---------------------------------------------------------------------------
create table public.lab_test_types (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  code text not null check (code ~ '^[A-Z0-9_]{1,20}$'),
  name text not null check (length(trim(name)) between 1 and 100),
  unit text not null check (length(trim(unit)) between 1 and 20),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, clinic_id),
  unique (clinic_id, code)
);

create table public.lab_reference_ranges (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  test_type_id uuid not null,
  sex text not null default 'any' check (sex in ('any', 'female', 'male')),
  age_min_years integer not null default 0 check (age_min_years >= 0),
  age_max_years integer not null default 200,
  low numeric,
  high numeric,
  critical_low numeric,
  critical_high numeric,
  -- CLINICAL PLACEHOLDER marker: null until a clinician signs the range off.
  reviewed_at timestamptz,
  reviewed_by_name text,
  note text check (note is null or length(note) <= 200),
  created_at timestamptz not null default now(),
  unique (id, clinic_id),
  foreign key (test_type_id, clinic_id) references public.lab_test_types (id, clinic_id),
  -- Mirrors lib/rules/lab-flags.ts validateRange().
  check (age_max_years > age_min_years),
  check (low is null or high is null or low < high),
  check (critical_low is null or low is null or critical_low <= low),
  check (critical_high is null or high is null or critical_high >= high),
  check (critical_low is null or critical_high is null or critical_low < critical_high),
  check (num_nonnulls(low, high, critical_low, critical_high) >= 1),
  check ((reviewed_at is null) = (reviewed_by_name is null)),
  -- One range per test, sex and age: ambiguity is impossible by construction.
  constraint lab_ranges_no_overlap exclude using gist (
    test_type_id with =, sex with =, int4range(age_min_years, age_max_years, '[)') with &&)
);

-- ---------------------------------------------------------------------------
-- Orders and results
-- ---------------------------------------------------------------------------
create table public.lab_orders (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  patient_id uuid not null,
  ordered_by uuid not null,
  consultation_id uuid,
  status text not null default 'ordered' check (status in ('ordered', 'collected', 'resulted', 'cancelled')),
  clinical_notes text check (clinical_notes is null or length(clinical_notes) <= 500),
  ordered_at timestamptz not null default now(),
  collected_at timestamptz,
  collected_by uuid,
  cancelled_reason text check (cancelled_reason is null or length(cancelled_reason) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, clinic_id),
  foreign key (patient_id, clinic_id) references public.patients (id, clinic_id),
  foreign key (ordered_by, clinic_id) references public.profiles (id, clinic_id),
  foreign key (collected_by, clinic_id) references public.profiles (id, clinic_id),
  foreign key (consultation_id, clinic_id) references public.consultations (id, clinic_id),
  check ((status = 'cancelled') = (cancelled_reason is not null))
);
create index lab_orders_clinic_status_idx on public.lab_orders (clinic_id, status, ordered_at desc);
create index lab_orders_patient_idx on public.lab_orders (patient_id, ordered_at desc);

create table public.lab_results (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  order_id uuid not null,
  patient_id uuid not null,
  test_type_id uuid not null,
  value numeric check (value >= 0),
  unit text not null,
  -- Computed by the database from the value, the patient's sex and age, and
  -- the matching range. Never client-supplied.
  flag text check (flag in ('normal', 'low', 'high', 'critical_low', 'critical_high', 'unflagged')),
  range_id uuid,
  ref_low numeric,
  ref_high numeric,
  ref_critical_low numeric,
  ref_critical_high numeric,
  range_reviewed boolean,
  comment text check (comment is null or length(comment) <= 500),
  entered_by uuid,
  entered_at timestamptz,
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  released_by uuid,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, clinic_id),
  unique (order_id, test_type_id),
  foreign key (order_id, clinic_id) references public.lab_orders (id, clinic_id),
  foreign key (patient_id, clinic_id) references public.patients (id, clinic_id),
  foreign key (test_type_id, clinic_id) references public.lab_test_types (id, clinic_id),
  foreign key (range_id, clinic_id) references public.lab_reference_ranges (id, clinic_id),
  foreign key (entered_by, clinic_id) references public.profiles (id, clinic_id),
  foreign key (acknowledged_by, clinic_id) references public.profiles (id, clinic_id),
  foreign key (released_by, clinic_id) references public.profiles (id, clinic_id),
  check ((value is null) = (flag is null)),
  check ((value is null) = (entered_at is null)),
  check (released_at is null or value is not null),
  check ((released_at is null) = (released_by is null)),
  check ((acknowledged_at is null) = (acknowledged_by is null))
);
create index lab_results_order_idx on public.lab_results (order_id);
create index lab_results_patient_idx on public.lab_results (patient_id);
create index lab_results_unacked_critical_idx on public.lab_results (clinic_id)
  where flag in ('critical_low', 'critical_high') and acknowledged_at is null;

-- ---------------------------------------------------------------------------
-- Flagging functions (mirror lib/rules/lab-flags.ts)
-- ---------------------------------------------------------------------------
-- Whole years of age on `p_on` in the clinic's time zone. A date of birth in
-- the future gives a NEGATIVE age (age() would truncate it to 0, which would
-- wrongly match an infant range), so no range applies and nothing is flagged.
create or replace function app.age_years(p_dob date, p_on timestamptz, p_tz text)
returns integer language sql stable set search_path = '' as $$
  select case
    when p_dob > (p_on at time zone p_tz)::date then -1
    else date_part('year', age((p_on at time zone p_tz)::date, p_dob))::integer
  end
$$;

create or replace function app.flag_value(v numeric, lo numeric, hi numeric, clo numeric, chi numeric)
returns text language sql immutable set search_path = '' as $$
  select case
    when v is null then 'unflagged'
    when clo is not null and v < clo then 'critical_low'
    when chi is not null and v > chi then 'critical_high'
    when lo is null and hi is null then 'unflagged'
    when lo is not null and v < lo then 'low'
    when hi is not null and v > hi then 'high'
    else 'normal' end
$$;

-- The one applicable range, or NULL: sex-specific tier first (only for female
-- or male patients), then the any-sex tier; more than one candidate in a tier
-- means ambiguity, which is "no range", never a guess.
create or replace function app.pick_reference_range(p_test uuid, p_sex public.sex_at_birth, p_age integer)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare n integer; rid uuid;
begin
  if p_age is null or p_age < 0 then return null; end if;
  if p_sex in ('female', 'male') then
    select count(*), (array_agg(r.id))[1] into n, rid from public.lab_reference_ranges r
     where r.test_type_id = p_test and r.sex = p_sex::text and p_age >= r.age_min_years and p_age < r.age_max_years;
    if n > 1 then return null; end if;
    if n = 1 then return rid; end if;
  end if;
  select count(*), (array_agg(r.id))[1] into n, rid from public.lab_reference_ranges r
   where r.test_type_id = p_test and r.sex = 'any' and p_age >= r.age_min_years and p_age < r.age_max_years;
  if n = 1 then return rid; end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Order rules
-- ---------------------------------------------------------------------------
-- Mirrors lib/rules/lab-orders.ts TRANSITIONS.
create or replace function app.lab_order_transition_allowed(f text, t text)
returns boolean language sql immutable set search_path = '' as $$
  select f = t
      or (f = 'ordered' and t in ('collected', 'resulted', 'cancelled'))
      or (f = 'collected' and t in ('resulted', 'cancelled'))
$$;

create or replace function app.lab_order_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r public.app_role := app.role();
  cons_patient uuid;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'ordered' then raise exception 'New orders start as ordered' using errcode = '23514'; end if;
    if new.consultation_id is not null then
      select c.patient_id into cons_patient from public.consultations c where c.id = new.consultation_id;
      if cons_patient is distinct from new.patient_id then
        raise exception 'The order must be for the consultation''s patient' using errcode = '23514';
      end if;
    end if;
    new.ordered_by := coalesce(auth.uid(), new.ordered_by);
    new.ordered_at := now();
    new.collected_at := null; new.collected_by := null; new.cancelled_reason := null;
    return new;
  end if;

  if (new.patient_id, new.ordered_by, new.consultation_id, new.clinical_notes, new.ordered_at)
     is distinct from (old.patient_id, old.ordered_by, old.consultation_id, old.clinical_notes, old.ordered_at) then
    raise exception 'Order details cannot be changed' using errcode = '42501';
  end if;
  if not app.lab_order_transition_allowed(old.status, new.status) then
    raise exception 'Cannot change a lab order from % to %', old.status, new.status using errcode = '23514';
  end if;

  if new.status is distinct from old.status then
    if r = 'lab' and new.status not in ('collected', 'resulted') then
      raise exception 'The laboratory can only collect or result orders' using errcode = '42501';
    end if;
    if r = 'doctor' and new.status <> 'cancelled' then
      raise exception 'Doctors can only cancel orders' using errcode = '42501';
    end if;
    if new.status = 'collected' then
      new.collected_at := now();
      new.collected_by := coalesce(auth.uid(), new.collected_by);
    elsif new.status = 'resulted' then
      new.collected_at := coalesce(old.collected_at, now());
      new.collected_by := coalesce(old.collected_by, auth.uid(), new.collected_by);
    elsif new.status = 'cancelled' then
      if exists (select 1 from public.lab_results x where x.order_id = new.id and x.value is not null) then
        raise exception 'Orders with results cannot be cancelled' using errcode = '23514';
      end if;
      if length(trim(coalesce(new.cancelled_reason, ''))) < 3 then
        raise exception 'Give a reason for cancelling' using errcode = '23514';
      end if;
    end if;
  elsif r is not null and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    raise exception 'Nothing to change on this order' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger lab_order_rules before insert or update on public.lab_orders
  for each row execute function app.lab_order_rules();

-- ---------------------------------------------------------------------------
-- Result rules: who may change what, and the flag.
--   lab:    enters / corrects the value and comment (until released)
--   doctor: acknowledges and releases results on their own orders
--   system (no signed-in user, e.g. seed): unrestricted, but the flag is still computed
-- ---------------------------------------------------------------------------
create or replace function app.lab_result_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r public.app_role := app.role();
  ord record;
  pt record;
  rg record;
  rid uuid;
  allowed text[];
  age integer;
begin
  select o.patient_id, o.status into ord from public.lab_orders o where o.id = new.order_id and o.clinic_id = new.clinic_id;
  if not found then raise exception 'Order not found' using errcode = '23503'; end if;
  if ord.patient_id is distinct from new.patient_id then
    raise exception 'The result must belong to the order''s patient' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    select t.unit into new.unit from public.lab_test_types t
     where t.id = new.test_type_id and t.clinic_id = new.clinic_id and t.active;
    if not found then raise exception 'That test is not available' using errcode = '23514'; end if;
    if r is not null then
      if new.value is not null then raise exception 'Results are entered by the laboratory' using errcode = '42501'; end if;
      new.flag := null; new.range_id := null; new.ref_low := null; new.ref_high := null;
      new.ref_critical_low := null; new.ref_critical_high := null; new.range_reviewed := null;
      new.entered_at := null; new.entered_by := null;
      new.acknowledged_at := null; new.acknowledged_by := null; new.released_at := null; new.released_by := null;
    end if;
  else
    if (new.order_id, new.patient_id, new.test_type_id, new.unit) is distinct from (old.order_id, old.patient_id, old.test_type_id, old.unit) then
      raise exception 'Result identity cannot be changed' using errcode = '42501';
    end if;
    if old.value is not null and new.value is null then
      raise exception 'A result cannot be cleared' using errcode = '23514';
    end if;
    if r = 'lab' then
      allowed := array['value', 'comment', 'updated_at'];
    elsif r = 'doctor' then
      allowed := array['acknowledged_at', 'acknowledged_by', 'released_at', 'released_by', 'updated_at'];
    end if;
    if allowed is not null then
      if (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed) then
        raise exception 'Your role cannot change those fields' using errcode = '42501';
      end if;
      if old.released_at is not null and r = 'lab' then
        raise exception 'Released results cannot be changed' using errcode = '42501';
      end if;
    end if;
    -- Acknowledge / release stamps are applied here, not trusted from the client.
    if new.acknowledged_at is not null and old.acknowledged_at is null then
      new.acknowledged_at := now(); new.acknowledged_by := coalesce(auth.uid(), new.acknowledged_by);
    elsif r is not null then
      new.acknowledged_at := old.acknowledged_at; new.acknowledged_by := old.acknowledged_by;
    end if;
    if new.released_at is not null and old.released_at is null then
      if new.value is null then raise exception 'There is no result to release yet' using errcode = '23514'; end if;
      new.released_at := now(); new.released_by := coalesce(auth.uid(), new.released_by);
    elsif r is not null then
      new.released_at := old.released_at; new.released_by := old.released_by;
    end if;
  end if;

  if new.value is not null and (tg_op = 'INSERT' or new.value is distinct from old.value) then
    if ord.status = 'cancelled' then raise exception 'This order was cancelled' using errcode = '23514'; end if;
    select p.sex_at_birth, p.date_of_birth, c.timezone into pt
      from public.patients p join public.clinics c on c.id = p.clinic_id where p.id = new.patient_id;
    new.entered_at := now();
    new.entered_by := coalesce(auth.uid(), new.entered_by);
    age := app.age_years(pt.date_of_birth, new.entered_at, pt.timezone);
    rid := app.pick_reference_range(new.test_type_id, pt.sex_at_birth, age);
    if rid is null then
      new.flag := 'unflagged';
      new.range_id := null; new.ref_low := null; new.ref_high := null;
      new.ref_critical_low := null; new.ref_critical_high := null; new.range_reviewed := null;
    else
      select * into rg from public.lab_reference_ranges where id = rid;
      new.flag := app.flag_value(new.value, rg.low, rg.high, rg.critical_low, rg.critical_high);
      new.range_id := rid; new.ref_low := rg.low; new.ref_high := rg.high;
      new.ref_critical_low := rg.critical_low; new.ref_critical_high := rg.critical_high;
      new.range_reviewed := rg.reviewed_at is not null;
    end if;
    -- A changed value needs a fresh acknowledgement.
    if tg_op = 'UPDATE' then new.acknowledged_at := null; new.acknowledged_by := null; end if;
  end if;
  return new;
end $$;
create trigger lab_result_rules before insert or update on public.lab_results
  for each row execute function app.lab_result_rules();

-- When every test on an order has a value, the order is resulted.
create or replace function app.lab_result_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.value is not null and not exists (
       select 1 from public.lab_results x where x.order_id = new.order_id and x.value is null) then
    update public.lab_orders set status = 'resulted' where id = new.order_id and status in ('ordered', 'collected');
  end if;
  return null;
end $$;
create trigger lab_result_after after insert or update of value on public.lab_results
  for each row execute function app.lab_result_after();

-- Atomic "order these tests". SECURITY INVOKER: runs under the caller's RLS.
create or replace function public.create_lab_order(p_patient uuid, p_consultation uuid, p_tests uuid[], p_notes text default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  clinic uuid := app.clinic_id();
  oid uuid;
begin
  if coalesce(cardinality(p_tests), 0) = 0 then
    raise exception 'Choose at least one test' using errcode = '23514';
  end if;
  if cardinality(p_tests) > 30 then
    raise exception 'Too many tests in one order' using errcode = '23514';
  end if;
  insert into public.lab_orders (clinic_id, patient_id, ordered_by, consultation_id, clinical_notes)
  values (clinic, p_patient, auth.uid(), p_consultation, nullif(trim(coalesce(p_notes, '')), ''))
  returning id into oid;
  insert into public.lab_results (clinic_id, order_id, patient_id, test_type_id, unit)
  select clinic, oid, p_patient, x, '' from (select distinct unnest(p_tests) as x) s;
  return oid;
end $$;

-- ---------------------------------------------------------------------------
-- Housekeeping triggers
-- ---------------------------------------------------------------------------
create trigger set_updated_at before update on public.lab_orders for each row execute function app.set_updated_at();
create trigger set_updated_at before update on public.lab_results for each row execute function app.set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['patient_allergies', 'lab_test_types', 'lab_reference_ranges', 'lab_orders', 'lab_results']
  loop
    execute format('create trigger forbid_clinic_change before update on public.%I for each row execute function app.forbid_clinic_change()', t);
    execute format('create trigger audit_row after insert or update or delete on public.%I for each row execute function app.audit_row()', t);
  end loop;
end $$;
