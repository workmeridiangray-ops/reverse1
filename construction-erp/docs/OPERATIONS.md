# Operations & administrator guide

## Health & logs
`GET /api/health` → `{status:"ok", db:"up"}` or 503. Application logs go to stdout/stderr (unexpected errors are logged without user data). Audit trail: Settings → Audit trail (per business) and Platform → business page (platform actions). The audit log is append-only at the database level.

## Backup & restore (tested)
`DATABASE_URL_OWNER=… STORAGE_DIR=… BACKUP_DIR=… scripts/backup.sh` writes a custom-format dump, a files tarball and SHA256 sums. Schedule it (daily) and copy off-machine. Restore into an **empty** database: `scripts/restore.sh <dump> <files.tgz> <target-owner-url> <storage-dir>`. A restore of a dump taken during development was verified (orgs and audit rows matched). Set `platform_settings.last_backup_at` to your backup time to show it on the Operations page. Define RPO/RTO with the business; the defaults here are whatever your schedule provides.

## Routine tasks
- Failed jobs: Platform → Operations → Background jobs → Retry (bounded retries with backoff happen automatically first).
- Payment webhooks: same page lists every event with status and error; failed ones are re-delivered by the provider (non-2xx response) and are safe to repeat.
- Suspend/restore a business, extend a trial: Platform → Businesses (reason required, audited; suspension signs everyone out).
- Support access: support staff request → the customer's owner approves in Settings → Team & access (24 h, read-only).
- Refunds: Platform → Billing (reason required). Records the refund; issue it at the provider using the shown reconciliation reference.
- Plan changes: publish a new plan *version*; issued invoices keep their version.

## Incident ownership
Log in Platform → Operations → Incidents with an owner and severity; resolve when done.

## Data lifecycle
Closed projects are read-only and can be exported (Handover → export package). Cancelled/expired subscriptions stay readable. Retention periods for files/photos and post-closure access are **business decisions not yet set** — configure before launch.
