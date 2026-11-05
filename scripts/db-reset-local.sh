#!/usr/bin/env bash
# Fresh plain-Postgres database with migrations + demo seed (no Docker). See scripts/local-pg.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
scripts/local-pg.sh reset >/dev/null
export PGHOST=127.0.0.1 PGPORT=${PGPORT_LOCAL:-54322} PGUSER=postgres
for f in supabase/migrations/*.sql supabase/seed.sql; do
  psql -q -v ON_ERROR_STOP=1 postgres -f "$f" >/dev/null
done
echo "migrations + seed applied"
