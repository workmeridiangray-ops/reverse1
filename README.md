# SiteLedger — Construction Project & Contractor ERP (multi-company SaaS)

Next.js 15 (App Router, server actions) + PostgreSQL 14+ with row-level security. Money is integer paise,
quantities integer milli-units, percentages basis points; all billing rules are pure, tested modules.

**Read first:** [`docs/SCOPE_STATUS.md`](docs/SCOPE_STATUS.md) states exactly what is built, verified and *not* built
against the scope document, and [`docs/DEPLOY.md`](docs/DEPLOY.md) the deployment and operations steps.

## Run locally
```bash
npm install
cp .env.example .env.local          # fill DATABASE_URL / APP_DATABASE_URL (see below)
npm run db:migrate                  # as the DB owner; creates tables, RLS policies and the erp_app role
PLATFORM_ADMIN_EMAIL=you@example.com PLATFORM_ADMIN_PASSWORD='a-long-password' npm run platform:admin
npm run dev                         # http://localhost:3000   (npm run worker sends queued email)
```
`DATABASE_URL` = owner connection (migrations only). `APP_DATABASE_URL` = the non-owner `erp_app` role the app
runs as — it is subject to row-level security. Never run the app as the owner.

## Verify
```bash
npm run typecheck && npm test      # unit rules + database isolation tests (needs TEST_OWNER_URL, see below)
npm run build
npm run test:e2e                   # real browser, production build, real Postgres, 6 roles
```
Tests that touch the database create/drop throw-away databases (`erp_test`, `erp_e2e`) using `TEST_OWNER_URL`
(a superuser/createdb connection, default `postgresql://postgres@localhost:5433/postgres?host=/tmp/pgdata`).

## Layout
```
app/(site)        public website, demo/contact forms        app/(auth)   sign-up, sign-in, recovery, invitations, workspaces
app/app           tenant workspace (dashboard, projects, team, settings, account, audit)
app/app/projects/[id]/*   BOQ, budget, contract, measurements, bills, variations, procurement, reports, drawings, quality, access
app/platform      operator console (businesses, jobs, leads, audit)       app/api   health, files, CSV/JSON exports
db/migrations     schema, RLS, constraints                  lib/rules    pure business rules + tests
lib/server        db scope, auth/sessions, action wrapper, storage        scripts   migrate, worker, platform-admin, seed-demo, e2e
```

## Rules that matter
- **Tenant isolation is enforced by PostgreSQL**, not just app code: every table has RLS keyed on `app.tenant_id`; child rows reference parents by `(id, tenant_id)`; external roles are additionally limited to assigned projects and approved/certified records; internal margins (budget) are invisible to them.
- **Separation of duties** on measurement verification, bill certification, variations, material requests, report review and drawing approval.
- **Cumulative billing**: a bill claims verified quantity minus previously *certified* quantity, so uncertified work carries forward and nothing is billed twice.
- Submitted, certified, invoiced and collected are separate figures. Corrections (receipt reversal, rejection, return) keep the original and require a reason.
- Audit log is append-only (trigger + no grants). Uploads are type-checked by content, size-limited, stored privately and served only through an authenticated route.
