create table idempotency_keys (
  key text primary key,
  user_id uuid not null,
  created_at timestamptz not null default now()
);
create table login_attempts (
  id bigserial primary key,
  email text not null,
  ip text,
  ok boolean not null,
  at timestamptz not null default now()
);
create index login_attempts_email on login_attempts(lower(email), at desc);
grant select, insert, update, delete on idempotency_keys, login_attempts to erp_app;
grant usage, select on all sequences in schema public to erp_app;
