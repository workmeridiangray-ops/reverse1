-- Phase 6: theatre / procedures. Request -> schedule (room + team, conflict-checked by
-- the database) -> checklist + consent -> start -> notes (versioned) -> recovery -> done.
-- Software ticks record WHO said a check was done; they are not clinical assurance.

create table public.procedures (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  patient_id uuid not null,
  admission_id uuid,
  surgeon_id uuid not null,
  name text not null check (length(trim(name)) between 3 and 200),
  urgency text not null default 'elective' check (urgency in ('elective', 'urgent', 'emergency')),
  status text not null default 'requested' check (status in ('requested', 'scheduled', 'in_progress', 'recovery', 'completed', 'cancelled')),
  room_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  version integer not null default 1,
  started_at timestamptz,
  recovery_at timestamptz,
  completed_at timestamptz,
  start_override_reason text,
  cancel_reason text,
  requested_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (id, clinic_id),
  unique (id, clinic_id, patient_id),
  foreign key (patient_id, clinic_id) references public.patients (id, clinic_id),
  foreign key (admission_id, clinic_id) references public.admissions (id, clinic_id),
  foreign key (surgeon_id, clinic_id) references public.profiles (id, clinic_id),
  foreign key (room_id, clinic_id) references public.rooms (id, clinic_id),
  check (ends_at is null or ends_at > starts_at),
  check (ends_at is null or ends_at - starts_at <= interval '16 hours'),
  check (status not in ('scheduled', 'in_progress', 'recovery', 'completed') or (room_id is not null and starts_at is not null and ends_at is not null)),
  check (status <> 'cancelled' or length(trim(coalesce(cancel_reason, ''))) >= 5),
  constraint procedures_no_room_overlap exclude using gist (room_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
    where (room_id is not null and status in ('scheduled', 'in_progress')),
  constraint procedures_no_patient_overlap exclude using gist (patient_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
    where (starts_at is not null and status in ('scheduled', 'in_progress', 'recovery'))
);
create index procedures_day_idx on public.procedures (clinic_id, starts_at);

create table public.procedure_team (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  procedure_id uuid not null,
  user_id uuid not null,
  team_role text not null check (team_role in ('surgeon', 'anaesthetist', 'scrub_nurse', 'circulating_nurse', 'assistant')),
  during tstzrange not null,
  active boolean not null default true,
  foreign key (procedure_id, clinic_id) references public.procedures (id, clinic_id),
  foreign key (user_id, clinic_id) references public.profiles (id, clinic_id),
  constraint procedure_team_no_staff_overlap exclude using gist (user_id with =, during with &&) where (active)
);
create index procedure_team_proc_idx on public.procedure_team (procedure_id);

create table public.procedure_checklist (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  procedure_id uuid not null,
  item text not null,
  done_by uuid references public.profiles (id),
  done_at timestamptz,
  unique (procedure_id, item),
  foreign key (procedure_id, clinic_id) references public.procedures (id, clinic_id),
  check ((done_by is null) = (done_at is null))
);

create table public.procedure_consents (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  procedure_id uuid not null,
  patient_id uuid not null,
  consenter_name text not null check (length(trim(consenter_name)) between 2 and 120),
  relationship text not null check (relationship in ('self', 'guardian', 'legal_proxy')),
  method text not null check (method in ('written', 'verbal_witnessed')),
  witness_name text check (witness_name is null or length(trim(witness_name)) >= 2),
  evidence_ref text not null check (length(trim(evidence_ref)) between 2 and 200),
  obtained_by uuid not null references public.profiles (id),
  obtained_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  withdrawn_reason text,
  foreign key (procedure_id, clinic_id, patient_id) references public.procedures (id, clinic_id, patient_id),
  check (method = 'written' or witness_name is not null),
  check ((withdrawn_at is null) = (withdrawn_reason is null))
);
create unique index procedure_consent_one_active on public.procedure_consents (procedure_id) where withdrawn_at is null;

create table public.procedure_notes (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id),
  procedure_id uuid not null,
  version integer not null,
  body text not null check (length(trim(body)) >= 10),
  amendment_reason text,
  written_by uuid not null references public.profiles (id),
  written_at timestamptz not null default now(),
  unique (procedure_id, version),
  foreign key (procedure_id, clinic_id) references public.procedures (id, clinic_id),
  check (version = 1 or length(trim(coalesce(amendment_reason, ''))) >= 5)
);

-- Late changes stay visible.
create table public.procedure_changes (
  id bigint generated always as identity primary key,
  clinic_id uuid not null references public.clinics (id),
  procedure_id uuid not null,
  change text not null,
  reason text,
  by_user uuid references public.profiles (id),
  at timestamptz not null default now(),
  foreign key (procedure_id, clinic_id) references public.procedures (id, clinic_id)
);

do $$
declare t text;
begin
  foreach t in array array['procedures','procedure_team','procedure_checklist','procedure_consents','procedure_notes','procedure_changes'] loop
    execute format('create trigger forbid_clinic_change before update on public.%I for each row execute function app.forbid_clinic_change()', t);
    execute format('create trigger workflow_only before insert or update or delete on public.%I for each row execute function app.workflow_only()', t);
  end loop;
  foreach t in array array['procedures','procedure_consents','procedure_notes','procedure_checklist'] loop
    execute format('create trigger audit_row after insert or update or delete on public.%I for each row execute function app.audit_row()', t);
  end loop;
end $$;
create trigger immutable_row before update or delete on public.procedure_notes for each row execute function app.immutable_row();
create trigger immutable_row before update or delete on public.procedure_changes for each row execute function app.immutable_row();

create or replace function app.log_change(p_clinic uuid, p_proc uuid, p_change text, p_reason text)
returns void language sql security definer set search_path = '' as $$
  insert into public.procedure_changes (clinic_id, procedure_id, change, reason, by_user) values (p_clinic, p_proc, p_change, nullif(trim(p_reason), ''), auth.uid())
$$;

-- ---------------------------------------------------------------------------
create or replace function public.request_procedure(p_patient uuid, p_admission uuid, p_surgeon uuid, p_name text, p_urgency text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); new_id uuid;
begin
  perform app.assert_role('doctor');
  if not exists (select 1 from public.patients where id = p_patient and clinic_id = clinic and archived_at is null) then raise exception 'Patient not found.' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.profiles where id = p_surgeon and clinic_id = clinic and role = 'doctor' and active) then raise exception 'The surgeon must be an active doctor.' using errcode = '23514'; end if;
  if p_admission is not null and not exists (select 1 from public.admissions where id = p_admission and clinic_id = clinic and patient_id = p_patient and status in ('requested', 'admitted')) then
    raise exception 'That admission is not open for this patient.' using errcode = '55000';
  end if;
  insert into public.procedures (clinic_id, patient_id, admission_id, surgeon_id, name, urgency, requested_by)
  values (clinic, p_patient, p_admission, p_surgeon, trim(p_name), p_urgency, auth.uid()) returning procedures.id into new_id;
  perform app.log_change(clinic, new_id, 'Requested', null);
  return new_id;
end $$;

-- p_team: jsonb array of {"user":"<uuid>","role":"anaesthetist"}; the surgeon is added automatically.
create or replace function public.schedule_procedure(p_proc uuid, p_room uuid, p_start timestamptz, p_end timestamptz, p_team jsonb, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); pr public.procedures%rowtype; t jsonb; rng tstzrange; first_time boolean; rm public.rooms%rowtype; urole public.app_role;
begin
  perform app.assert_role('admin', 'nurse');
  select * into pr from public.procedures where id = p_proc and clinic_id = clinic for update;
  if not found then raise exception 'Procedure not found.' using errcode = 'P0002'; end if;
  if pr.status not in ('requested', 'scheduled') then raise exception 'A procedure that has started or finished can no longer be rescheduled.' using errcode = '55000'; end if;
  first_time := pr.status = 'requested';
  if not first_time and length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Give a reason for changing a scheduled procedure.' using errcode = '23514'; end if;
  if p_end <= p_start then raise exception 'The end must be after the start.' using errcode = '22023'; end if;
  if p_start < now() - interval '5 minutes' and pr.urgency <> 'emergency' then raise exception 'That start time has already passed.' using errcode = '22023'; end if;
  select * into rm from public.rooms where id = p_room and clinic_id = clinic;
  if not found or rm.kind <> 'procedure' then raise exception 'Choose a procedure room.' using errcode = '23514'; end if;
  if rm.out_of_service then raise exception '% is out of service.', rm.name using errcode = '55000'; end if;
  rng := tstzrange(p_start, p_end, '[)');
  update public.procedure_team set active = false where procedure_id = p_proc;
  update public.procedures set room_id = p_room, starts_at = p_start, ends_at = p_end, status = 'scheduled', version = version + 1 where id = p_proc;
  insert into public.procedure_team (clinic_id, procedure_id, user_id, team_role, during) values (clinic, p_proc, pr.surgeon_id, 'surgeon', rng);
  for t in select * from jsonb_array_elements(coalesce(p_team, '[]'::jsonb)) loop
    select role into urole from public.profiles where id = (t ->> 'user')::uuid and clinic_id = clinic and active;
    if urole is null then raise exception 'A team member was not found.' using errcode = 'P0002'; end if;
    if (t ->> 'user')::uuid = pr.surgeon_id then continue; end if;
    insert into public.procedure_team (clinic_id, procedure_id, user_id, team_role, during) values (clinic, p_proc, (t ->> 'user')::uuid, t ->> 'role', rng);
  end loop;
  if first_time then
    insert into public.procedure_checklist (clinic_id, procedure_id, item) select clinic, p_proc, i from unnest(array[
      'Patient identity confirmed against wristband and record', 'Procedure and site confirmed with patient', 'Allergies reviewed',
      'Fasting status confirmed', 'Equipment and implants ready']) i;
  end if;
  perform app.log_change(clinic, p_proc, case when first_time then 'Scheduled' else 'Rescheduled' end || ' ' || to_char(p_start, 'YYYY-MM-DD HH24:MI') || ' in ' || rm.name, p_reason);
end $$;

create or replace function public.tick_checklist(p_item uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); n integer;
begin
  perform app.assert_role('nurse', 'doctor');
  update public.procedure_checklist c set done_by = auth.uid(), done_at = now()
   where c.id = p_item and c.clinic_id = clinic and c.done_at is null
     and exists (select 1 from public.procedures p where p.id = c.procedure_id and p.status = 'scheduled');
  get diagnostics n = row_count;
  if n = 0 then raise exception 'That item is already done, or the procedure is not scheduled.' using errcode = '55000'; end if;
end $$;

create or replace function public.record_consent(p_proc uuid, p_name text, p_relationship text, p_method text, p_witness text, p_evidence text)
returns void language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); pr public.procedures%rowtype;
begin
  perform app.assert_role('doctor');
  select * into pr from public.procedures where id = p_proc and clinic_id = clinic for update;
  if not found then raise exception 'Procedure not found.' using errcode = 'P0002'; end if;
  if pr.status not in ('requested', 'scheduled') then raise exception 'Consent must be recorded before the procedure starts.' using errcode = '55000'; end if;
  insert into public.procedure_consents (clinic_id, procedure_id, patient_id, consenter_name, relationship, method, witness_name, evidence_ref, obtained_by)
  values (clinic, p_proc, pr.patient_id, trim(p_name), p_relationship, p_method, nullif(trim(p_witness), ''), trim(p_evidence), auth.uid());
  perform app.log_change(clinic, p_proc, 'Consent recorded (' || p_method || ')', null);
end $$;

create or replace function public.withdraw_consent(p_proc uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); n integer; st text;
begin
  perform app.assert_role('doctor', 'admin');
  select status into st from public.procedures where id = p_proc and clinic_id = clinic for update;
  if st is null then raise exception 'Procedure not found.' using errcode = 'P0002'; end if;
  if st not in ('requested', 'scheduled') then raise exception 'The procedure has already started.' using errcode = '55000'; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Give a reason.' using errcode = '23514'; end if;
  update public.procedure_consents set withdrawn_at = now(), withdrawn_reason = trim(p_reason) where procedure_id = p_proc and withdrawn_at is null;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'There is no active consent.' using errcode = '55000'; end if;
  perform app.log_change(clinic, p_proc, 'Consent withdrawn', p_reason);
end $$;

create or replace function public.start_procedure(p_proc uuid, p_override_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); pr public.procedures%rowtype; open_items integer; has_consent boolean; problems text[] := '{}';
begin
  perform app.assert_role('doctor', 'nurse');
  select * into pr from public.procedures where id = p_proc and clinic_id = clinic for update;
  if not found then raise exception 'Procedure not found.' using errcode = 'P0002'; end if;
  if pr.status <> 'scheduled' then raise exception 'Only a scheduled procedure can start.' using errcode = '55000'; end if;
  select count(*) into open_items from public.procedure_checklist where procedure_id = p_proc and done_at is null;
  select exists (select 1 from public.procedure_consents where procedure_id = p_proc and withdrawn_at is null) into has_consent;
  if open_items > 0 then problems := problems || (open_items || ' checklist item(s) not done'); end if;
  if not has_consent then problems := problems || 'no consent recorded'::text; end if;
  if cardinality(problems) > 0 then
    -- The hospital defines emergencies; only an emergency may proceed with a documented reason.
    if pr.urgency = 'emergency' and length(trim(coalesce(p_override_reason, ''))) >= 10 then
      update public.procedures set start_override_reason = trim(p_override_reason) where id = p_proc;
      perform app.log_change(clinic, p_proc, 'Emergency start with open items: ' || array_to_string(problems, ', '), p_override_reason);
    else
      raise exception 'Cannot start: %.', array_to_string(problems, '; ') using errcode = '55000';
    end if;
  end if;
  update public.procedures set status = 'in_progress', started_at = now() where id = p_proc;
  perform app.log_change(clinic, p_proc, 'Started', null);
end $$;

create or replace function public.write_procedure_note(p_proc uuid, p_body text, p_reason text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); pr public.procedures%rowtype; v integer;
begin
  perform app.assert_role('doctor');
  select * into pr from public.procedures where id = p_proc and clinic_id = clinic for update;
  if not found then raise exception 'Procedure not found.' using errcode = 'P0002'; end if;
  if pr.status not in ('in_progress', 'recovery', 'completed') then raise exception 'The procedure has not started.' using errcode = '55000'; end if;
  select coalesce(max(version), 0) + 1 into v from public.procedure_notes where procedure_id = p_proc;
  insert into public.procedure_notes (clinic_id, procedure_id, version, body, amendment_reason, written_by) values (clinic, p_proc, v, trim(p_body), nullif(trim(p_reason), ''), auth.uid());
  if v > 1 then perform app.log_change(clinic, p_proc, 'Procedure note amended (v' || v || ')', p_reason); end if;
  return v;
end $$;

create or replace function public.move_to_recovery(p_proc uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); pr public.procedures%rowtype;
begin
  perform app.assert_role('doctor', 'nurse');
  select * into pr from public.procedures where id = p_proc and clinic_id = clinic for update;
  if not found then raise exception 'Procedure not found.' using errcode = 'P0002'; end if;
  if pr.status <> 'in_progress' then raise exception 'Only a procedure in progress can move to recovery.' using errcode = '55000'; end if;
  if not exists (select 1 from public.procedure_notes where procedure_id = p_proc) then raise exception 'The surgeon must write the procedure note first.' using errcode = '55000'; end if;
  update public.procedures set status = 'recovery', recovery_at = now() where id = p_proc;
  perform app.log_change(clinic, p_proc, 'Moved to recovery', null);
end $$;

create or replace function public.complete_recovery(p_proc uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); st text;
begin
  perform app.assert_role('nurse', 'doctor');
  select status into st from public.procedures where id = p_proc and clinic_id = clinic for update;
  if st is null then raise exception 'Procedure not found.' using errcode = 'P0002'; end if;
  if st <> 'recovery' then raise exception 'The patient is not in recovery.' using errcode = '55000'; end if;
  update public.procedures set status = 'completed', completed_at = now() where id = p_proc;
  perform app.log_change(clinic, p_proc, 'Recovery complete', null);
end $$;

create or replace function public.cancel_procedure(p_proc uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); st text;
begin
  perform app.assert_role('doctor', 'admin', 'nurse');
  select status into st from public.procedures where id = p_proc and clinic_id = clinic for update;
  if st is null then raise exception 'Procedure not found.' using errcode = 'P0002'; end if;
  if st not in ('requested', 'scheduled') then raise exception 'Only a procedure that has not started can be cancelled.' using errcode = '55000'; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Give a reason for cancelling.' using errcode = '23514'; end if;
  update public.procedure_team set active = false where procedure_id = p_proc;
  update public.procedures set status = 'cancelled', cancel_reason = trim(p_reason) where id = p_proc;
  perform app.log_change(clinic, p_proc, 'Cancelled', p_reason);
end $$;

-- ---------------------------------------------------------------------------
alter table public.procedures enable row level security;
alter table public.procedure_team enable row level security;
alter table public.procedure_checklist enable row level security;
alter table public.procedure_consents enable row level security;
alter table public.procedure_notes enable row level security;
alter table public.procedure_changes enable row level security;
revoke all on public.procedures, public.procedure_team, public.procedure_checklist, public.procedure_consents, public.procedure_notes, public.procedure_changes from anon;
revoke insert, update, delete, truncate on public.procedures, public.procedure_team, public.procedure_checklist, public.procedure_consents, public.procedure_notes, public.procedure_changes from authenticated;

create policy procedures_select on public.procedures for select to authenticated using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'doctor', 'nurse')));
create policy procedure_team_select on public.procedure_team for select to authenticated using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'doctor', 'nurse')));
create policy procedure_checklist_select on public.procedure_checklist for select to authenticated using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'doctor', 'nurse')));
create policy procedure_consents_select on public.procedure_consents for select to authenticated using (clinic_id = (select app.clinic_id()) and (select app.has_role('doctor', 'nurse')));
create policy procedure_notes_select on public.procedure_notes for select to authenticated using (clinic_id = (select app.clinic_id()) and (select app.has_role('doctor', 'nurse')));
create policy procedure_changes_select on public.procedure_changes for select to authenticated using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin', 'doctor', 'nurse')));

grant execute on function public.request_procedure(uuid, uuid, uuid, text, text), public.schedule_procedure(uuid, uuid, timestamptz, timestamptz, jsonb, text),
  public.tick_checklist(uuid), public.record_consent(uuid, text, text, text, text, text), public.withdraw_consent(uuid, text),
  public.start_procedure(uuid, text), public.write_procedure_note(uuid, text, text), public.move_to_recovery(uuid), public.complete_recovery(uuid),
  public.cancel_procedure(uuid, text) to authenticated;
revoke all on function public.request_procedure(uuid, uuid, uuid, text, text), public.schedule_procedure(uuid, uuid, timestamptz, timestamptz, jsonb, text),
  public.tick_checklist(uuid), public.record_consent(uuid, text, text, text, text, text), public.withdraw_consent(uuid, text),
  public.start_procedure(uuid, text), public.write_procedure_note(uuid, text, text), public.move_to_recovery(uuid), public.complete_recovery(uuid),
  public.cancel_procedure(uuid, text) from anon, public;
revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated;

-- Nurses coordinate theatre lists, so they may see procedure rooms (and only those).
create policy rooms_select_nurse_procedure on public.rooms for select to authenticated
  using (clinic_id = (select app.clinic_id()) and kind = 'procedure' and (select app.has_role('nurse')));
