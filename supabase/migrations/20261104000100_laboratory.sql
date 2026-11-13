-- Phase 4: investigations (lab + imaging coordination), notifications.
-- Order -> specimen collection (accession) -> result entry -> independent review ->
-- publish -> amendments as new versions -> critical-result acknowledgement.
-- Manual entry only; analyser/PACS interfaces and PDF attachments are out of scope here.

alter table public.clinics add column critical_ack_minutes integer not null default 30 check (critical_ack_minutes between 1 and 1440);
alter table app.clinic_counters add column if not exists next_accession bigint not null default 1;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  user_id uuid not null references public.profiles (id),
  kind text not null,
  title text not null,
  link text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.lab_orders (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  patient_id uuid not null,
  admission_id uuid,
  ordered_by uuid not null,
  test_name text not null check (length(trim(test_name)) between 1 and 200),
  kind text not null default 'lab' check (kind in ('lab', 'imaging')),
  priority text not null default 'routine' check (priority in ('routine', 'urgent')),
  clinical_note text check (clinical_note is null or length(clinical_note) <= 500),
  status text not null default 'ordered' check (status in ('ordered', 'collected', 'resulted', 'published', 'cancelled')),
  accession text,
  collected_at timestamptz,
  collected_by uuid references public.profiles (id),
  cancel_reason text,
  ordered_at timestamptz not null default now(),
  unique (id, clinic_id),
  unique (clinic_id, accession),
  foreign key (patient_id, clinic_id) references public.patients (id, clinic_id),
  foreign key (admission_id, clinic_id) references public.admissions (id, clinic_id),
  foreign key (ordered_by, clinic_id) references public.profiles (id, clinic_id),
  check (status <> 'cancelled' or length(trim(coalesce(cancel_reason, ''))) >= 5),
  check ((accession is null) = (collected_at is null))
);
create index lab_orders_queue_idx on public.lab_orders (clinic_id, status, ordered_at);
create index lab_orders_patient_idx on public.lab_orders (patient_id, ordered_at desc);

create table public.lab_results (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  order_id uuid not null,
  patient_id uuid not null,
  version integer not null check (version >= 1),
  value text not null check (length(trim(value)) between 1 and 2000),
  unit text check (unit is null or length(unit) <= 30),
  reference_range text check (reference_range is null or length(reference_range) <= 100),
  flag text not null default 'normal' check (flag in ('normal', 'abnormal', 'critical')),
  note text check (note is null or length(note) <= 1000),
  amendment_reason text,
  state text not null default 'draft' check (state in ('draft', 'published', 'superseded')),
  entered_by uuid not null references public.profiles (id),
  entered_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles (id),
  published_at timestamptz,
  acknowledged_by uuid references public.profiles (id),
  acknowledged_at timestamptz,
  unique (order_id, version),
  unique (id, clinic_id),
  foreign key (order_id, clinic_id) references public.lab_orders (id, clinic_id),
  foreign key (patient_id, clinic_id) references public.patients (id, clinic_id),
  check (version = 1 or length(trim(coalesce(amendment_reason, ''))) >= 5),
  check ((state = 'draft') = (published_at is null and reviewed_by is null)),
  check (reviewed_by is null or reviewed_by <> entered_by),
  check ((acknowledged_by is null) = (acknowledged_at is null))
);
create index lab_results_order_idx on public.lab_results (order_id, version desc);

do $$
declare t text;
begin
  foreach t in array array['lab_orders','lab_results'] loop
    execute format('create trigger forbid_clinic_change before update on public.%I for each row execute function app.forbid_clinic_change()', t);
    execute format('create trigger audit_row after insert or update or delete on public.%I for each row execute function app.audit_row()', t);
    execute format('create trigger workflow_only before insert or update or delete on public.%I for each row execute function app.workflow_only()', t);
  end loop;
end $$;
create trigger workflow_only before insert or update or delete on public.notifications for each row execute function app.workflow_only();

create or replace function app.notify(p_clinic uuid, p_user uuid, p_kind text, p_title text, p_link text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (clinic_id, user_id, kind, title, link) values (p_clinic, p_user, p_kind, p_title, p_link)
$$;

-- ---------------------------------------------------------------------------
create or replace function public.place_order(p_patient uuid, p_admission uuid, p_test text, p_kind text, p_priority text, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); new_id uuid;
begin
  perform app.assert_role('doctor');
  if not exists (select 1 from public.patients where id = p_patient and clinic_id = clinic and archived_at is null) then
    raise exception 'Patient not found.' using errcode = 'P0002';
  end if;
  if p_admission is not null and not exists (select 1 from public.admissions where id = p_admission and clinic_id = clinic and patient_id = p_patient and status = 'admitted') then
    raise exception 'That admission is not current for this patient.' using errcode = '55000';
  end if;
  insert into public.lab_orders (clinic_id, patient_id, admission_id, ordered_by, test_name, kind, priority, clinical_note)
  values (clinic, p_patient, p_admission, auth.uid(), trim(p_test), p_kind, p_priority, nullif(trim(p_note), '')) returning lab_orders.id into new_id;
  return new_id;
end $$;

create or replace function public.collect_specimen(p_order uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); o public.lab_orders%rowtype; n bigint; acc text;
begin
  perform app.assert_role('lab', 'nurse', 'admin');
  select * into o from public.lab_orders where id = p_order and clinic_id = clinic for update;
  if not found then raise exception 'Order not found.' using errcode = 'P0002'; end if;
  if o.status <> 'ordered' then raise exception 'This order is already %.', o.status using errcode = '55000'; end if;
  insert into app.clinic_counters as c (clinic_id, next_accession) values (clinic, 2)
  on conflict (clinic_id) do update set next_accession = c.next_accession + 1 returning c.next_accession - 1 into n;
  acc := (case when o.kind = 'imaging' then 'IMG-' else 'ACC-' end) || lpad(n::text, 6, '0');
  update public.lab_orders set status = 'collected', accession = acc, collected_at = now(), collected_by = auth.uid() where id = p_order;
  return acc;
end $$;

create or replace function public.cancel_order(p_order uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); o public.lab_orders%rowtype;
begin
  perform app.assert_role('doctor', 'lab', 'admin');
  select * into o from public.lab_orders where id = p_order and clinic_id = clinic for update;
  if not found then raise exception 'Order not found.' using errcode = 'P0002'; end if;
  if o.status not in ('ordered', 'collected') then raise exception 'A result already exists. Amend it instead of cancelling the order.' using errcode = '55000'; end if;
  if app.role() = 'doctor' and o.ordered_by <> auth.uid() then raise exception 'Only the ordering doctor can cancel this order.' using errcode = '42501'; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Give a reason for cancelling.' using errcode = '23514'; end if;
  update public.lab_orders set status = 'cancelled', cancel_reason = trim(p_reason) where id = p_order;
end $$;

create or replace function public.enter_result(p_order uuid, p_value text, p_unit text, p_range text, p_flag text, p_note text, p_amend_reason text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); o public.lab_orders%rowtype; v integer;
begin
  perform app.assert_role('lab', 'admin');
  select * into o from public.lab_orders where id = p_order and clinic_id = clinic for update;
  if not found then raise exception 'Order not found.' using errcode = 'P0002'; end if;
  if o.status in ('ordered', 'cancelled') then raise exception 'Collect the specimen first (or the order was cancelled).' using errcode = '55000'; end if;
  if exists (select 1 from public.lab_results where order_id = p_order and state = 'draft') then
    raise exception 'A result is already waiting for review. Review it, or ask the person who entered it.' using errcode = '55000';
  end if;
  select coalesce(max(version), 0) + 1 into v from public.lab_results where order_id = p_order;
  if v > 1 and length(trim(coalesce(p_amend_reason, ''))) < 5 then raise exception 'Give a reason for the amendment.' using errcode = '23514'; end if;
  if v = 1 and o.status = 'published' then raise exception 'Unexpected state.' using errcode = '55000'; end if;
  insert into public.lab_results (clinic_id, order_id, patient_id, version, value, unit, reference_range, flag, note, amendment_reason, entered_by)
  values (clinic, p_order, o.patient_id, v, trim(p_value), nullif(trim(p_unit), ''), nullif(trim(p_range), ''), p_flag, nullif(trim(p_note), ''), nullif(trim(p_amend_reason), ''), auth.uid());
  if o.status = 'collected' then update public.lab_orders set status = 'resulted' where id = p_order; end if;
  return v;
end $$;

create or replace function public.publish_result(p_order uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); o public.lab_orders%rowtype; r public.lab_results%rowtype;
begin
  perform app.assert_role('lab', 'admin');
  select * into o from public.lab_orders where id = p_order and clinic_id = clinic for update;
  if not found then raise exception 'Order not found.' using errcode = 'P0002'; end if;
  select * into r from public.lab_results where order_id = p_order and state = 'draft';
  if not found then raise exception 'There is no result waiting for review.' using errcode = '55000'; end if;
  if r.entered_by = auth.uid() then
    raise exception 'A result must be reviewed by someone other than the person who entered it.' using errcode = '42501';
  end if;
  update public.lab_results set state = 'superseded' where order_id = p_order and state = 'published';
  update public.lab_results set state = 'published', reviewed_by = auth.uid(), published_at = now() where id = r.id;
  update public.lab_orders set status = 'published' where id = p_order;
  perform app.notify(clinic, o.ordered_by,
    case when r.flag = 'critical' then 'critical_result' when r.version > 1 then 'amended_result' else 'result' end,
    case when r.flag = 'critical' then 'CRITICAL result: ' when r.version > 1 then 'Amended result: ' else 'Result ready: ' end || o.test_name,
    '/investigations/' || o.id);
end $$;

create or replace function public.acknowledge_critical(p_order uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); r public.lab_results%rowtype;
begin
  perform app.assert_role('doctor');
  select r2.* into r from public.lab_results r2 where r2.order_id = p_order and r2.clinic_id = clinic and r2.state = 'published' for update;
  if not found then raise exception 'No published result.' using errcode = 'P0002'; end if;
  if r.flag <> 'critical' then raise exception 'This result is not critical.' using errcode = '55000'; end if;
  if r.acknowledged_at is not null then raise exception 'Already acknowledged.' using errcode = '55000'; end if;
  update public.lab_results set acknowledged_by = auth.uid(), acknowledged_at = now() where id = r.id;
end $$;

-- Critical results nobody has acknowledged within the clinic's window: escalation list.
create view public.overdue_critical_results with (security_invoker = true) as
select r.order_id, r.patient_id, r.clinic_id, r.published_at, o.test_name, o.ordered_by
from public.lab_results r
join public.lab_orders o on o.id = r.order_id
join public.clinics c on c.id = r.clinic_id
where r.state = 'published' and r.flag = 'critical' and r.acknowledged_at is null
  and r.published_at < now() - make_interval(mins => c.critical_ack_minutes);

create or replace function public.mark_notifications_read()
returns void language sql security definer set search_path = '' as $$
  update public.notifications set read_at = now() where user_id = auth.uid() and read_at is null
$$;
-- (workflow_only trigger would block this for clients; this function runs as owner.)

-- ---------------------------------------------------------------------------
alter table public.lab_orders enable row level security;
alter table public.lab_results enable row level security;
alter table public.notifications enable row level security;
revoke all on public.lab_orders, public.lab_results, public.notifications, public.overdue_critical_results from anon;
revoke insert, update, delete, truncate on public.lab_orders, public.lab_results, public.notifications from authenticated;

create policy lab_orders_select on public.lab_orders for select to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'doctor', 'nurse', 'lab')));
-- Doctors/nurses see only PUBLISHED or SUPERSEDED versions; lab and admin see drafts too; patients see their own published.
create policy lab_results_select on public.lab_results for select to authenticated
  using (clinic_id = (select app.clinic_id()) and (
    (select app.has_role('lab', 'admin')) or ((select app.has_role('doctor', 'nurse')) and state <> 'draft')
  ) or (patient_id = (select app.patient_id()) and state <> 'draft'));
create policy notifications_select on public.notifications for select to authenticated using (user_id = (select auth.uid()));

grant execute on function public.place_order(uuid, uuid, text, text, text, text), public.collect_specimen(uuid), public.cancel_order(uuid, text),
  public.enter_result(uuid, text, text, text, text, text, text), public.publish_result(uuid), public.acknowledge_critical(uuid),
  public.mark_notifications_read() to authenticated;
revoke all on function public.place_order(uuid, uuid, text, text, text, text), public.collect_specimen(uuid), public.cancel_order(uuid, text),
  public.enter_result(uuid, text, text, text, text, text, text), public.publish_result(uuid), public.acknowledge_critical(uuid),
  public.mark_notifications_read() from anon, public;
revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated;
