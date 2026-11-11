-- OPTIONAL demo data: ~90 past visits, invoices and lab orders for Cedar Lane,
-- so the analytics page has something to show. Not part of the default seed
-- (the test suite expects the small baseline). Safe to re-run: it removes its
-- own earlier rows first. Local development only.
--   npm run db:seed-demo-history
set session_replication_role = replica; -- insert exact historic timestamps without the live-workflow triggers

delete from public.payments where invoice_id in (select id from public.invoices where number like 'INV-D%');
delete from public.invoice_lines where invoice_id in (select id from public.invoices where number like 'INV-D%');
delete from public.invoices where number like 'INV-D%';
delete from public.lab_results where order_id in (select id from public.lab_orders where clinical_notes = 'demo-history');
delete from public.lab_orders where clinical_notes = 'demo-history';
delete from public.appointments where reason like 'DEMO %';

with params as (select 'aaaaaaaa-0000-4000-8000-000000000000'::uuid as clinic),
visits as (
  select i,
         (array['a2000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000003',
                'a2000000-0000-4000-8000-000000000004','a2000000-0000-4000-8000-000000000006','a2000000-0000-4000-8000-000000000007'])[1 + i % 6]::uuid as patient,
         (array['a0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000003'])[1 + i % 2]::uuid as doctor,
         date_trunc('day', now()) - ((1 + i % 45) || ' days')::interval + interval '8 hours' + (i % 20) * interval '25 minutes' as starts,
         -- waits 3-27 minutes, with an occasional very long one; visits 10-34 minutes
         case when i % 17 = 0 then 75 + (abs(hashtext('w' || i)) % 45) else 3 + (abs(hashtext('w' || i)) % 25) end as wait_min,
         10 + (abs(hashtext('v' || i)) % 25) as visit_min,
         case when i % 9 = 0 then 'no_show' when i % 13 = 0 then 'cancelled' else 'completed' end as outcome
    from generate_series(1, 90) i
)
insert into public.appointments (id, clinic_id, patient_id, doctor_id, starts_at, ends_at, status, reason, checked_in_at, roomed_at, completed_at, cancelled_reason)
select gen_random_uuid(), p.clinic, v.patient, v.doctor, v.starts, v.starts + interval '20 minutes', v.outcome::public.appointment_status, 'DEMO visit ' || v.i,
       case when v.outcome = 'completed' then v.starts - interval '2 minutes' end,
       case when v.outcome = 'completed' then v.starts - interval '2 minutes' + v.wait_min * interval '1 minute' end,
       case when v.outcome = 'completed' then v.starts - interval '2 minutes' + (v.wait_min + v.visit_min) * interval '1 minute' end,
       case when v.outcome = 'cancelled' then 'Patient cancelled' end
  from visits v cross join params p;

-- An invoice for most completed visits: ~60% paid in full, ~20% part paid, ~20% unpaid.
create temp table demo_invoices on commit drop as
  select gen_random_uuid() as invoice_id, d.appt_id, d.patient_id, d.completed_at, d.n,
         4000 + (abs(hashtext('t' || d.n)) % 8000) as total, abs(hashtext('p' || d.n)) % 10 as pay
    from (select a.id as appt_id, a.patient_id, a.completed_at, row_number() over (order by a.starts_at) as n
            from public.appointments a where a.reason like 'DEMO %' and a.status = 'completed') d
   where d.n % 10 not in (0, 7);

insert into public.invoices (id, clinic_id, patient_id, appointment_id, number, currency, state, issued_at)
select invoice_id, 'aaaaaaaa-0000-4000-8000-000000000000', patient_id, appt_id, 'INV-D' || lpad(n::text, 5, '0'), 'GBP', 'issued', completed_at
  from demo_invoices;
insert into public.invoice_lines (clinic_id, invoice_id, description, quantity, unit_price_minor)
select 'aaaaaaaa-0000-4000-8000-000000000000', invoice_id, 'Consultation', 1, total from demo_invoices;
insert into public.payments (clinic_id, invoice_id, amount_minor, method, received_at)
select 'aaaaaaaa-0000-4000-8000-000000000000', invoice_id, case when pay < 6 then total else total / 2 end, 'card', completed_at + interval '5 minutes'
  from demo_invoices where pay < 8;

-- Lab orders over the last month: turnaround 40-240 minutes, roughly one in seven critical.
with o as (
  select n, gen_random_uuid() as id,
         (array['a2000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000004','a2000000-0000-4000-8000-000000000006'])[1 + n % 3]::uuid as patient,
         now() - ((1 + n % 29) || ' days')::interval - ((n % 7) || ' hours')::interval as ordered,
         40 + (abs(hashtext('l' || n)) % 200) as turnaround, n % 7 = 0 as crit
    from generate_series(1, 30) n
), orders as (
  insert into public.lab_orders (id, clinic_id, patient_id, ordered_by, status, clinical_notes, ordered_at, collected_at)
  select id, 'aaaaaaaa-0000-4000-8000-000000000000', patient, 'a0000000-0000-4000-8000-000000000002', 'resulted', 'demo-history', ordered, ordered + interval '10 minutes' from o
  returning id
)
insert into public.lab_results (clinic_id, order_id, patient_id, test_type_id, unit, value, flag, entered_at, entered_by, acknowledged_at, acknowledged_by)
select 'aaaaaaaa-0000-4000-8000-000000000000', id, patient, 'a7000000-0000-4000-8000-000000000002', 'mmol/L',
       case when crit then 6.6 else 4.2 end, case when crit then 'critical_high' else 'normal' end,
       ordered + turnaround * interval '1 minute', 'a0000000-0000-4000-8000-000000000005',
       case when crit then ordered + (turnaround + 8 + abs(hashtext('a' || n)) % 90) * interval '1 minute' end,
       case when crit then 'a0000000-0000-4000-8000-000000000002'::uuid end
  from o;

set session_replication_role = origin;
