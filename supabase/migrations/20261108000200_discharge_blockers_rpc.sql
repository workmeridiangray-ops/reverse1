-- The discharge page must show what the DATABASE will enforce, including facts the viewer
-- may not read (reception cannot read the clinical summary). Returns blockers only, no clinical text.
create or replace function public.discharge_blockers(p_admission uuid)
returns text[] language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.assert_role('admin', 'receptionist', 'doctor', 'nurse', 'pharmacist');
  if not exists (select 1 from public.admissions where id = p_admission and clinic_id = app.clinic_id()) then
    raise exception 'Admission not found.' using errcode = 'P0002';
  end if;
  return app.discharge_blockers(p_admission);
end $$;
revoke all on function public.discharge_blockers(uuid) from anon, public;
grant execute on function public.discharge_blockers(uuid) to authenticated;
