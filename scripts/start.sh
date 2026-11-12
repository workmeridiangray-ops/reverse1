#!/bin/sh
# Container entrypoint: derive runtime DB role URL, migrate, bootstrap platform owner, start worker + server.
set -e
: "${MIGRATE_DATABASE_URL:?set MIGRATE_DATABASE_URL (database owner URL)}"
APP_URL="${APP_URL:-$RENDER_EXTERNAL_URL}"; export APP_URL
if [ -z "$DATABASE_URL" ] && [ -n "$APP_DB_PASSWORD" ]; then
  DATABASE_URL=$(node -e 'const u=new URL(process.env.MIGRATE_DATABASE_URL);u.username="mfg_app";u.password=process.env.APP_DB_PASSWORD;console.log(u.toString())'); export DATABASE_URL
fi
node scripts/migrate.mjs
if [ -n "$PLATFORM_OWNER_EMAIL" ] && [ -n "$PLATFORM_OWNER_PASSWORD" ]; then node scripts/bootstrap-platform.mjs || true; fi
if [ -n "$CRON_SECRET" ]; then (APP_URL="http://127.0.0.1:${PORT:-3000}" node scripts/worker.mjs &) ; fi
exec node server.js
