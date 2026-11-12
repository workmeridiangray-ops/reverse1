# Deployment

## 1. Database (PostgreSQL 14+)
Create two roles. **The app role must not be a superuser and must not have BYPASSRLS** — tenant isolation depends on it.
```sql
CREATE ROLE erp_owner LOGIN PASSWORD '…';             -- owns tables; used only for migrations/seed/backup
CREATE ROLE erp_app   LOGIN PASSWORD '…' NOBYPASSRLS; -- the running application
CREATE DATABASE erp OWNER erp_owner;
```
Then `DATABASE_URL_OWNER=… npm run migrate` (idempotent; runs `db/migrations/*.sql` once each, in order, each in a transaction).

## 2. Configuration
Copy `.env.example`; set every value in your host's secret store. `PAYMENT_MODE` defaults to `razorpay` in production; `test` (simulated payments) must be chosen deliberately, e.g. on staging. Keep `ALLOW_DEMO_DATA=false`.

## 3. Run
- Docker: `docker build -t buildline . && docker run --env-file … -p 3100:3100 -v storage:/var/lib/buildline/storage buildline`
- Render: `render.yaml` defines the web service (migrations run pre-deploy; health check `/api/health`), a persistent disk for files and a worker.
- Worker: `node scripts/worker.mjs` (needs `APP_URL`, `CRON_SECRET`). It runs outbox email, the hourly subscription sweep, project exports, with retries/backoff.
- Put TLS in front (platform load balancer). The app sets HSTS, CSP, frame, nosniff headers.

## 4. First platform administrator
Sign up normally, then (once) in SQL as owner: `update users set platform_role='owner' where lower(email)='you@company.com';`. Platform staff must enable two-factor sign-in before the platform screens open. Further staff are managed in Platform → Operations.

## 5. Payments (Razorpay)
Set keys; add webhook `https://<APP_URL>/api/webhooks/payments` for `payment.captured`, `payment.failed`, `refund.processed`, `payment.dispute.created` with `RAZORPAY_WEBHOOK_SECRET`. The subscription changes only on a verified, signature-checked event; events are idempotent by event id. **Live Razorpay calls have not been exercised** (no credentials in this environment) — run a test-mode payment before launch.

## 6. Rollback
Deploy the previous image/commit. Migrations are additive; restore the pre-deploy backup if a migration must be reversed (`docs/OPERATIONS.md`).
