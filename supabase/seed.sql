-- Local development + test seed. NOT for production.
-- Two clinics so tests can prove nothing leaks between them.
-- Every demo account's password: tendwell-demo-pass
--
-- Clinic A  Cedar Lane Clinic   Europe/London     GBP
-- Clinic B  Northgate Health    America/New_York  USD

-- ---------------------------------------------------------------------------
-- Auth users
-- ---------------------------------------------------------------------------
create or replace function pg_temp.mk_user(p_id uuid, p_email text) returns void language plpgsql as $$
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, email_change_token_current,
    recovery_token, phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email,
    extensions.crypt('tendwell-demo-pass', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(),
    '', '', '', '', '', '', '', ''
  );
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), p_id, p_id::text,
          jsonb_build_object('sub', p_id::text, 'email', p_email, 'email_verified', true),
          'email', now(), now(), now());
end $$;

select pg_temp.mk_user('a0000000-0000-4000-8000-000000000001', 'admin@cedarlane.test');
select pg_temp.mk_user('a0000000-0000-4000-8000-000000000002', 'dr.okafor@cedarlane.test');
select pg_temp.mk_user('a0000000-0000-4000-8000-000000000003', 'dr.lindqvist@cedarlane.test');
select pg_temp.mk_user('a0000000-0000-4000-8000-000000000004', 'desk@cedarlane.test');
select pg_temp.mk_user('a0000000-0000-4000-8000-000000000005', 'lab@cedarlane.test');
select pg_temp.mk_user('a0000000-0000-4000-8000-000000000006', 'pharmacy@cedarlane.test');
select pg_temp.mk_user('a0000000-0000-4000-8000-000000000007', 'amal.haddad@patient.test');
select pg_temp.mk_user('a0000000-0000-4000-8000-000000000008', 'former.desk@cedarlane.test');
select pg_temp.mk_user('a0000000-0000-4000-8000-000000000009', 'nurse@cedarlane.test');
select pg_temp.mk_user('b0000000-0000-4000-8000-000000000009', 'nurse@northgate.test');
select pg_temp.mk_user('b0000000-0000-4000-8000-000000000001', 'admin@northgate.test');
select pg_temp.mk_user('b0000000-0000-4000-8000-000000000002', 'dr.reyes@northgate.test');
select pg_temp.mk_user('b0000000-0000-4000-8000-000000000004', 'desk@northgate.test');
select pg_temp.mk_user('b0000000-0000-4000-8000-000000000007', 'jon.price@patient.test');

-- ---------------------------------------------------------------------------
-- Clinics, staff, rooms
-- ---------------------------------------------------------------------------
insert into public.clinics (id, name, timezone, currency, consent_form_version) values
  ('aaaaaaaa-0000-4000-8000-000000000000', 'Cedar Lane Clinic', 'Europe/London', 'GBP', 'v2'),
  ('bbbbbbbb-0000-4000-8000-000000000000', 'Northgate Health', 'America/New_York', 'USD', 'v1');

insert into public.profiles (id, clinic_id, role, full_name, active) values
  ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000000', 'admin', 'Priya Natarajan', true),
  ('a0000000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000000', 'doctor', 'Dr. Chidi Okafor', true),
  ('a0000000-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000000', 'doctor', 'Dr. Maja Lindqvist', true),
  ('a0000000-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000000', 'receptionist', 'Tomás Ferreira', true),
  ('a0000000-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000000', 'lab', 'Hana Sato', true),
  ('a0000000-0000-4000-8000-000000000006', 'aaaaaaaa-0000-4000-8000-000000000000', 'pharmacist', 'Yusuf Demir', true),
  ('a0000000-0000-4000-8000-000000000007', 'aaaaaaaa-0000-4000-8000-000000000000', 'patient', 'Amal Haddad', true),
  ('a0000000-0000-4000-8000-000000000008', 'aaaaaaaa-0000-4000-8000-000000000000', 'receptionist', 'Former Desk', false),
  ('a0000000-0000-4000-8000-000000000009', 'aaaaaaaa-0000-4000-8000-000000000000', 'nurse', 'Mei Tanaka', true),
  ('b0000000-0000-4000-8000-000000000009', 'bbbbbbbb-0000-4000-8000-000000000000', 'nurse', 'Omar Ali', true),
  ('b0000000-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000000', 'admin', 'Grace Whitfield', true),
  ('b0000000-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000000', 'doctor', 'Dr. Luis Reyes', true),
  ('b0000000-0000-4000-8000-000000000004', 'bbbbbbbb-0000-4000-8000-000000000000', 'receptionist', 'Dana Kim', true),
  ('b0000000-0000-4000-8000-000000000007', 'bbbbbbbb-0000-4000-8000-000000000000', 'patient', 'Jon Price', true);

insert into public.rooms (id, clinic_id, name, kind, out_of_service) values
  ('a1000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000000', 'Room 1', 'consult', false),
  ('a1000000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000000', 'Room 2', 'consult', false),
  ('a1000000-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000000', 'Room 3', 'procedure', false),
  ('a1000000-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000000', 'Room 4', 'consult', true),
  ('b1000000-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000000', 'Exam A', 'consult', false);

-- ---------------------------------------------------------------------------
-- Patients (MRNs assigned by trigger)
-- ---------------------------------------------------------------------------
insert into public.patients (id, clinic_id, given_name, family_name, date_of_birth, sex_at_birth, phone, email,
                             auth_user_id, consent_treatment_at, consent_data_processing_at, consent_communication, consent_version)
values
  ('a2000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000000', 'Amal', 'Haddad', '1984-05-12', 'female',
   '+44 7700 900101', 'amal.haddad@patient.test', 'a0000000-0000-4000-8000-000000000007', now() - interval '200 days', now() - interval '200 days', true, 'v2'),
  ('a2000000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000000', 'George', 'Mensah', '1951-11-30', 'male',
   '+44 7700 900102', null, null, now() - interval '30 days', now() - interval '30 days', false, 'v2'),
  ('a2000000-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000000', 'Lena', 'Novak', '1996-02-03', 'female',
   null, 'lena.novak@example.test', null, now() - interval '400 days', now() - interval '400 days', true, 'v1'),
  ('a2000000-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000000', 'Ravi', 'Kapoor', '1978-08-21', 'male',
   '+44 7700 900104', null, null, now() - interval '10 days', now() - interval '10 days', false, 'v2'),
  ('a2000000-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000000', 'Sofia', 'Marin', '2015-06-14', 'female',
   '+44 7700 900105', null, null, null, null, false, null),
  ('a2000000-0000-4000-8000-000000000006', 'aaaaaaaa-0000-4000-8000-000000000000', 'Owen', 'Byrne', '1969-01-09', 'male',
   '+44 7700 900106', null, null, now() - interval '90 days', now() - interval '90 days', true, 'v2'),
  ('a2000000-0000-4000-8000-000000000007', 'aaaaaaaa-0000-4000-8000-000000000000', 'Ines', 'Duarte', '1990-12-01', 'female',
   null, null, null, now() - interval '5 days', now() - interval '5 days', false, 'v2'),
  ('b2000000-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000000', 'Jon', 'Price', '1988-03-17', 'male',
   '+1 555 0100', 'jon.price@patient.test', 'b0000000-0000-4000-8000-000000000007', now() - interval '60 days', now() - interval '60 days', true, 'v1'),
  ('b2000000-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000000', 'Maria', 'Alvarez', '1972-07-04', 'female',
   '+1 555 0101', null, null, now() - interval '60 days', now() - interval '60 days', false, 'v1');

-- ---------------------------------------------------------------------------
-- Appointments
-- ---------------------------------------------------------------------------
-- Times are relative to "now" (rounded to 5 minutes) so the demo board always
-- shows a live morning: someone in the room, people waiting, one late arrival.
create or replace function pg_temp.mk_appt(p_id uuid, p_clinic uuid, p_patient uuid, p_doctor uuid, p_room uuid,
                                           p_offset_min int, p_minutes int, p_reason text)
returns void language sql as $$
  insert into public.appointments (id, clinic_id, patient_id, doctor_id, room_id, starts_at, ends_at, reason)
  select p_id, p_clinic, p_patient, p_doctor, p_room, t, t + make_interval(mins => p_minutes), p_reason
  from (select date_bin('5 minutes', now(), timestamptz '2000-01-01') + make_interval(mins => p_offset_min) as t) x
$$;

-- Clinic A. Dr Okafor (...02) and Dr Lindqvist (...03).
select pg_temp.mk_appt('a3000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000000',
  'a2000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001',
  -1440, 20, 'Blood pressure review');                                        -- yesterday, completed, note unsigned
select pg_temp.mk_appt('a3000000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000000',
  'a2000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001',
  -40, 20, 'Follow-up: fatigue');                                              -- completed, still owes
select pg_temp.mk_appt('a3000000-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000000',
  'a2000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001',
  -15, 20, 'Palpitations');                                                    -- with doctor, critical
select pg_temp.mk_appt('a3000000-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000000',
  'a2000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000002',
  0, 30, 'Knee pain');                                                         -- waiting 18 min
select pg_temp.mk_appt('a3000000-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000000',
  'a2000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000002',
  30, 20, 'Repeat prescription');                                              -- waiting 4 min (early)
select pg_temp.mk_appt('a3000000-0000-4000-8000-000000000006', 'aaaaaaaa-0000-4000-8000-000000000000',
  'a2000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000003',
  -20, 15, 'Vaccination');                                                     -- expected, late, no consent
select pg_temp.mk_appt('a3000000-0000-4000-8000-000000000007', 'aaaaaaaa-0000-4000-8000-000000000000',
  'a2000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000003', null,
  60, 20, 'New patient');
select pg_temp.mk_appt('a3000000-0000-4000-8000-000000000008', 'aaaaaaaa-0000-4000-8000-000000000000',
  'a2000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000002',
  240, 20, 'Results discussion');
select pg_temp.mk_appt('a3000000-0000-4000-8000-000000000009', 'aaaaaaaa-0000-4000-8000-000000000000',
  'a2000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001',
  120, 20, 'Dressing change');
select pg_temp.mk_appt('a3000000-0000-4000-8000-000000000010', 'aaaaaaaa-0000-4000-8000-000000000000',
  'a2000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000002',
  1440, 20, 'Follow-up');                                                      -- tomorrow

-- Clinic B.
select pg_temp.mk_appt('b3000000-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000000',
  'b2000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001',
  -10, 20, 'Annual physical');
select pg_temp.mk_appt('b3000000-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000000',
  'b2000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001',
  60, 20, 'Back pain');

-- Move visits through the state machine (the trigger enforces every step).
update public.appointments set status = 'arrived' where id in (
  'a3000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000003',
  'a3000000-0000-4000-8000-000000000004', 'a3000000-0000-4000-8000-000000000005', 'b3000000-0000-4000-8000-000000000001');
update public.appointments set status = 'in_room' where id in (
  'a3000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000003');
update public.appointments set status = 'completed' where id in (
  'a3000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002');
-- Realistic timestamps (status unchanged, so no transition check fires).
update public.appointments set checked_in_at = starts_at - interval '8 minutes', roomed_at = starts_at + interval '2 minutes',
  completed_at = ends_at where status = 'completed';
update public.appointments set checked_in_at = now() - interval '25 minutes', roomed_at = now() - interval '6 minutes'
  where id = 'a3000000-0000-4000-8000-000000000003';
update public.appointments set checked_in_at = now() - interval '18 minutes' where id = 'a3000000-0000-4000-8000-000000000004';
update public.appointments set checked_in_at = now() - interval '4 minutes' where id = 'a3000000-0000-4000-8000-000000000005';

-- ---------------------------------------------------------------------------
-- Consultations
-- ---------------------------------------------------------------------------
-- Yesterday's note left unsigned (carried over), today's signed note, and a critical one.
insert into public.consultations (id, clinic_id, appointment_id, patient_id, doctor_id, subjective, objective, assessment, plan)
values ('a4000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000000', 'a3000000-0000-4000-8000-000000000001',
        'a2000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002',
        'Home readings 150s/90s.', 'BP 152/94 seated.', '', '');

insert into public.consultations (id, clinic_id, appointment_id, patient_id, doctor_id, subjective, objective, assessment, plan,
                                  signed_at, signed_by)
values ('a4000000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000000', 'a3000000-0000-4000-8000-000000000002',
        'a2000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002',
        'Tired for 3 weeks.', 'Pale conjunctivae.', 'Possible anaemia.', 'FBC, ferritin. Review in 1 week.',
        now() - interval '1 hour', 'a0000000-0000-4000-8000-000000000002');

insert into public.consultations (id, clinic_id, appointment_id, patient_id, doctor_id, subjective, objective, assessment, plan,
                                  is_critical, critical_reason)
values ('a4000000-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000000', 'a3000000-0000-4000-8000-000000000003',
        'a2000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000002',
        'Palpitations since this morning.', 'Irregular pulse 128.', '', '',
        true, 'Irregular pulse 128 - ECG now');

insert into public.consultations (id, clinic_id, patient_id, doctor_id, subjective, assessment, plan, signed_at, signed_by)
values ('b4000000-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000000', 'b2000000-0000-4000-8000-000000000001',
        'b0000000-0000-4000-8000-000000000002', 'Clinic B private note.', 'Well.', 'Routine.', now(), 'b0000000-0000-4000-8000-000000000002');

insert into public.prescriptions (id, clinic_id, consultation_id, patient_id, prescriber_id, drug_name, dose, route, frequency,
                                  duration_days, status)
values ('a5000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000000', 'a4000000-0000-4000-8000-000000000002',
        'a2000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002',
        'Ferrous sulfate', '200 mg', 'oral', 'twice daily', 30, 'active'),
       ('a5000000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000000', null,
        'a2000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002',
        'Draft drug', '1 tab', 'oral', 'daily', 7, 'draft');

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------
-- A: Amal (today, completed) - 80.00 consult + 2 x 12.50 test - insured 70.00 pending, paid 20.00 of her 35.00 share.
insert into public.invoices (id, clinic_id, patient_id, appointment_id)
values ('a6000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000000',
        'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002');
insert into public.invoice_lines (clinic_id, invoice_id, description, quantity, unit_price_minor) values
  ('aaaaaaaa-0000-4000-8000-000000000000', 'a6000000-0000-4000-8000-000000000001', 'Follow-up consultation', 1, 8000),
  ('aaaaaaaa-0000-4000-8000-000000000000', 'a6000000-0000-4000-8000-000000000001', 'Point-of-care test', 2, 1250);
update public.invoices set state = 'issued', insurance_status = 'pending', insurer_name = 'Meridian Mutual',
  insurance_claimed_minor = 7000 where id = 'a6000000-0000-4000-8000-000000000001';
insert into public.payments (clinic_id, invoice_id, amount_minor, method)
values ('aaaaaaaa-0000-4000-8000-000000000000', 'a6000000-0000-4000-8000-000000000001', 2000, 'card');

-- A: George (yesterday) - 60.00, insured 50.00, insurer settled for 42.00, patient paid 10.00 => paid.
insert into public.invoices (id, clinic_id, patient_id, appointment_id)
values ('a6000000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000000',
        'a2000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000001');
insert into public.invoice_lines (clinic_id, invoice_id, description, quantity, unit_price_minor) values
  ('aaaaaaaa-0000-4000-8000-000000000000', 'a6000000-0000-4000-8000-000000000002', 'Review consultation', 1, 6000);
update public.invoices set state = 'issued', insurance_status = 'pending', insurer_name = 'Meridian Mutual',
  insurance_claimed_minor = 5000 where id = 'a6000000-0000-4000-8000-000000000002';
insert into public.payments (clinic_id, invoice_id, amount_minor, method)
values ('aaaaaaaa-0000-4000-8000-000000000000', 'a6000000-0000-4000-8000-000000000002', 1000, 'cash');
update public.invoices set insurance_status = 'settled', insurance_paid_minor = 4200
  where id = 'a6000000-0000-4000-8000-000000000002';

-- A: draft invoice for Ravi (in room now).
insert into public.invoices (id, clinic_id, patient_id, appointment_id)
values ('a6000000-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000000',
        'a2000000-0000-4000-8000-000000000004', 'a3000000-0000-4000-8000-000000000003');
insert into public.invoice_lines (clinic_id, invoice_id, description, quantity, unit_price_minor) values
  ('aaaaaaaa-0000-4000-8000-000000000000', 'a6000000-0000-4000-8000-000000000003', 'Consultation', 1, 8000);

-- B: Jon - 150.00, unpaid.
insert into public.invoices (id, clinic_id, patient_id, appointment_id)
values ('b6000000-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000000',
        'b2000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001');
insert into public.invoice_lines (clinic_id, invoice_id, description, quantity, unit_price_minor) values
  ('bbbbbbbb-0000-4000-8000-000000000000', 'b6000000-0000-4000-8000-000000000001', 'Annual physical', 1, 15000);
update public.invoices set state = 'issued' where id = 'b6000000-0000-4000-8000-000000000001';


-- ---------------------------------------------------------------------------
-- Phase 2: inpatient demo data (synthetic)
-- ---------------------------------------------------------------------------
insert into public.wards (id, clinic_id, name, kind) values
  ('a7000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000000', 'Ward 1 General', 'general'),
  ('a7000000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000000', 'High dependency', 'icu'),
  ('b7000000-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000000', 'North Ward', 'general');

insert into public.beds (id, clinic_id, ward_id, label, out_of_service, housekeeping) values
  ('a8000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000000', 'a7000000-0000-4000-8000-000000000001', 'W1-01', false, 'clean'),
  ('a8000000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000000', 'a7000000-0000-4000-8000-000000000001', 'W1-02', false, 'clean'),
  ('a8000000-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000000', 'a7000000-0000-4000-8000-000000000001', 'W1-03', false, 'dirty'),
  ('a8000000-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000000', 'a7000000-0000-4000-8000-000000000001', 'W1-04', true, 'clean'),
  ('a8000000-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000000', 'a7000000-0000-4000-8000-000000000002', 'HDU-01', false, 'clean'),
  ('b8000000-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000000', 'b7000000-0000-4000-8000-000000000001', 'N-01', false, 'clean');

-- A: George is in W1-01 (elective, deposit referenced). Owen is waiting for a bed. Ines is an emergency request.
insert into public.admissions (id, clinic_id, patient_id, attending_id, admission_type, reason, deposit_reference, expected_discharge_on) values
  ('a9000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000000', 'a2000000-0000-4000-8000-000000000002',
   'a0000000-0000-4000-8000-000000000002', 'elective', 'Planned hip replacement recovery', 'DEP-1001', current_date + 3),
  ('a9000000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000000', 'a2000000-0000-4000-8000-000000000006',
   'a0000000-0000-4000-8000-000000000003', 'elective', 'Observation after cardiac procedure', 'DEP-1042', null),
  ('a9000000-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000000', 'a2000000-0000-4000-8000-000000000007',
   'a0000000-0000-4000-8000-000000000002', 'emergency', 'Acute abdominal pain', null, null),
  ('b9000000-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000000', 'b2000000-0000-4000-8000-000000000002',
   'b0000000-0000-4000-8000-000000000002', 'emergency', 'Chest pain, rule out cardiac cause', null, null);

insert into public.bed_stays (clinic_id, admission_id, patient_id, bed_id, starts_at, reason) values
  ('aaaaaaaa-0000-4000-8000-000000000000', 'a9000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002',
   'a8000000-0000-4000-8000-000000000001', now() - interval '2 days', 'admission'),
  ('bbbbbbbb-0000-4000-8000-000000000000', 'b9000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000002',
   'b8000000-0000-4000-8000-000000000001', now() - interval '3 hours', 'admission');
update public.admissions set status = 'admitted', admitted_at = now() - interval '2 days' where id = 'a9000000-0000-4000-8000-000000000001';
update public.admissions set status = 'admitted', admitted_at = now() - interval '3 hours' where id = 'b9000000-0000-4000-8000-000000000001';

insert into public.care_tasks (clinic_id, admission_id, patient_id, title, due_at) values
  ('aaaaaaaa-0000-4000-8000-000000000000', 'a9000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'Mobilise with physiotherapist', now() + interval '1 hour'),
  ('aaaaaaaa-0000-4000-8000-000000000000', 'a9000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'Wound dressing check', now() - interval '30 minutes');
insert into public.observations (clinic_id, admission_id, patient_id, recorded_by, systolic, diastolic, pulse, resp_rate, temp_c, spo2) values
  ('aaaaaaaa-0000-4000-8000-000000000000', 'a9000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002',
   'a0000000-0000-4000-8000-000000000009', 128, 76, 72, 16, 36.8, 97);

-- ---------------------------------------------------------------------------
-- Phase 3: billing demo data (synthetic)
-- ---------------------------------------------------------------------------
insert into public.tariff_versions (id, clinic_id, name, effective_from, status, activated_at) values
  ('ab000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000000', 'Standard 2026', '2026-01-01', 'draft', null),
  ('bb000000-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000000', 'Standard 2026', '2026-01-01', 'draft', null);
insert into public.tariff_items (clinic_id, version_id, code, description, category, unit_price_minor) values
  ('aaaaaaaa-0000-4000-8000-000000000000', 'ab000000-0000-4000-8000-000000000001', 'BED-GEN', 'General ward bed, per day', 'bed', 12000),
  ('aaaaaaaa-0000-4000-8000-000000000000', 'ab000000-0000-4000-8000-000000000001', 'CONS', 'Specialist consultation', 'consultation', 8000),
  ('aaaaaaaa-0000-4000-8000-000000000000', 'ab000000-0000-4000-8000-000000000001', 'DRESS', 'Wound dressing', 'service', 1500),
  ('bbbbbbbb-0000-4000-8000-000000000000', 'bb000000-0000-4000-8000-000000000001', 'BED-GEN', 'General ward bed, per day', 'bed', 20000);
update public.tariff_versions set status = 'active', activated_at = now() where id in ('ab000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001');
insert into public.deposits (id, clinic_id, patient_id, admission_id, amount_minor, method, reference, received_by) values
  ('ac000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000000', 'a2000000-0000-4000-8000-000000000002',
   'a9000000-0000-4000-8000-000000000001', 50000, 'card', 'DEP-1001', 'a0000000-0000-4000-8000-000000000004');
insert into public.charges (clinic_id, patient_id, admission_id, tariff_version_id, item_code, category, description, unit_price_minor, quantity, captured_by) values
  ('aaaaaaaa-0000-4000-8000-000000000000', 'a2000000-0000-4000-8000-000000000002', 'a9000000-0000-4000-8000-000000000001',
   'ab000000-0000-4000-8000-000000000001', 'DRESS', 'service', 'Wound dressing', 1500, 2, 'a0000000-0000-4000-8000-000000000009');
