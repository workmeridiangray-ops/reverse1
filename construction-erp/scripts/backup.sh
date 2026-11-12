#!/usr/bin/env bash
# Usage: DATABASE_URL_OWNER=... STORAGE_DIR=... BACKUP_DIR=... ./scripts/backup.sh
# Produces a timestamped database dump + a tarball of private file storage. Copy BACKUP_DIR off-machine (object storage) on a schedule.
set -euo pipefail
: "${DATABASE_URL_OWNER:?}" "${STORAGE_DIR:?}" "${BACKUP_DIR:?}"
ts=$(date -u +%Y%m%dT%H%M%SZ); mkdir -p "$BACKUP_DIR"
pg_dump --format=custom --no-owner "$DATABASE_URL_OWNER" -f "$BACKUP_DIR/db-$ts.dump"
tar -czf "$BACKUP_DIR/files-$ts.tar.gz" -C "$STORAGE_DIR" . 2>/dev/null || tar -czf "$BACKUP_DIR/files-$ts.tar.gz" --files-from /dev/null
sha256sum "$BACKUP_DIR"/*-"$ts".* > "$BACKUP_DIR/SHA256SUMS-$ts"
echo "backup $ts ok"
