-- Tendwell core schema (Phase 1)
--
-- Tenancy: every clinical/financial row carries clinic_id. Child rows refer to
-- their parents through COMPOSITE foreign keys (id, clinic_id), so a row can
-- never point at a patient, room, doctor or invoice that belongs to another
-- clinic -- the database rejects it even if application code is wrong.
--
-- Money: always bigint minor units (cents). No numeric/float money columns.

create extension if not exists btree_gist with schema extensions;

create schema if not exists app;
comment on schema app is 'Internal helpers. Not exposed through the REST API.';

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('admin', 'doctor', 'receptionist', 'lab', 'pharmacist', 'patient');
create type public.sex_at_birth as enum ('female', 'male', 'intersex', 'unknown');
create type public.appointment_status as enum ('scheduled', 'arrived', 'in_room', 'completed', 'cancelled', 'no_show');
create type public.invoice_state as enum ('draft', 'issued', 'void');
create type public.insurance_status as enum ('none', 'pending', 'settled', 'denied');
create type public.payment_method as enum ('cash', 'card', 'bank_transfer', 'other');
create type public.prescription_status as enum ('draft', 'active', 'cancelled', 'dispensed');

-- ---------------------------------------------------------------------------
-- Clinics and people
-- ---------------------------------------------------------------------------
create table public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 200),
  timezone text not null default 'UTC',
  currency char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  consent_form_version text not null default 'v1',
  created_at timestamptz not null default now()
);

-- One profile per auth user. A user belongs to exactly one clinic in Phase 1.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id),
  role public.app_role not null,
  full_name text not null check (length(trim(full_name)) between 1 and 200),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, clinic_id)
);
create index profiles_clinic_role_idx on public.profiles (clinic_id, role);

-- Per-clinic counters for human-readable numbers (MRN, invoice no.).
create table app.clinic_counters (
  clinic_id uuid primary key references public.clinics (id) on delete cascade,
  next_mrn bigint not null default 1,
  next_invoice bigint not null default 1
);

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  mrn text not null,
  given_name text not null check (length(trim(given_name)) between 1 and 100),
  family_name text not null check (length(trim(family_name)) between 1 and 100),
  date_of_birth date not null check (date_of_birth >= '1900-01-01'),
  sex_at_birth public.sex_at_birth not null default 'unknown',
  phone text,
  email text,
  address text,
  -- Portal login for the patient role (Phase 3 portal; RLS uses it already).
  auth_user_id uuid unique references auth.users (id) on delete set null,
  -- Consent
  consent_treatment_at timestamptz,
  consent_data_processing_at timestamptz,
  consent_communication boolean not null default false,
  consent_version text,
  consent_recorded_by uuid references public.profiles (id),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, clinic_id),
  unique (clinic_id, mrn)
);
create index patients_clinic_name_idx on public.patients (clinic_id, family_name, given_name);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  name text not null check (length(trim(name)) between 1 and 60),
  kind text not null default 'consult' check (kind in ('consult', 'procedure', 'lab', 'other')),
  out_of_service boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, clinic_id),
  unique (clinic_id, name)
);

-- ---------------------------------------------------------------------------
-- Appointments
-- ---------------------------------------------------------------------------
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  patient_id uuid not null,
  doctor_id uuid not null,
  room_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.appointment_status not null default 'scheduled',
  reason text check (reason is null or length(reason) <= 500),
  checked_in_at timestamptz,
  checked_in_by uuid references public.profiles (id),
  roomed_at timestamptz,
  completed_at timestamptz,
  cancelled_reason text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, clinic_id),
  foreign key (patient_id, clinic_id) references public.patients (id, clinic_id),
  foreign key (doctor_id, clinic_id) references public.profiles (id, clinic_id),
  foreign key (room_id, clinic_id) references public.rooms (id, clinic_id),
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '8 hours'),
  -- Mirrors lib/rules/scheduling.ts: half-open ranges, cancelled/no-show release the slot.
  constraint appointments_no_doctor_overlap exclude using gist (
    doctor_id with =, tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status not in ('cancelled', 'no_show')),
  constraint appointments_no_room_overlap exclude using gist (
    room_id with =, tstzrange(starts_at, ends_at, '[)') with &&
  ) where (room_id is not null and status not in ('cancelled', 'no_show'))
);
create index appointments_clinic_day_idx on public.appointments (clinic_id, starts_at);
create index appointments_doctor_day_idx on public.appointments (doctor_id, starts_at);
create index appointments_patient_idx on public.appointments (patient_id, starts_at desc);

-- ---------------------------------------------------------------------------
-- Clinical
-- ---------------------------------------------------------------------------
create table public.consultations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  appointment_id uuid unique,
  patient_id uuid not null,
  doctor_id uuid not null,
  subjective text not null default '',
  objective text not null default '',
  assessment text not null default '',
  plan text not null default '',
  -- CLINICAL PLACEHOLDER: manual critical flag until Phase 2 result flagging.
  is_critical boolean not null default false,
  critical_reason text,
  signed_at timestamptz,
  signed_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, clinic_id),
  foreign key (appointment_id, clinic_id) references public.appointments (id, clinic_id),
  foreign key (patient_id, clinic_id) references public.patients (id, clinic_id),
  foreign key (doctor_id, clinic_id) references public.profiles (id, clinic_id),
  check (not is_critical or length(trim(coalesce(critical_reason, ''))) > 0),
  check ((signed_at is null) = (signed_by is null))
);
create index consultations_doctor_unsigned_idx on public.consultations (doctor_id) where signed_at is null;
create index consultations_patient_idx on public.consultations (patient_id, created_at desc);

-- Phase 1 stores prescriptions; allergy checking and dispensing come later.
create table public.prescriptions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  consultation_id uuid,
  patient_id uuid not null,
  prescriber_id uuid not null,
  drug_name text not null check (length(trim(drug_name)) between 1 and 200),
  dose text not null,
  route text not null,
  frequency text not null,
  duration_days integer check (duration_days is null or duration_days between 1 and 365),
  status public.prescription_status not null default 'draft',
  allergy_override_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, clinic_id),
  foreign key (consultation_id, clinic_id) references public.consultations (id, clinic_id),
  foreign key (patient_id, clinic_id) references public.patients (id, clinic_id),
  foreign key (prescriber_id, clinic_id) references public.profiles (id, clinic_id)
);
create index prescriptions_patient_idx on public.prescriptions (patient_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Billing (integer minor units only)
-- ---------------------------------------------------------------------------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  patient_id uuid not null,
  appointment_id uuid,
  number text not null,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  state public.invoice_state not null default 'draft',
  issued_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  insurance_status public.insurance_status not null default 'none',
  insurer_name text,
  insurance_claimed_minor bigint not null default 0 check (insurance_claimed_minor >= 0),
  insurance_paid_minor bigint not null default 0 check (insurance_paid_minor >= 0),
  insurance_settled_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, clinic_id),
  unique (clinic_id, number),
  foreign key (patient_id, clinic_id) references public.patients (id, clinic_id),
  foreign key (appointment_id, clinic_id) references public.appointments (id, clinic_id),
  check (insurance_paid_minor <= insurance_claimed_minor),
  check ((state = 'issued') = (issued_at is not null) or state = 'void'),
  check ((state = 'void') = (voided_at is not null)),
  check (insurance_status <> 'settled' or insurance_settled_at is not null)
);
create index invoices_clinic_state_idx on public.invoices (clinic_id, state, created_at desc);
create index invoices_patient_idx on public.invoices (patient_id);
create index invoices_appointment_idx on public.invoices (appointment_id);

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  invoice_id uuid not null,
  description text not null check (length(trim(description)) between 1 and 200),
  quantity integer not null check (quantity > 0 and quantity <= 10000),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  created_at timestamptz not null default now(),
  foreign key (invoice_id, clinic_id) references public.invoices (id, clinic_id) on delete cascade
);
create index invoice_lines_invoice_idx on public.invoice_lines (invoice_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  invoice_id uuid not null,
  amount_minor bigint not null check (amount_minor > 0),
  method public.payment_method not null,
  reference text check (reference is null or length(reference) <= 100),
  received_at timestamptz not null default now(),
  received_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  foreign key (invoice_id, clinic_id) references public.invoices (id, clinic_id)
);
create index payments_invoice_idx on public.payments (invoice_id);
