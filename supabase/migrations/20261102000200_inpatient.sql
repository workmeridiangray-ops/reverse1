-- Phase 2: inpatient care -- wards and beds, admissions, bed stays/transfers,
-- discharge governance, bed housekeeping, nursing tasks and observations.
--
-- Principles (same as Phase 1):
--  * every row carries clinic_id; children use composite (id, clinic_id) FKs;
--  * state changes that span tables run through SECURITY DEFINER functions that
--    check role + clinic themselves; direct table writes cannot skip a step
--    (a trigger rejects direct changes to workflow columns);
--  * physical occupancy (bed_stays) is separate from planned reservations
--    (bed_reservations) and from billed bed-days (billed_bed_days());
--  * the database -- not application code -- refuses conflicting allocations,
--    even under concurrent requests (exclusion constraints + bed row locks).

-- ---------------------------------------------------------------------------
-- Hospital-defined policy switches (scope s.8: the hospital defines emergency
-- workflow; software must not impose an arbitrary payment rule).
-- ---------------------------------------------------------------------------
alter table public.clinics
  add column require_deposit_for_elective boolean not null default true,
  add column emergency_requires_finance_clearance boolean not null default false;

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------
create table public.wards (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  name text not null check (length(trim(name)) between 1 and 80),
  kind text not null default 'general'
    check (kind in ('general', 'surgical', 'maternity', 'paediatric', 'icu', 'emergency', 'other')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, clinic_id),
  unique (clinic_id, name)
);

create table public.beds (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  ward_id uuid not null,
  label text not null check (length(trim(label)) between 1 and 40),
  out_of_service boolean not null default false,
  housekeeping text not null default 'clean' check (housekeeping in ('clean', 'dirty', 'cleaning')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, clinic_id),
  unique (ward_id, label),
  foreign key (ward_id, clinic_id) references public.wards (id, clinic_id)
);
create index beds_ward_idx on public.beds (ward_id);

-- ---------------------------------------------------------------------------
-- Admissions
-- ---------------------------------------------------------------------------
create table public.admissions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  patient_id uuid not null,
  attending_id uuid not null,
  admission_type text not null check (admission_type in ('elective', 'emergency')),
  status text not null default 'requested' check (status in ('requested', 'admitted', 'discharged', 'cancelled')),
  reason text not null check (length(trim(reason)) between 3 and 500),
  deposit_reference text check (deposit_reference is null or length(trim(deposit_reference)) between 1 and 80),
  expected_discharge_on date,
  requested_by uuid references public.profiles (id),
  requested_at timestamptz not null default now(),
  admitted_at timestamptz,
  discharge_authorised_by uuid references public.profiles (id),
  discharge_authorised_at timestamptz,
  discharged_at timestamptz,
  discharged_by uuid references public.profiles (id),
  cancelled_reason text,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, clinic_id),
  unique (id, clinic_id, patient_id),
  foreign key (patient_id, clinic_id) references public.patients (id, clinic_id),
  foreign key (attending_id, clinic_id) references public.profiles (id, clinic_id),
  check (status <> 'admitted' or (admitted_at is not null and discharged_at is null)),
  check ((discharge_authorised_by is null) = (discharge_authorised_at is null)),
  check (status <> 'discharged' or (discharged_at is not null and discharged_by is not null and admitted_at is not null)),
  check (status <> 'cancelled' or length(trim(coalesce(cancelled_reason, ''))) >= 5)
);
-- A patient can have only one open admission at a time.
create unique index admissions_one_open_per_patient on public.admissions (patient_id)
  where status in ('requested', 'admitted');
create index admissions_clinic_status_idx on public.admissions (clinic_id, status);
create index admissions_patient_idx on public.admissions (patient_id, requested_at desc);

-- Clinical text lives apart so receptionists/admins can manage the admission
-- without being able to read the clinical summary.
create table public.admission_summaries (
  admission_id uuid primary key,
  clinic_id uuid not null references public.clinics (id),
  patient_id uuid not null,
  summary text not null check (length(trim(summary)) >= 10),
  written_by uuid not null references public.profiles (id),
  updated_at timestamptz not null default now(),
  foreign key (admission_id, clinic_id, patient_id) references public.admissions (id, clinic_id, patient_id)
);

-- Physical occupancy. One row per continuous stay in one bed. A transfer closes
-- one row and opens the next at the same effective instant (ranges are half-open).
create table public.bed_stays (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  admission_id uuid not null,
  patient_id uuid not null,
  bed_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  reason text not null check (reason in ('admission', 'transfer')),
  note text check (note is null or length(note) <= 500),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (id, clinic_id),
  foreign key (admission_id, clinic_id, patient_id) references public.admissions (id, clinic_id, patient_id),
  foreign key (bed_id, clinic_id) references public.beds (id, clinic_id),
  check (ends_at is null or ends_at > starts_at),
  constraint bed_stays_no_bed_overlap exclude using gist (
    bed_id with =, tstzrange(starts_at, coalesce(ends_at, 'infinity'), '[)') with &&),
  constraint bed_stays_no_patient_overlap exclude using gist (
    admission_id with =, tstzrange(starts_at, coalesce(ends_at, 'infinity'), '[)') with &&)
);
create index bed_stays_admission_idx on public.bed_stays (admission_id, starts_at);
create index bed_stays_open_idx on public.bed_stays (bed_id) where ends_at is null;

-- Planned reservations. They do not occupy a bed; they stop other admissions
-- being given that bed while the reservation window is active.
create table public.bed_reservations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  bed_id uuid not null,
  admission_id uuid not null,
  reserved_from timestamptz not null,
  reserved_until timestamptz not null,
  status text not null default 'active' check (status in ('active', 'released', 'fulfilled')),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (id, clinic_id),
  foreign key (bed_id, clinic_id) references public.beds (id, clinic_id),
  foreign key (admission_id, clinic_id) references public.admissions (id, clinic_id),
  check (reserved_until > reserved_from),
  check (reserved_until - reserved_from <= interval '14 days'),
  constraint bed_reservations_no_overlap exclude using gist (
    bed_id with =, tstzrange(reserved_from, reserved_until, '[)') with &&) where (status = 'active')
);

-- Department clearances before final discharge.
create table public.discharge_clearances (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  admission_id uuid not null,
  patient_id uuid not null,
  department text not null check (department in ('finance', 'pharmacy', 'nursing')),
  status text not null check (status in ('cleared', 'exception')),
  note text check (note is null or length(note) <= 500),
  cleared_by uuid not null references public.profiles (id),
  cleared_at timestamptz not null default now(),
  unique (admission_id, department),
  foreign key (admission_id, clinic_id, patient_id) references public.admissions (id, clinic_id, patient_id),
  -- An exception (clearing despite an outstanding item) always carries a reason.
  check (status <> 'exception' or length(trim(coalesce(note, ''))) >= 10)
);

-- ---------------------------------------------------------------------------
-- Nursing
-- ---------------------------------------------------------------------------
create table public.care_tasks (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  admission_id uuid not null,
  patient_id uuid not null,
  title text not null check (length(trim(title)) between 1 and 200),
  due_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'not_done')),
  not_done_reason text,
  completed_by uuid references public.profiles (id),
  completed_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (id, clinic_id),
  foreign key (admission_id, clinic_id, patient_id) references public.admissions (id, clinic_id, patient_id),
  -- Explicit states: "not given" always says why, and who recorded it.
  check (status <> 'not_done' or length(trim(coalesce(not_done_reason, ''))) >= 3),
  check ((status = 'pending') = (completed_by is null and completed_at is null))
);
create index care_tasks_admission_idx on public.care_tasks (admission_id, due_at);
create index care_tasks_pending_idx on public.care_tasks (clinic_id, due_at) where status = 'pending';

-- Append-only. A wrong entry is corrected by a new row that points at it;
-- the original stays visible.
create table public.observations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  admission_id uuid not null,
  patient_id uuid not null,
  recorded_at timestamptz not null default now(),
  recorded_by uuid not null references public.profiles (id),
  systolic smallint check (systolic between 40 and 300),
  diastolic smallint check (diastolic between 20 and 200),
  pulse smallint check (pulse between 10 and 300),
  resp_rate smallint check (resp_rate between 2 and 80),
  temp_c numeric(3, 1) check (temp_c between 25 and 45),
  spo2 smallint check (spo2 between 30 and 100),
  note text check (note is null or length(note) <= 500),
  corrects_id uuid references public.observations (id),
  correction_reason text,
  unique (id, clinic_id),
  foreign key (admission_id, clinic_id, patient_id) references public.admissions (id, clinic_id, patient_id),
  check (systolic is null or diastolic is null or systolic > diastolic),
  check (num_nonnulls(systolic, diastolic, pulse, resp_rate, temp_c, spo2) > 0),
  check ((corrects_id is null) = (correction_reason is null))
);
create index observations_admission_idx on public.observations (admission_id, recorded_at desc);

-- ---------------------------------------------------------------------------
-- Generic triggers
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['wards', 'beds', 'admissions'] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function app.set_updated_at()', t);
  end loop;
  foreach t in array array['wards', 'beds', 'admissions', 'admission_summaries', 'bed_stays', 'bed_reservations',
                           'discharge_clearances', 'care_tasks', 'observations'] loop
    execute format('create trigger forbid_clinic_change before update on public.%I for each row execute function app.forbid_clinic_change()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function app.assert_role(variadic roles public.app_role[])
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_role(variadic roles) then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
end $$;

-- True when the statement comes straight from an API client, not from one of
-- the workflow functions below (which run as the function owner).
create or replace function app.is_direct_client()
returns boolean language sql stable as $$ select current_user in ('authenticated', 'anon') $$;

-- Which clearances must be recorded before this admission may be discharged.
-- PARITY: mirrors lib/rules/admission.ts requiredClearances().
create or replace function app.required_clearances(p_type text, p_emergency_needs_finance boolean)
returns text[] language sql immutable as $$
  select case
    when p_type = 'emergency' and not p_emergency_needs_finance then array['pharmacy', 'nursing']
    else array['finance', 'pharmacy', 'nursing']
  end
$$;

-- Everything still standing between this admission and final discharge.
-- PARITY: mirrors lib/rules/admission.ts dischargeBlockers().
create or replace function app.discharge_blockers(p_admission uuid)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare
  adm public.admissions%rowtype;
  needs_finance boolean;
  blockers text[] := '{}';
  dept text;
begin
  select * into adm from public.admissions where id = p_admission;
  if not found then return array['Admission not found']; end if;
  select emergency_requires_finance_clearance into needs_finance from public.clinics where id = adm.clinic_id;
  if adm.status <> 'admitted' then blockers := blockers || 'Patient is not currently admitted'::text; end if;
  if adm.discharge_authorised_at is null then blockers := blockers || 'Discharge has not been authorised by a doctor'::text; end if;
  if not exists (select 1 from public.admission_summaries s where s.admission_id = adm.id) then
    blockers := blockers || 'Discharge summary has not been written'::text;
  end if;
  foreach dept in array app.required_clearances(adm.admission_type, needs_finance) loop
    if not exists (select 1 from public.discharge_clearances c where c.admission_id = adm.id and c.department = dept) then
      blockers := blockers || (initcap(dept) || ' clearance is outstanding')::text;
    end if;
  end loop;
  return blockers;
end $$;

-- Billed bed-days: midnight census in the clinic's time zone, minimum one day
-- for any admission that had a bed. Separate from physical occupancy by design.
create or replace function public.billed_bed_days(p_admission uuid)
returns integer language sql stable security invoker set search_path = '' as $$
  with tz as (
    select c.timezone from public.admissions a join public.clinics c on c.id = a.clinic_id where a.id = p_admission
  ), stays as (
    select s.starts_at, coalesce(s.ends_at, now()) as ends_at from public.bed_stays s where s.admission_id = p_admission
  ), mid as (
    select (d.day at time zone (select timezone from tz)) as at_midnight, s.starts_at, s.ends_at
    from stays s,
         lateral generate_series(
           date_trunc('day', s.starts_at at time zone (select timezone from tz)) + interval '1 day',
           s.ends_at at time zone (select timezone from tz),
           interval '1 day') as d(day)
  )
  select case when not exists (select 1 from stays) then 0
              else greatest(1, (select count(*) from mid where at_midnight >= starts_at and at_midnight < ends_at))::integer end
$$;

-- ---------------------------------------------------------------------------
-- Guard triggers
-- ---------------------------------------------------------------------------
create or replace function app.admissions_guard()
returns trigger language plpgsql set search_path = '' as $$
declare c public.clinics%rowtype; attending_role public.app_role;
begin
  if tg_op = 'INSERT' then
    select * into c from public.clinics where id = new.clinic_id;
    select role into attending_role from public.profiles where id = new.attending_id and clinic_id = new.clinic_id and active;
    if attending_role is distinct from 'doctor' then
      raise exception 'The attending clinician must be an active doctor.' using errcode = '23514';
    end if;
    if app.is_direct_client() and new.status <> 'requested' then
      raise exception 'New admissions start as requests.' using errcode = '42501';
    end if;
    if new.admission_type = 'elective' and c.require_deposit_for_elective
       and length(trim(coalesce(new.deposit_reference, ''))) = 0 then
      raise exception 'Elective admissions need a deposit reference (hospital policy). Emergency admissions do not.' using errcode = '23514';
    end if;
    new.requested_by := coalesce(auth.uid(), new.requested_by);
    return new;
  end if;

  -- UPDATE
  if old.status in ('discharged', 'cancelled') then
    raise exception 'This admission is closed and can no longer be changed.' using errcode = '55000';
  end if;
  if app.is_direct_client() and (
       new.status is distinct from old.status or new.patient_id is distinct from old.patient_id
       or new.admission_type is distinct from old.admission_type
       or new.admitted_at is distinct from old.admitted_at
       or new.discharge_authorised_by is distinct from old.discharge_authorised_by
       or new.discharge_authorised_at is distinct from old.discharge_authorised_at
       or new.discharged_at is distinct from old.discharged_at or new.discharged_by is distinct from old.discharged_by
       or new.cancelled_reason is distinct from old.cancelled_reason
       or new.requested_by is distinct from old.requested_by or new.requested_at is distinct from old.requested_at
       or new.row_version is distinct from old.row_version) then
    raise exception 'Admission progress can only change through the admission workflow.' using errcode = '42501';
  end if;
  if new.attending_id is distinct from old.attending_id then
    select role into attending_role from public.profiles where id = new.attending_id and clinic_id = new.clinic_id and active;
    if attending_role is distinct from 'doctor' then
      raise exception 'The attending clinician must be an active doctor.' using errcode = '23514';
    end if;
  end if;
  new.row_version := old.row_version + 1;
  return new;
end $$;
create trigger admissions_guard before insert or update on public.admissions
  for each row execute function app.admissions_guard();

create or replace function app.beds_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if app.is_direct_client() and tg_op = 'UPDATE' and new.housekeeping is distinct from old.housekeeping then
    raise exception 'Bed cleaning status changes through the housekeeping workflow.' using errcode = '42501';
  end if;
  if new.out_of_service and exists (select 1 from public.bed_stays s where s.bed_id = new.id and s.ends_at is null) then
    raise exception 'This bed is occupied. Transfer or discharge the patient before taking it out of service.' using errcode = '55000';
  end if;
  return new;
end $$;
create trigger beds_guard before insert or update on public.beds for each row execute function app.beds_guard();

-- NOTE: guard triggers run as the caller (not definer) on purpose: they use
-- app.is_direct_client() (current_user) to tell API clients from workflow functions.

-- Stays are written by the workflow functions only. The one allowed change to
-- an existing stay is closing it.
create or replace function app.bed_stays_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if app.is_direct_client() then
    raise exception 'Bed stays are managed through allocate / transfer / discharge.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Bed stays are never deleted.' using errcode = '42501';
  end if;
  if old.ends_at is not null or new.ends_at is null
     or (to_jsonb(new) - 'ends_at') is distinct from (to_jsonb(old) - 'ends_at') then
    raise exception 'A bed stay can only be closed, once.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger bed_stays_guard before insert or update or delete on public.bed_stays
  for each row execute function app.bed_stays_guard();

create or replace function app.workflow_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  if app.is_direct_client() then
    raise exception 'This record is written through the workflow only.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger workflow_only before insert or update or delete on public.discharge_clearances
  for each row execute function app.workflow_only();
create trigger workflow_only before insert or update or delete on public.admission_summaries
  for each row execute function app.workflow_only();

-- Nursing records only for patients currently in hospital.
create or replace function app.nursing_guard()
returns trigger language plpgsql set search_path = '' as $$
declare st text;
begin
  select status into st from public.admissions where id = new.admission_id;
  if tg_op = 'INSERT' then
    if st is distinct from 'admitted' then
      raise exception 'Nursing records can only be added while the patient is admitted.' using errcode = '55000';
    end if;
    if tg_table_name = 'care_tasks' then new.created_by := coalesce(auth.uid(), new.created_by); end if;
    if tg_table_name = 'observations' then
      new.recorded_by := coalesce(auth.uid(), new.recorded_by);
      new.recorded_at := now();
    end if;
  end if;
  return new;
end $$;
create trigger nursing_guard before insert on public.care_tasks for each row execute function app.nursing_guard();
create trigger nursing_guard before insert on public.observations for each row execute function app.nursing_guard();

create or replace function app.care_task_update_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status <> 'pending' then
    raise exception 'A recorded task is part of the record. Add a new task instead of editing it.' using errcode = '55000';
  end if;
  if new.status = 'pending' then
    raise exception 'Choose done or not done.' using errcode = '23514';
  end if;
  if (to_jsonb(new) - array['status', 'not_done_reason', 'completed_by', 'completed_at'])
     is distinct from (to_jsonb(old) - array['status', 'not_done_reason', 'completed_by', 'completed_at']) then
    raise exception 'Only the outcome of a task can be recorded.' using errcode = '42501';
  end if;
  new.completed_by := coalesce(auth.uid(), new.completed_by);
  new.completed_at := now();
  return new;
end $$;
create trigger care_task_update_guard before update on public.care_tasks
  for each row execute function app.care_task_update_guard();

create or replace function app.immutable_row()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '% records cannot be changed or deleted. Add a corrected entry instead.', tg_table_name using errcode = '42501';
end $$;
create trigger immutable_row before update or delete on public.observations
  for each row execute function app.immutable_row();

-- A correction must refer to an observation of the same admission.
create or replace function app.observation_correction_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.corrects_id is not null and not exists (
    select 1 from public.observations o where o.id = new.corrects_id and o.admission_id = new.admission_id and o.clinic_id = new.clinic_id) then
    raise exception 'A correction must refer to an entry for the same admission.' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger observation_correction_guard before insert on public.observations
  for each row execute function app.observation_correction_guard();

-- ---------------------------------------------------------------------------
-- Workflow functions (SECURITY DEFINER; each checks role and clinic itself)
-- ---------------------------------------------------------------------------
create or replace function app.assert_bed_allocatable(p_bed public.beds, p_from timestamptz)
returns void language plpgsql stable security definer set search_path = '' as $$
declare w_active boolean;
begin
  select active into w_active from public.wards where id = p_bed.ward_id;
  if not coalesce(w_active, false) then raise exception 'That ward is closed.' using errcode = '55000'; end if;
  if p_bed.out_of_service then raise exception 'Bed % is out of service.', p_bed.label using errcode = '55000'; end if;
  if p_bed.housekeeping <> 'clean' then
    raise exception 'Bed % has not been cleaned yet (%).', p_bed.label, p_bed.housekeeping using errcode = '55000';
  end if;
  if exists (select 1 from public.bed_stays s where s.bed_id = p_bed.id and s.ends_at is null) then
    raise exception 'Bed % is already occupied.', p_bed.label using errcode = '55000';
  end if;
end $$;

create or replace function public.allocate_bed(p_admission uuid, p_bed uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  clinic uuid := app.clinic_id();
  adm public.admissions%rowtype;
  b public.beds%rowtype;
  res public.bed_reservations%rowtype;
  stay uuid;
begin
  perform app.assert_role('admin', 'receptionist', 'nurse');
  select * into adm from public.admissions where id = p_admission and clinic_id = clinic for update;
  if not found then raise exception 'Admission not found.' using errcode = 'P0002'; end if;
  if adm.status <> 'requested' then
    raise exception 'Only a requested admission can be given its first bed.' using errcode = '55000';
  end if;
  -- Lock the bed row so concurrent allocators queue behind each other.
  select * into b from public.beds where id = p_bed and clinic_id = clinic for update;
  if not found then raise exception 'Bed not found.' using errcode = 'P0002'; end if;
  perform app.assert_bed_allocatable(b, now());

  select * into res from public.bed_reservations r
   where r.bed_id = p_bed and r.status = 'active' and r.reserved_from <= now() and now() < r.reserved_until;
  if found and res.admission_id <> p_admission then
    raise exception 'Bed % is reserved for another admission until %.', b.label, to_char(res.reserved_until, 'YYYY-MM-DD HH24:MI TZ')
      using errcode = '55000';
  end if;
  update public.bed_reservations set status = 'fulfilled'
   where admission_id = p_admission and bed_id = p_bed and status = 'active';

  insert into public.bed_stays (clinic_id, admission_id, patient_id, bed_id, starts_at, reason, created_by)
  values (clinic, p_admission, adm.patient_id, p_bed, now(), 'admission', auth.uid())
  returning id into stay;
  update public.admissions set status = 'admitted', admitted_at = now() where id = p_admission;
  -- Any other reservation this admission held is no longer needed.
  update public.bed_reservations set status = 'released' where admission_id = p_admission and status = 'active';
  return stay;
end $$;

create or replace function public.transfer_bed(p_admission uuid, p_bed uuid, p_effective timestamptz default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  clinic uuid := app.clinic_id();
  adm public.admissions%rowtype;
  cur public.bed_stays%rowtype;
  b public.beds%rowtype;
  eff timestamptz := coalesce(p_effective, now());
  stay uuid;
begin
  perform app.assert_role('admin', 'nurse');
  select * into adm from public.admissions where id = p_admission and clinic_id = clinic for update;
  if not found then raise exception 'Admission not found.' using errcode = 'P0002'; end if;
  if adm.status <> 'admitted' then raise exception 'Only an admitted patient can be transferred.' using errcode = '55000'; end if;
  select * into cur from public.bed_stays where admission_id = p_admission and ends_at is null for update;
  if not found then raise exception 'The patient has no current bed.' using errcode = '55000'; end if;
  if cur.bed_id = p_bed then raise exception 'The patient is already in that bed.' using errcode = '55000'; end if;
  if eff > now() + interval '1 minute' then
    raise exception 'A transfer cannot be dated in the future. Reserve the bed for a planned move instead.' using errcode = '22023';
  end if;
  if eff <= cur.starts_at then
    raise exception 'The transfer time must be after the patient arrived in the current bed.' using errcode = '22023';
  end if;
  select * into b from public.beds where id = p_bed and clinic_id = clinic for update;
  if not found then raise exception 'Bed not found.' using errcode = 'P0002'; end if;
  perform app.assert_bed_allocatable(b, eff);
  if exists (select 1 from public.bed_reservations r where r.bed_id = p_bed and r.status = 'active'
             and r.admission_id <> p_admission and r.reserved_from <= now() and now() < r.reserved_until) then
    raise exception 'Bed % is reserved for another admission.', b.label using errcode = '55000';
  end if;

  update public.bed_stays set ends_at = eff where id = cur.id;
  insert into public.bed_stays (clinic_id, admission_id, patient_id, bed_id, starts_at, reason, note, created_by)
  values (clinic, p_admission, adm.patient_id, p_bed, eff, 'transfer', nullif(trim(p_note), ''), auth.uid())
  returning id into stay;
  update public.beds set housekeeping = 'dirty' where id = cur.bed_id;
  update public.bed_reservations set status = 'fulfilled'
   where admission_id = p_admission and bed_id = p_bed and status = 'active';
  return stay;
end $$;

create or replace function public.cancel_admission(p_admission uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); adm public.admissions%rowtype;
begin
  perform app.assert_role('admin', 'receptionist', 'doctor');
  select * into adm from public.admissions where id = p_admission and clinic_id = clinic for update;
  if not found then raise exception 'Admission not found.' using errcode = 'P0002'; end if;
  if adm.status <> 'requested' then
    raise exception 'Only a request that has not yet been given a bed can be cancelled. Use discharge for admitted patients.' using errcode = '55000';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Give a reason for cancelling (at least 5 characters).' using errcode = '23514';
  end if;
  update public.admissions set status = 'cancelled', cancelled_reason = trim(p_reason) where id = p_admission;
  update public.bed_reservations set status = 'released' where admission_id = p_admission and status = 'active';
end $$;

create or replace function public.authorise_discharge(p_admission uuid, p_summary text)
returns void language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); adm public.admissions%rowtype;
begin
  perform app.assert_role('doctor');
  select * into adm from public.admissions where id = p_admission and clinic_id = clinic for update;
  if not found then raise exception 'Admission not found.' using errcode = 'P0002'; end if;
  if adm.status <> 'admitted' then raise exception 'Only an admitted patient can be authorised for discharge.' using errcode = '55000'; end if;
  if length(trim(coalesce(p_summary, ''))) < 10 then
    raise exception 'Write the discharge summary first (at least 10 characters).' using errcode = '23514';
  end if;
  insert into public.admission_summaries (admission_id, clinic_id, patient_id, summary, written_by)
  values (p_admission, clinic, adm.patient_id, trim(p_summary), auth.uid())
  on conflict (admission_id) do update set summary = excluded.summary, written_by = excluded.written_by, updated_at = now();
  update public.admissions set discharge_authorised_by = auth.uid(), discharge_authorised_at = now() where id = p_admission;
end $$;

create or replace function public.withdraw_discharge_authorisation(p_admission uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); adm public.admissions%rowtype;
begin
  perform app.assert_role('doctor');
  select * into adm from public.admissions where id = p_admission and clinic_id = clinic for update;
  if not found then raise exception 'Admission not found.' using errcode = 'P0002'; end if;
  if adm.status <> 'admitted' or adm.discharge_authorised_at is null then
    raise exception 'There is no discharge authorisation to withdraw.' using errcode = '55000';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Give a reason for withdrawing the authorisation.' using errcode = '23514';
  end if;
  update public.admissions set discharge_authorised_by = null, discharge_authorised_at = null where id = p_admission;
end $$;

create or replace function public.record_clearance(p_admission uuid, p_department text, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); adm public.admissions%rowtype;
begin
  if p_department not in ('finance', 'pharmacy', 'nursing') then
    raise exception 'Unknown department.' using errcode = '22023';
  end if;
  if p_status not in ('cleared', 'exception') then raise exception 'Unknown clearance status.' using errcode = '22023'; end if;
  case p_department
    when 'finance' then perform app.assert_role('admin', 'receptionist');
    when 'pharmacy' then perform app.assert_role('admin', 'pharmacist');
    when 'nursing' then perform app.assert_role('admin', 'nurse');
  end case;
  -- Clearing despite an outstanding item is a management decision.
  if p_status = 'exception' then perform app.assert_role('admin'); end if;
  select * into adm from public.admissions where id = p_admission and clinic_id = clinic for update;
  if not found then raise exception 'Admission not found.' using errcode = 'P0002'; end if;
  if adm.status <> 'admitted' then raise exception 'Only an admitted patient can be cleared.' using errcode = '55000'; end if;
  insert into public.discharge_clearances (clinic_id, admission_id, patient_id, department, status, note, cleared_by)
  values (clinic, p_admission, adm.patient_id, p_department, p_status, nullif(trim(p_note), ''), auth.uid())
  on conflict (admission_id, department) do update
    set status = excluded.status, note = excluded.note, cleared_by = excluded.cleared_by, cleared_at = now();
end $$;

create or replace function public.finalise_discharge(p_admission uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  clinic uuid := app.clinic_id();
  adm public.admissions%rowtype;
  blockers text[];
  cur public.bed_stays%rowtype;
begin
  perform app.assert_role('admin', 'receptionist', 'nurse');
  select * into adm from public.admissions where id = p_admission and clinic_id = clinic for update;
  if not found then raise exception 'Admission not found.' using errcode = 'P0002'; end if;
  blockers := app.discharge_blockers(p_admission);
  if cardinality(blockers) > 0 then
    raise exception 'Cannot discharge yet: %', array_to_string(blockers, '; ') using errcode = '55000';
  end if;
  select * into cur from public.bed_stays where admission_id = p_admission and ends_at is null for update;
  if found then
    update public.bed_stays set ends_at = greatest(now(), cur.starts_at + interval '1 second') where id = cur.id;
    update public.beds set housekeeping = 'dirty' where id = cur.bed_id;
  end if;
  update public.admissions set status = 'discharged', discharged_at = now(), discharged_by = auth.uid() where id = p_admission;
end $$;

create or replace function public.set_bed_housekeeping(p_bed uuid, p_state text)
returns void language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); b public.beds%rowtype;
begin
  perform app.assert_role('admin', 'nurse');
  if p_state not in ('dirty', 'cleaning', 'clean') then raise exception 'Unknown cleaning status.' using errcode = '22023'; end if;
  select * into b from public.beds where id = p_bed and clinic_id = clinic for update;
  if not found then raise exception 'Bed not found.' using errcode = 'P0002'; end if;
  if exists (select 1 from public.bed_stays s where s.bed_id = p_bed and s.ends_at is null) then
    raise exception 'Bed % is occupied.', b.label using errcode = '55000';
  end if;
  if (b.housekeeping, p_state) not in (('dirty', 'cleaning'), ('cleaning', 'clean'), ('clean', 'dirty'), ('cleaning', 'dirty'), ('dirty', 'clean')) then
    raise exception 'A % bed cannot go straight to %.', b.housekeeping, p_state using errcode = '55000';
  end if;
  update public.beds set housekeeping = p_state where id = p_bed;
end $$;

revoke all on function public.allocate_bed(uuid, uuid), public.transfer_bed(uuid, uuid, timestamptz, text),
  public.cancel_admission(uuid, text), public.authorise_discharge(uuid, text),
  public.withdraw_discharge_authorisation(uuid, text), public.record_clearance(uuid, text, text, text),
  public.finalise_discharge(uuid), public.set_bed_housekeeping(uuid, text) from public, anon;
grant execute on function public.allocate_bed(uuid, uuid), public.transfer_bed(uuid, uuid, timestamptz, text),
  public.cancel_admission(uuid, text), public.authorise_discharge(uuid, text),
  public.withdraw_discharge_authorisation(uuid, text), public.record_clearance(uuid, text, text, text),
  public.finalise_discharge(uuid), public.set_bed_housekeeping(uuid, text), public.billed_bed_days(uuid) to authenticated;
revoke all on function public.billed_bed_days(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.wards enable row level security;
alter table public.beds enable row level security;
alter table public.admissions enable row level security;
alter table public.admission_summaries enable row level security;
alter table public.bed_stays enable row level security;
alter table public.bed_reservations enable row level security;
alter table public.discharge_clearances enable row level security;
alter table public.care_tasks enable row level security;
alter table public.observations enable row level security;
revoke all on public.wards, public.beds, public.admissions, public.admission_summaries, public.bed_stays,
  public.bed_reservations, public.discharge_clearances, public.care_tasks, public.observations from anon;
revoke truncate on public.wards, public.beds, public.admissions, public.admission_summaries, public.bed_stays,
  public.bed_reservations, public.discharge_clearances, public.care_tasks, public.observations from authenticated;
-- Nothing is ever hard-deleted through the API except structure an admin owns.
revoke delete on public.admissions, public.admission_summaries, public.bed_stays, public.discharge_clearances,
  public.care_tasks, public.observations, public.bed_reservations from authenticated;

-- Nurses join the staff-wide read policies from Phase 1.
drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (clinic_id = (select app.clinic_id())
        and (select app.has_role('admin', 'doctor', 'receptionist', 'lab', 'pharmacist', 'nurse')))
  );
drop policy patients_select on public.patients;
create policy patients_select on public.patients for select to authenticated
  using (
    (clinic_id = (select app.clinic_id())
      and (select app.has_role('admin', 'doctor', 'receptionist', 'lab', 'pharmacist', 'nurse')))
    or id = (select app.patient_id())
  );

create policy wards_select on public.wards for select to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'doctor', 'receptionist', 'nurse')));
create policy wards_insert on public.wards for insert to authenticated
  with check (clinic_id = (select app.clinic_id()) and (select app.has_role('admin')));
create policy wards_update on public.wards for update to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin')))
  with check (clinic_id = (select app.clinic_id()));

create policy beds_select on public.beds for select to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'doctor', 'receptionist', 'nurse')));
create policy beds_insert on public.beds for insert to authenticated
  with check (clinic_id = (select app.clinic_id()) and (select app.has_role('admin')));
create policy beds_update on public.beds for update to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin')))
  with check (clinic_id = (select app.clinic_id()));

create policy admissions_select on public.admissions for select to authenticated
  using (clinic_id = (select app.clinic_id())
         and (select app.has_role('admin', 'doctor', 'receptionist', 'nurse', 'pharmacist')));
create policy admissions_insert on public.admissions for insert to authenticated
  with check (clinic_id = (select app.clinic_id()) and status = 'requested'
              and (select app.has_role('admin', 'receptionist', 'doctor')));
create policy admissions_update on public.admissions for update to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'receptionist', 'doctor')))
  with check (clinic_id = (select app.clinic_id()));

create policy admission_summaries_select on public.admission_summaries for select to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('doctor', 'nurse')));

create policy bed_stays_select on public.bed_stays for select to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'doctor', 'receptionist', 'nurse')));

create policy bed_reservations_select on public.bed_reservations for select to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'doctor', 'receptionist', 'nurse')));
create policy bed_reservations_insert on public.bed_reservations for insert to authenticated
  with check (clinic_id = (select app.clinic_id()) and status = 'active'
              and (select app.has_role('admin', 'receptionist', 'nurse')));
create policy bed_reservations_update on public.bed_reservations for update to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'receptionist', 'nurse')))
  with check (clinic_id = (select app.clinic_id()) and status = 'released');

create policy discharge_clearances_select on public.discharge_clearances for select to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'doctor', 'receptionist', 'nurse', 'pharmacist')));

create policy care_tasks_select on public.care_tasks for select to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('doctor', 'nurse')));
create policy care_tasks_insert on public.care_tasks for insert to authenticated
  with check (clinic_id = (select app.clinic_id()) and status = 'pending' and (select app.has_role('doctor', 'nurse')));
create policy care_tasks_update on public.care_tasks for update to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('nurse')))
  with check (clinic_id = (select app.clinic_id()));

create policy observations_select on public.observations for select to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('doctor', 'nurse')));
create policy observations_insert on public.observations for insert to authenticated
  with check (clinic_id = (select app.clinic_id()) and (select app.has_role('doctor', 'nurse')));

-- ---------------------------------------------------------------------------
-- Audit: row changes + record views
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['wards', 'beds', 'admissions', 'admission_summaries', 'bed_stays', 'bed_reservations',
                           'discharge_clearances', 'care_tasks', 'observations']
  loop
    execute format(
      'create trigger audit_row after insert or update or delete on public.%I for each row execute function app.audit_row()', t);
  end loop;
end $$;

-- audit_row reads record id from "id"; admission_summaries is keyed by admission_id.
alter table public.admission_summaries add column id uuid generated always as (admission_id) stored;

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
    when 'admissions' then select a.patient_id into patient from public.admissions a where a.id = p_record_id;
    else raise exception 'Unsupported table %', p_table using errcode = '22023';
  end case;
  if patient is null then
    raise exception 'Record not found' using errcode = 'P0002';
  end if;
  perform app.write_view_log(p_table, p_record_id, patient, p_reason);
end $$;

-- Live census: wards, beds and admissions refresh on every connected screen.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.beds, public.admissions, public.bed_stays;
  end if;
end $$;

revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated;
