# Buildline — Construction Project & Contractor ERP

Multi-tenant SaaS (Next.js 15, React 19, PostgreSQL with row-level security). Lives in this folder; the repository's other app (`/`, a clinic product) is unrelated and untouched.

```bash
npm install
cp .env.example .env.local                       # then fill in
DATABASE_URL_OWNER=… npm run migrate
ALLOW_DEMO_DATA=true DATABASE_URL_OWNER=… npm run seed:demo   # DEMO ONLY, refuses otherwise
npm run dev                                       # http://localhost:3100
npm run typecheck && npm run lint
npm run test:unit && npm run test:db              # need DATABASE_URL + DATABASE_URL_OWNER (test database!)
npm run build && npm start && npm run test:e2e    # e2e drives Chromium against the running app
```
Demo logins (password `Demo-pass-123`): owner@, manager@, engineer@, qs@, store@, supervisor@, client@, consultant@ `demo.test`.

Design rules that matter: money is integer paise; quantities integer milli-units; tenant isolation is enforced by Postgres RLS (the app role has no BYPASSRLS) plus a trigger that rejects cross-tenant references; external parties write only through authority-checked paths; audit and stock ledgers are append-only. See `docs/DEPLOYMENT.md`, `docs/OPERATIONS.md`, `docs/SCOPE_CHECKLIST.md`.
