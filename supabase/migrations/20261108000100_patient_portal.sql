-- Phase 8: patient portal. Patients see only what has been reviewed and released:
-- published lab results (Phase 4), issued invoices and active prescriptions (Phase 1),
-- and discharge summaries a DOCTOR has explicitly shared. Nothing else.
alter table public.admission_summaries add column shared_at timestamptz, add column shared_by uuid references public.profiles (id);

create or replace function public.share_discharge_summary(p_admission uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare clinic uuid := app.clinic_id(); st text;
begin
  perform app.assert_role('doctor');
  select a.status into st from public.admissions a where a.id = p_admission and a.clinic_id = clinic;
  if st is null then raise exception 'Admission not found.' using errcode = 'P0002'; end if;
  if st <> 'discharged' then raise exception 'A summary can be shared once the patient has been discharged.' using errcode = '55000'; end if;
  update public.admission_summaries set shared_at = now(), shared_by = auth.uid() where admission_id = p_admission and shared_at is null;
  if not found then raise exception 'There is no unshared summary for this admission.' using errcode = '55000'; end if;
end $$;
revoke all on function public.share_discharge_summary(uuid) from anon, public;
grant execute on function public.share_discharge_summary(uuid) to authenticated;

create policy admission_summaries_patient on public.admission_summaries for select to authenticated
  using (shared_at is not null and patient_id = (select app.patient_id()));
