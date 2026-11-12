-- Lab reference ranges: editing and clinician sign-off.
--
--   admin   edits ranges and tests, never signs them off
--   doctor  signs off (or withdraws a sign-off), never edits the limits
--   any change to a range's limits, ages or sex CLEARS its sign-off, so a
--   signed-off range always means "a clinician reviewed exactly these numbers"
--   (mirrors limitsChanged() in lib/rules/lab-flags.ts).
-- A result keeps the range it was flagged from (range_reviewed is a snapshot),
-- so old results are never retroactively relabelled as reviewed.

alter table public.lab_reference_ranges
  add column reviewed_by uuid,
  add column updated_by uuid,
  add column updated_at timestamptz not null default now(),
  add constraint lab_ranges_reviewed_by_fk foreign key (reviewed_by, clinic_id) references public.profiles (id, clinic_id),
  add constraint lab_ranges_updated_by_fk foreign key (updated_by, clinic_id) references public.profiles (id, clinic_id),
  add constraint lab_ranges_reviewer_present check ((reviewed_at is null) = (reviewed_by is null));

create or replace function app.lab_range_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r public.app_role := app.role();
  changed boolean;
begin
  if tg_op = 'INSERT' then
    if r is not null then
      new.reviewed_at := null; new.reviewed_by := null; new.reviewed_by_name := null;
    end if;
    new.updated_by := coalesce(auth.uid(), new.updated_by);
    return new;
  end if;

  if new.test_type_id is distinct from old.test_type_id then
    raise exception 'A range cannot be moved to another test' using errcode = '42501';
  end if;
  changed := (new.sex, new.age_min_years, new.age_max_years, new.low, new.high, new.critical_low, new.critical_high)
             is distinct from (old.sex, old.age_min_years, old.age_max_years, old.low, old.high, old.critical_low, old.critical_high);

  if r = 'admin' then
    if (new.reviewed_at, new.reviewed_by, new.reviewed_by_name) is distinct from (old.reviewed_at, old.reviewed_by, old.reviewed_by_name) then
      raise exception 'Only a doctor can sign off a range' using errcode = '42501';
    end if;
    if changed then
      new.reviewed_at := null; new.reviewed_by := null; new.reviewed_by_name := null;
    end if;
    new.updated_by := auth.uid();
  elsif r = 'doctor' then
    if changed or new.note is distinct from old.note then
      raise exception 'Doctors can sign off a range but not edit it' using errcode = '42501';
    end if;
    if old.reviewed_at is not null then
      -- An existing sign-off can be withdrawn, never rewritten.
      if new.reviewed_at is not null then
        new.reviewed_at := old.reviewed_at; new.reviewed_by := old.reviewed_by; new.reviewed_by_name := old.reviewed_by_name;
      else
        new.reviewed_by := null; new.reviewed_by_name := null;
      end if;
    elsif new.reviewed_at is not null then
      new.reviewed_at := now();
      new.reviewed_by := auth.uid();
      select p.full_name into new.reviewed_by_name from public.profiles p where p.id = auth.uid();
    else
      new.reviewed_by := null; new.reviewed_by_name := null;
    end if;
  elsif r is not null then
    raise exception 'Your role cannot change lab ranges' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger lab_range_rules before insert or update on public.lab_reference_ranges
  for each row execute function app.lab_range_rules();
create trigger set_updated_at before update on public.lab_reference_ranges for each row execute function app.set_updated_at();

-- A test's code and unit cannot change once it has results: they would silently
-- change the meaning of numbers already on patients' records.
create or replace function app.lab_test_type_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.code, new.unit) is distinct from (old.code, old.unit)
     and exists (select 1 from public.lab_results r where r.test_type_id = old.id) then
    raise exception 'The code and unit of a test cannot change once it has results' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger lab_test_type_rules before update on public.lab_test_types
  for each row execute function app.lab_test_type_rules();

-- Policies: doctors may sign off (the trigger limits them to that); admins may delete an
-- unused range (the foreign key from results refuses a used one).
create policy lab_ranges_update_doctor on public.lab_reference_ranges for update to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('doctor')))
  with check (clinic_id = (select app.clinic_id()));
grant delete on public.lab_reference_ranges to authenticated;
create policy lab_ranges_delete on public.lab_reference_ranges for delete to authenticated
  using (clinic_id = (select app.clinic_id()) and (select app.has_role('admin')));

revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated;
