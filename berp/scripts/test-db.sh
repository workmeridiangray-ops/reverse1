#!/usr/bin/env bash
# Runs the DB suite against a throwaway real PostgreSQL (no Docker needed).
# Supabase-specific objects (auth schema, anon/authenticated roles) are stubbed by tests/db/bootstrap.sql.
set -euo pipefail
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)
DIR=$(mktemp -d); PORT=${BERP_PG_PORT:-54329}
if [ "$(id -u)" = 0 ]; then chown postgres "$DIR"; RUN="runuser -u postgres --"; else RUN=""; fi
cleanup() { $RUN "$PGBIN/pg_ctl" -D "$DIR/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
$RUN "$PGBIN/initdb" -D "$DIR/data" -U postgres --auth=trust >/dev/null
$RUN "$PGBIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -k $DIR -c listen_addresses=127.0.0.1 -c fsync=off" -l "$DIR/log" -w start >/dev/null
export BERP_DB_URL="postgresql://postgres@127.0.0.1:$PORT/postgres"
npx vitest run --project db "$@"
