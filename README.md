# Forgeline — Manufacturing ERP & Production Planning SaaS

Multi-company ERP for discrete manufacturers: engineering masters and BOMs, MRP, purchasing, stock ledger with batch/serial traceability, shop-floor execution, quality, costing, dispatch, customer/supplier portals, subscriptions and a platform admin.

Stack: Next.js 15 (App Router, server actions) · PostgreSQL 15+ (row-level security for tenant isolation) · `pg` · Tailwind. No third-party auth service; sessions, scrypt passwords, TOTP and audit are in-house.

> **Status:** see [`docs/scope-checklist.md`](docs/scope-checklist.md) for exactly what is built, verified and *not* built against the scope document. The repository previously held an unrelated clinic app ("Tendwell"); it was replaced (history is preserved in git).

## Run locally
```bash
npm install
# PostgreSQL running, with roles mfg_owner (owner) and mfg_app (non-superuser, nobypassrls) — see docs/deployment.md
export MIGRATE_DATABASE_URL=postgres://mfg_owner:owner@localhost/mfg DATABASE_URL=postgres://mfg_app:app@localhost/mfg
export APP_URL=http://localhost:3000 EMAIL_PROVIDER=log ALLOW_SANDBOX_PAYMENTS=1 SANDBOX_WEBHOOK_SECRET=dev CRON_SECRET=dev
npm run migrate && npm run dev
```
Dev email is kept in the `email_outbox` table (`EMAIL_PROVIDER=log`); run `npm run worker` or `POST /api/cron` to deliver/process jobs. Sample data is loaded by the owner from the onboarding checklist (never automatically).

## Checks
```bash
npm run typecheck && npm run lint
npm test                      # 42 tests: domain rules + real-Postgres integration (RLS, ledger, billing, auth)
npm run build && node scripts/e2e.mjs   # browser acceptance runs: node scripts/e2e.mjs (89 checks) and node scripts/e2e-production.mjs (shop-floor chain), against a started instance (CHROMIUM_PATH=…)
```
## Docs
`docs/deployment.md` (deploy, health, backup/restore, rollback) · `docs/admin-guide.md` · `docs/costing.md` · `docs/scope-checklist.md`

## Rules worth knowing
- Tenant isolation is enforced **in the database** (RLS on every tenant table, composite `(id, company_id)` foreign keys); the app role must never be superuser/BYPASSRLS.
- Stock movements are append-only (trigger); corrections are reversals with a reason. Negative stock and issuing quarantined batches are rejected in the database.
- Released work orders snapshot BOM + routing; released BOMs are frozen.
- Money is integer paise; MRP and costing are pure, tested functions in `lib/domain`.
