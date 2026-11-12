alter table users add column recovery_codes text[] not null default '{}';
alter table users add column last_login_at timestamptz;
create table login_attempts (
  id bigserial primary key, email text not null, ip text, ok boolean not null, created_at timestamptz not null default now()
);
create index login_attempts_idx on login_attempts(lower(email), created_at desc);
grant select, insert, update, delete on login_attempts to erp_app;
grant usage, select on all sequences in schema public to erp_app;
