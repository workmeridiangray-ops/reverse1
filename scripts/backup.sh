#!/usr/bin/env bash
# Logical backup of the database plus uploaded files. Usage: DATABASE_URL=... UPLOAD_DIR=... bash scripts/backup.sh [outdir]
set -euo pipefail
OUT="${1:-./backups}"; STAMP="$(date -u +%Y%m%dT%H%M%SZ)"; mkdir -p "$OUT"
: "${MIGRATE_DATABASE_URL:?set MIGRATE_DATABASE_URL (owner role)}"
pg_dump --format=custom --no-owner --file "$OUT/db-$STAMP.dump" "$MIGRATE_DATABASE_URL"
if [ -d "${UPLOAD_DIR:-}" ]; then tar -czf "$OUT/uploads-$STAMP.tar.gz" -C "$UPLOAD_DIR" .; fi
sha256sum "$OUT"/*-"$STAMP".* > "$OUT/SHA256SUMS-$STAMP"
echo "Backup written: $OUT (stamp $STAMP)"
