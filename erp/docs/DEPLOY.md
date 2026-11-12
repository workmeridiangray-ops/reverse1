# Deployment and operations

## Requirements
Node 22, PostgreSQL 14+, an SMTP account, Razorpay account (test keys first), a place to run one web process and one worker (or a 1-minute scheduler).

## Database
```sql
CREATE ROLE erp_owner LOGIN PASSWORD '…' ;           -- owns schema, runs migrations
CREATE ROLE erp_app   LOGIN PASSWORD '…' NOSUPERUSER NOBYPASSRLS;
CREATE DATABASE ledgerline OWNER erp_owner;
```
Then `DATABASE_OWNER_URL=… npm run migrate` (idempotent; records applied files in `schema_migrations`). Migrations grant `erp_app` table rights; **never** run the app with the owner or a superuser role (that would bypass row-level security).

## Environment (see `.env.example`)
`DATABASE_URL`, `DATABASE_OWNER_URL`, `APP_URL`, `CRON_SECRET`, `SMTP_URL`, `MAIL_FROM`, `BILLING_PROVIDER=razorpay`, `RAZORPAY_KEY_ID/SECRET/WEBHOOK_SECRET`, `PLATFORM_TAX_BPS`. Leave `ENABLE_DEMO_DATA=false`. In production the app refuses to send email without `SMTP_URL` (jobs fail visibly instead of pretending).

## Build and run
```bash
npm ci && npm run build
npm start                    # PORT=3100; put behind TLS (HSTS is sent)
npm run worker               # second process: jobs every 5 s, billing sweep every 10 min
```
Razorpay: create webhook → `https://<host>/api/webhooks/payments`, events `payment.captured`, `payment.failed`, `refund.processed`, `payment.dispute.created`; copy the secret to `RAZORPAY_WEBHOOK_SECRET`.
First platform owner: `PLATFORM_OWNER_EMAIL=… PLATFORM_OWNER_PASSWORD=… DATABASE_OWNER_URL=… npm run bootstrap:owner`, sign in, enable two-factor, open `/platform`.

## Health, logs, monitoring
`GET /api/health` → 200 `{status:"ok",database:"up",deadJobs,stuckJobs}` or 503. Alert on non-200, `deadJobs>0`, `stuckJobs>0`. Logs are stdout/stderr (JSON-free, one line per event; errors include a digest). Failed jobs and webhook events are listed in Platform → Jobs / Payments.

## Backup and restore
Nightly `pg_dump -Fc ledgerline > ledgerline-$(date +%F).dump` (file attachments live in the database, so one dump is complete) plus WAL archiving/PITR if the RPO must be < 24 h. Keep 35 days. **Restore test (do quarterly):**
```bash
createdb -O erp_owner restore_check && pg_restore -d restore_check ledgerline-YYYY-MM-DD.dump
psql restore_check -c "select count(*) from journals" && DATABASE_URL=…/restore_check npm test -- tests/isolation.test.ts   # sanity
```
Recovery targets (RPO/RTO) and launch-volume load targets are business decisions not yet agreed — set them before promising SLAs.

## Rollback
Keep the previous build artefact. Migrations are forward-only and additive; to roll back code, redeploy the previous build (schema stays compatible). For a bad migration restore from the pre-deploy dump.

## Incident ownership
Platform owner: security and data incidents; tech role: jobs/infra; billing role: payment disputes; support role: customer comms. Every platform action is in the audit log.
