-- Live front-desk board: stream appointment and room changes.
-- Realtime evaluates RLS per subscriber, so clinics only receive their own rows.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.appointments, public.rooms;
  end if;
end $$;
