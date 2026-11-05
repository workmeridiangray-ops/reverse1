# BERP — multi-company business ERP (SaaS)

Next.js 15 + Supabase (Postgres, Auth, RLS). Trading and service ERP in INR with GST rates:
sales → stock reservation → purchasing → receipt → dispatch → invoice → collection, with a
balanced double-entry ledger underneath. Built from `Modular_Business_ERP_SaaS_Full_Scope`.

## What is built (this release)

| Area | Status |
|---|---|
| Public site (home, pricing from the `plans` table), sign-up with 14-day trial, sign-in, workspace picker/switcher | Built |
| Tenancy: every row carries `tenant_id`; RLS from the caller's *active workspace*; roles owner/manager/sales/purchasing/warehouse/accountant/viewer | Built, tested |
| Plans & entitlements: user/branch/warehouse limits enforced in the DB, downgrade blocked while over limit, trial expiry and suspension make a workspace read-only | Built, tested |
| Masters: customers (credit limit), suppliers, items/services, tax codes, branches, warehouses — retired, never deleted | Built |
| Sales: draft → confirm (credit check + override reason, atomic reservation) → dispatch (partial) → invoice → cancel with reason | Built, tested |
| Purchasing: shortage → purchase request → approve → PO → partial receipt (idempotent, over-receipt blocked) → three-way-matched bill with tolerance + manager exception → supplier payment | Built, tested |
| Inventory: append-only movement ledger; on-hand / reserved / available; adjustments with reason; backorders auto-reserve on receipt | Built, tested |
| Finance: auto-posted balanced journals, trial balance, manual journal, reversal, period close | Built, tested |
| Platform super-admin: list workspaces, suspend/reactivate with a reason; no access to customer documents | Built, tested |
| Audit trail (field names only, append-only) | Built, tested |

## Not in this release (see docs/LAUNCH.md)

Payment provider for subscription billing (plan changes are recorded, money is not collected),
transactional email beyond Supabase Auth mail, CSV import, barcode labels, transfers between
warehouses, batch/serial tracking, unit conversions, customer returns/credit notes, projects,
workforce, assets, approval-rule studio, report builder, API keys/webhooks, and the manufacturing
and industry packages. These are separate scopes in the source document.

## Run locally

```bash
npm install
npx supabase start                  # local Postgres + Auth (needs Docker)
cp .env.example .env.local          # fill URL + anon key from `npx supabase status`
npm run dev
```

## Tests

```bash
npm run test:unit   # money/tax rules, design-token contrast (WCAG AA)
npm run test:db     # real PostgreSQL (no Docker): applies every migration, then 29 tests
npm run typecheck && npm run build
```

`test:db` proves: the whole order-to-cash chain reconciles stock and ledger; tenants cannot see
or write each other's rows; posted records cannot be edited or deleted; unbalanced journals are
rejected at commit; closed periods reject postings; concurrent orders cannot over-reserve; plan
limits; credit and bill-tolerance overrides; SQL and TypeScript rounding agree on >1,000 inputs.

## Rules that matter

- Money is integer paise. Quantities have ≤ 3 decimals. Rounding is half-up per line (`lib/rules/money.ts` ⇄ `app.line_net/line_tax`).
- Posted data is written only by `SECURITY DEFINER` functions that re-check tenant, role and plan status; clients have no INSERT/UPDATE on ledgers or documents.
- Corrections are reversals, never edits.
