-- Public demo / contact requests from the marketing site.
-- Written only through submit_demo_request(); nobody can read them through the
-- API (no policies). Operators read them with the database owner or service role.
create table public.demo_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 254),
  organisation text not null check (length(trim(organisation)) between 1 and 200),
  beds integer check (beds is null or beds between 1 and 100000),
  message text check (message is null or length(message) <= 2000),
  created_at timestamptz not null default now()
);
create index demo_requests_email_idx on public.demo_requests (lower(email), created_at desc);
alter table public.demo_requests enable row level security;
revoke all on public.demo_requests from anon, authenticated;

create or replace function public.submit_demo_request(p_name text, p_email text, p_organisation text, p_beds integer, p_message text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  -- Same person asking again within the hour: acknowledge, store once.
  if exists (select 1 from public.demo_requests where lower(email) = lower(trim(p_email)) and created_at > now() - interval '1 hour') then
    return 'duplicate';
  end if;
  -- Abuse guard: cap total intake per hour.
  if (select count(*) from public.demo_requests where created_at > now() - interval '1 hour') >= 200 then
    raise exception 'Too many requests right now. Please try again later.' using errcode = '53400';
  end if;
  insert into public.demo_requests (name, email, organisation, beds, message)
  values (trim(p_name), lower(trim(p_email)), trim(p_organisation), p_beds, nullif(trim(p_message), ''));
  return 'received';
end $$;
revoke all on function public.submit_demo_request(text, text, text, integer, text) from public;
grant execute on function public.submit_demo_request(text, text, text, integer, text) to anon, authenticated;
