#!/usr/bin/env bash
# Restores a backup into an EMPTY database. Usage: MIGRATE_DATABASE_URL=... bash scripts/restore.sh db-XXXX.dump [uploads-XXXX.tar.gz]
set -euo pipefail
: "${MIGRATE_DATABASE_URL:?set MIGRATE_DATABASE_URL (owner role of the target, empty database)}"
DUMP="${1:?path to .dump}"; UPL="${2:-}"
pg_restore --no-owner --exit-on-error --dbname "$MIGRATE_DATABASE_URL" "$DUMP"
if [ -n "$UPL" ]; then mkdir -p "${UPLOAD_DIR:?set UPLOAD_DIR}"; tar -xzf "$UPL" -C "$UPLOAD_DIR"; fi
echo "Restore complete. Run: npm run migrate (no-op if current), then check /api/health."
