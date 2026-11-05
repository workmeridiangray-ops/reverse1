#!/usr/bin/env bash
# Starts a throwaway Postgres 16 with a minimal Supabase-compatible shim
# (roles, auth schema, auth.uid(), extensions schema), applies migrations + seed.
# For environments without Docker. NOT for production. Usage: scripts/local-pg.sh [reset]
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
DIR=${PGDATA_DIR:-/tmp/tendwell-pg}
PORT=${PGPORT_LOCAL:-54322}
RUN_AS=${RUN_AS:-postgres}
if [ "${1:-}" = "reset" ] && [ -d "$DIR" ]; then
  su "$RUN_AS" -c "$PGBIN/pg_ctl -D $DIR/data stop -m fast" >/dev/null 2>&1 || true
  rm -rf "$DIR"
fi
if [ ! -d "$DIR/data" ]; then
  mkdir -p "$DIR" && chown "$RUN_AS" "$DIR"
  su "$RUN_AS" -c "$PGBIN/initdb -D $DIR/data -U postgres --auth=trust -E UTF8" >/dev/null
fi
su "$RUN_AS" -c "$PGBIN/pg_ctl -D $DIR/data -o '-p $PORT -k /tmp' -l $DIR/log -w start" >/dev/null 2>&1 || true
export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=postgres
psql -qAt -c "select 1" postgres >/dev/null
psql -q postgres -v ON_ERROR_STOP=1 <<'SQL'
do $$ begin
  create role anon nologin noinherit; exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated nologin noinherit; exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role nologin noinherit bypassrls; exception when duplicate_object then null; end $$;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;
create schema if not exists auth;
create table if not exists auth.users (
  instance_id uuid, id uuid primary key, aud text, role text, email text unique,
  encrypted_password text, email_confirmed_at timestamptz, raw_app_meta_data jsonb,
  raw_user_meta_data jsonb, created_at timestamptz, updated_at timestamptz,
  confirmation_token text, email_change text, email_change_token_new text,
  email_change_token_current text, recovery_token text, phone_change text,
  phone_change_token text, reauthentication_token text);
create table if not exists auth.identities (
  id uuid primary key, user_id uuid, provider_id text, identity_data jsonb,
  provider text, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);
create or replace function auth.uid() returns uuid language sql stable as
  $f$ select nullif(nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'sub','')::uuid $f$;
create or replace function auth.jwt() returns jsonb language sql stable as
  $f$ select coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb $f$;
grant usage on schema public, auth, extensions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
SQL
echo "postgres ready on $PORT"
