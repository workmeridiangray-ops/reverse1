#!/usr/bin/env bash
# Browser end-to-end: real PostgreSQL + real PostgREST + the real Next.js app + headless Chromium.
# Needs: PostgreSQL server binaries, a PostgREST binary (POSTGREST_BIN), Playwright's Chromium.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${POSTGREST_BIN:?set POSTGREST_BIN to the postgrest executable}"
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)
DIR=$(mktemp -d); PGPORT=54330; API=54321; WEB=3200
JWT_SECRET="e2e-only-secret-not-for-production-0123456789abcdef" # fixed so NEXT_PUBLIC keys baked into a build stay valid
if [ "$(id -u)" = 0 ]; then chown postgres "$DIR"; RUN="runuser -u postgres --"; else RUN=""; fi
PIDS=()
cleanup() { pkill -f "next start -p $WEB" 2>/dev/null; pkill -f "next-server" 2>/dev/null; for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; $RUN "$PGBIN/pg_ctl" -D "$DIR/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
$RUN "$PGBIN/initdb" -D "$DIR/data" -U postgres --auth=trust >/dev/null
$RUN "$PGBIN/pg_ctl" -D "$DIR/data" -o "-p $PGPORT -k $DIR -c listen_addresses=127.0.0.1 -c fsync=off" -l "$DIR/log" -w start >/dev/null
export PG_URL="postgresql://postgres@127.0.0.1:$PGPORT/postgres"
psql "$PG_URL" -q -f tests/db/bootstrap.sql
for f in supabase/migrations/*.sql; do psql "$PG_URL" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null; done
psql "$PG_URL" -q -c "grant anon, authenticated, service_role to postgres; grant all on all tables in schema public to service_role; grant all on all functions in schema public to service_role"
PGRST_DB_URI="$PG_URL" PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET="$JWT_SECRET" PGRST_SERVER_PORT=3001 "$POSTGREST_BIN" >"$DIR/pgrst.log" 2>&1 &
PIDS+=($!)
JWT_SECRET="$JWT_SECRET" PORT=$API POSTGREST_URL=http://127.0.0.1:3001 node scripts/e2e/stack.mjs >"$DIR/stack.log" 2>&1 &
PIDS+=($!)
mkjwt() { JWT_SECRET="$JWT_SECRET" node -e "const c=require('crypto'),b=x=>Buffer.from(x).toString('base64url');const h=b(JSON.stringify({alg:'HS256',typ:'JWT'})),p=b(JSON.stringify({role:process.argv[1],iss:'e2e',exp:4102444800}));console.log(h+'.'+p+'.'+c.createHmac('sha256',process.env.JWT_SECRET).update(h+'.'+p).digest('base64url'))" "$1"; }
export NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:$API" NEXT_PUBLIC_SUPABASE_ANON_KEY="$(mkjwt anon)" SUPABASE_SERVICE_ROLE_KEY="$(mkjwt service_role)"
sleep 2; curl -sf "http://127.0.0.1:$API/rest/v1/plans" -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H "authorization: Bearer $NEXT_PUBLIC_SUPABASE_ANON_KEY" >/dev/null || { echo "stack not up:"; curl -si "http://127.0.0.1:$API/rest/v1/plans" -H "authorization: Bearer $NEXT_PUBLIC_SUPABASE_ANON_KEY"; tail "$DIR/pgrst.log" "$DIR/stack.log"; exit 1; }
npx next build >"$DIR/build.log" 2>&1 || { tail -30 "$DIR/build.log"; exit 1; }
npx next start -p $WEB >"$DIR/web.log" 2>&1 &
PIDS+=($!)
sleep 3
E2E_BASE="http://127.0.0.1:$WEB" E2E_API="http://127.0.0.1:$API" E2E_ANON="$NEXT_PUBLIC_SUPABASE_ANON_KEY" E2E_OUT="${E2E_OUT:-$DIR}" node scripts/e2e/journey.mjs || { echo "--- web log"; tail -30 "$DIR/web.log"; exit 1; }
