#!/usr/bin/env bash
# Usage: ./scripts/restore.sh <db-dump> <files-tarball> <TARGET_DATABASE_URL_OWNER> <TARGET_STORAGE_DIR>
# Restores into an EMPTY database (create it first). Never point this at a live production database.
set -euo pipefail
dump=$1; files=$2; target=$3; dir=$4
pg_restore --no-owner --role="$(psql "$target" -Atc 'select current_user')" -d "$target" "$dump"
mkdir -p "$dir"; tar -xzf "$files" -C "$dir"
psql "$target" -Atc "select 'restored: ' || (select count(*) from orgs) || ' orgs, ' || (select count(*) from audit_log) || ' audit rows'"
