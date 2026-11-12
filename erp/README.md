# Ledgerline — multi-company ERP SaaS (trading & service baseline)

Next.js 15 (App Router, server actions) + PostgreSQL. Isolated customer companies, role/branch permissions, sales → procurement → inventory → fulfilment → finance, projects/people/assets, approvals, subscriptions, platform console.

> This folder is a self-contained application inside the `reverse1` repository. The pre-existing `Tendwell` clinic app in the repository root is a different product and was left untouched.

## Quick start (development)
```bash
cd erp && npm install
# PostgreSQL 14+ with two roles: erp_owner (owns tables, runs migrations) and erp_app (NOLOGIN-privileges only: no superuser, no BYPASSRLS)
cp .env.example .env.local        # fill DATABASE_URL / DATABASE_OWNER_URL
npm run migrate
ENABLE_DEMO_DATA=true npm run seed:demo   # optional demo company "Demo Traders" (demo data only)
npm run dev                       # http://localhost:3100
```
Demo logins (password `DemoPass#2026`): owner@, manager@, sales@, warehouse@, accounts@, purchase@ `demo.test`. Demo data is created only by `seed:demo`, which refuses to run without `ENABLE_DEMO_DATA=true`.

## Checks
```bash
npm run typecheck
npm test                          # 20 tests on a scratch DB (erp_test): ledger/stock flow, isolation, billing, units
npm run build
APP_URL=http://localhost:3100 CHROMIUM_PATH=... npx tsx scripts/e2e.ts      # role-by-role crawl + permission-denied checks
DATABASE_OWNER_URL=... CHROMIUM_PATH=... npx tsx scripts/journey.ts         # full client journey in a browser
```
See `docs/ARCHITECTURE.md`, `docs/DEPLOY.md`, `docs/ADMIN_GUIDE.md`, `docs/SCOPE_CHECKLIST.md` (requirement-by-requirement status, including what is NOT built).
