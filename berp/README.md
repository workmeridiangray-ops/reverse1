# BERP — multi-company business ERP (SaaS)

Next.js 15 + Supabase (Postgres, Auth, RLS). Trading and service ERP in INR with GST rates:
sales → stock reservation → purchasing → receipt → dispatch → invoice → collection, with a
balanced double-entry ledger underneath. Built from `Modular_Business_ERP_SaaS_Full_Scope`.

## What is built

| Area | Status |
|---|---|
| Public site (home, pricing from the database), sign-up with 14-day trial, sign-in, workspace picker/switcher, help | Built, browser-tested |
| Tenancy: every row carries `tenant_id`; RLS from the caller's *active workspace*; seven roles | Built, tested |
| Plans & entitlements: user/branch/warehouse limits in the DB; downgrade blocked while over limit; trial expiry, 7-day payment grace, suspension | Built, tested |
| Subscription billing: Razorpay checkout + HMAC-verified, idempotent webhook that activates / past-dues / cancels a workspace | Built; **not run against Razorpay** (needs your keys) |
| Masters: customers (credit limit, terms), suppliers, items/services, tax codes, branches, warehouses — retired, never deleted; CSV import (all-or-nothing, 2,000 rows) | Built, tested |
| Sales: draft → confirm (credit check + manager override) → partial dispatch → invoice → cancel; credit notes / customer returns with optional restock | Built, tested |
| Purchasing: shortage → request → approval → PO → partial receipt (idempotent) → three-way-matched bill → supplier payment | Built, tested |
| Inventory: append-only ledger; on-hand/reserved/available; adjustments; warehouse transfers with in-transit stock; backorders auto-reserve | Built, tested |
| Finance: auto-posted balanced journals, trial balance, manual journals + reversal, period close | Built, tested |
| Reports: receivables & payables ageing, stock valuation, sales margin (cost at dispatch), CSV export | Built, tested |
| Projects: budget, time & expense approval (no self-approval), milestone billing through the normal invoice chain, cost summary restricted to managers | Built, tested |
| People: employee records private to owner/manager, leave requests with overlap and self-approval rules, offboarding revokes access | Built, tested |
| Assets & maintenance: register, warranty/service dates, work orders consume spares and post expense, disposal with reason | Built, tested |
| Approval rules: amount thresholds route sales orders / purchase requests to a manager or owner; routing stamped per request; no self-approval; effective-dated | Built, tested |
| Batch / serial tracking with expiry: lots on receipts, adjustments, dispatch (earliest-expiry-first, expired stock refused), returns go back to their original lots; lot history for recalls; expiry report | Built, tested (transfers and work-order spares of tracked items are refused until specified) |
| Barcodes: item barcodes, Code 128 label sheets for items and lots, scan lookup page (USB/Bluetooth scanners type the code) | Built; encoder verified by an independent decoder |
| Read-only REST API with hashed, revocable, rate-limited keys (`/api/v1/*`) | Built, browser-tested |
| Outbound webhooks: transactional outbox, HMAC-signed, retried with backoff, SSRF-guarded, delivery history and manual retry | Built, tested; **live delivery to a public URL not exercised** (sandbox has no outside network) |
| Platform super-admin; audit trail (append-only) | Built, tested |

## Not built (separate scopes in the source document)

Approval delegation, multi-step approval chains, custom fields and document templates, report builder, SSO/2FA,
unit conversions, handheld offline scanning, lot-tracked transfers and spares, courier
integrations, payroll/attendance devices/recruitment, GST filing and e-invoicing, bank feeds, native apps,
additional languages and currencies, and the manufacturing / restaurant / school / healthcare /
construction packages.

## Run locally

```bash
npm install
npx supabase start                  # local Postgres + Auth (needs Docker)
cp .env.example .env.local          # fill from `npx supabase status`
npm run dev
```

## Tests

```bash
npm run typecheck
npm run test:unit   # money/tax rules, CSV validation, billing and webhook signatures, SSRF guards, design-token contrast
npm run test:db     # real PostgreSQL (no Docker): all migrations, then 55 tests
npm run test:e2e    # real PostgreSQL + real PostgREST + the built app + headless Chromium (60 checks)
```

`test:e2e` needs a PostgREST binary (`POSTGREST_BIN=/path/to/postgrest`, v12.x). Authentication is the
only simulated piece (`scripts/e2e/stack.mjs` stands in for Supabase Auth); every query, RLS policy,
RPC and form is the real thing. It signs up, runs the whole order-to-cash chain, credit note,
reports, CSV import, projects/people/assets, API key use, tenant isolation and a mobile check.

## Rules that matter

- Money is integer paise. Quantities have ≤ 3 decimals. Rounding is half-up per line (`lib/rules/money.ts` ⇄ `app.line_net/line_tax`).
- Posted data is written only by `SECURITY DEFINER` functions that re-check tenant, role and plan status; clients have no INSERT/UPDATE on ledgers or documents.
- Corrections are reversals, never edits.
