# Deployment

## 1. Database (PostgreSQL 15+)
Create two roles. The **runtime role must not be superuser and must not have BYPASSRLS** — row-level security is what isolates companies.
```sql
create role mfg_owner login password '…' ;           -- owns the schema, used only for migrations/backups
create role mfg_app   login password '…' nosuperuser nobypassrls;
create database mfg owner mfg_owner;
```
Migrations (`db/migrations/*.sql`) grant the runtime role what it needs (including default privileges for future tables).
```bash
MIGRATE_DATABASE_URL=postgres://mfg_owner:…@host/mfg npm run migrate
```
Verify isolation after any restore/upgrade: `psql "$DATABASE_URL" -c "select count(*) from items"` must return **0** (no tenant context ⇒ no rows).

## 2. First platform administrator
```bash
MIGRATE_DATABASE_URL=… PLATFORM_OWNER_EMAIL=you@company.com PLATFORM_OWNER_PASSWORD='12+ chars' npm run bootstrap:platform
```
Sign in at `/login`; platform staff land on `/admin`. Add billing/support/techops staff at *Admin → Staff*.

## 3. Configuration
Copy `.env.example`, set every value in your host's secret store. `ALLOW_SANDBOX_PAYMENTS` must be `0` in production.

## 4. Run
- Docker: `docker build -t forgeline . && docker run -p 3000:3000 --env-file .env forgeline`
- Render: `render.yaml` blueprint (web + worker + Postgres + disk). Set `DATABASE_URL` to the `mfg_app` role string.
- Any host: `npm ci && npm run build && node .next/standalone/server.js` (copy `.next/static` to `.next/standalone/.next/static`).
- **Background jobs** (email, payment callbacks, renewals): run `npm run worker` (needs `CRON_SECRET`, `APP_URL`) **or** call `POST /api/cron` with `Authorization: Bearer $CRON_SECRET` every minute.

## 5. Payments (Razorpay)
Use **test-mode** keys first. Webhook URL: `https://<host>/api/webhooks/payments`, events `payment.captured`, `payment.failed`, `refund.processed`, `payment.dispute.created`; set the same secret as `RAZORPAY_WEBHOOK_SECRET`. Provider-side refunds are *recorded* in Admin → Billing but must be issued in the Razorpay dashboard (not automated).

## 6. Health, logs, monitoring
`GET /api/health` → `{"status":"ok","db":"up","deadJobs":N}` (503 when the DB is down). Alert on non-200 or `deadJobs > 0`. Application logs go to stdout/stderr (unexpected errors are logged with `unexpected error`). Audit trail: *App → Audit trail* (per company) and *Admin → Audit log*.

## 7. Backup & restore (tested)
```bash
MIGRATE_DATABASE_URL=… UPLOAD_DIR=… npm run backup ./backups        # pg_dump custom format + uploads tarball + SHA256SUMS
MIGRATE_DATABASE_URL=<empty-db-owner-url> UPLOAD_DIR=… bash scripts/restore.sh backups/db-<stamp>.dump backups/uploads-<stamp>.tar.gz
```
A restoration exercise was run against a live development database: row counts for companies, users, items, stock movements and audit log matched, and the runtime role still saw 0 rows without a tenant context. Schedule daily backups, copy them off-host, and rehearse a restore before go-live. Recovery targets (RPO/RTO) must be agreed with the client.

## 8. Rollback
Deploy is image-based: redeploy the previous image. Migrations are forward-only; take a backup before every deploy and restore it if a migration must be undone.
