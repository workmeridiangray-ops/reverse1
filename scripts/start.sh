#!/bin/sh
# Container entrypoint: create runtime role (if APP_DB_PASSWORD given), migrate, bootstrap platform owner, start worker + server.
set -e
node scripts/migrate.mjs
if [ -n "$PLATFORM_OWNER_EMAIL" ] && [ -n "$PLATFORM_OWNER_PASSWORD" ]; then node scripts/bootstrap-platform.mjs || true; fi
if [ -n "$CRON_SECRET" ]; then (APP_URL="http://127.0.0.1:${PORT:-3000}" node scripts/worker.mjs &) ; fi
exec node server.js
