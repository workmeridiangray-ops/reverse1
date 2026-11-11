# Ledgerline

Finance invoicing and receivables for B2B businesses: quotations, invoices, recurring billing,
receipts and allocation, credits and disputes, collections, expenses and payables, reconciliation,
a customer portal and a platform super-admin. Built from `10_Finance_Invoicing_Receivables_SaaS_Full_Scope.docx`.

This folder is a self-contained static web app (React + TypeScript + Vite). It has no server
dependency, so it can be hosted on any static host.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # business-rule + sync unit tests
npm run test:db    # Postgres row-level-security tests (needs a local Postgres, PGURL)
npm run build      # type-checks, then writes dist/
npm run preview    # serve dist/ on :4173
npm run test:crawl # opens every screen as every role (needs a build first)
```

## Demo accounts

Password `demo`. Two-factor code `123456`.

| Account | Role |
| --- | --- |
| `owner@northwind.test` | Owner of Northwind (and Manager of Kestrel: workspace switch) |
| `manager@northwind.test` | Manager (approver) |
| `staff@northwind.test` | Staff (limited) |
| `accounts@aarav.example` | Customer portal user |
| `priya@ledgerline.example` | Platform owner |
| `dev@ledgerline.example` / `sara@ledgerline.example` / `ishaan@ledgerline.example` | Platform billing / support / techops |

## What is in it

The spec has 18 sections. Screens map to routes (see `src/registry.tsx` or the in-app **All screens** page).

| Spec section | Where |
| --- | --- |
| 2 Website and access | public site, sign up, verify, sign in, 2FA, recovery, invitations, workspace selection, access denied / suspended / expired, profile, security, sessions, notification preferences |
| 3 Subscriptions and onboarding | `/app/setup/*`, `/app/plan/*` |
| 4 Roles and isolation | `/app/users/*` |
| 5 Masters | `/app/masters/*` |
| 6 Quotations | `/app/quotes/*` |
| 7 Invoices | `/app/invoices/*` |
| 8 Recurring | `/app/recurring/*` |
| 9 Receipts and allocation | `/app/receipts/*` |
| 10 Credits and disputes | `/app/credits`, `/app/debits`, `/app/disputes/*` |
| 11 Collections | `/app/collections/*` |
| 12 Expenses, bills, payables | `/app/expenses/*`, `/app/bills/*`, `/app/payables/*` |
| 13 Reconciliation | `/app/reconciliation/*` |
| 14 Portal and finance team | `/portal/*`, `/app/finance-inbox`, `/app/reviewer-queue` |
| 15 Reports | `/app/reports/*` |
| 16 Templates, imports, lifecycle | `/app/templates/*`, `/app/imports/*`, `/app/lifecycle/*` |
| 17 Platform admin | `/admin/*` |
| 18 Integrations | `/app/integrations/*` |

### Rules that are enforced (and tested)

- Money is integer paise. GST splits CGST+SGST (intra-state) or IGST; totals round to the rupee.
- Draft vs issued: issuing assigns the number and locks the document. Corrections are credit note + replacement draft.
- Receipts can be split across invoices, never over-applied; duplicate references and replayed provider callbacks credit nothing twice.
- Credits cannot exceed the outstanding balance; requesters cannot approve their own request; rejections need a reason.
- Locked periods refuse backdated issue, void, reversal and adjustment. Document numbers can only move forward.
- Disputed amounts pause reminders; undisputed balances stay collectible. Unreviewed reminder templates cannot be activated.
- Duplicate vendor bills are refused; supplier bank changes block payment until approved.
- Accounting export is refused until every bank row is matched and approved.
- Customers see only their own organisation. Staff see only their own expense claims. Roles are checked on every navigation.

## Run on Supabase (real accounts, shared data)

Without configuration the app is a browser demo. Set two build variables and it runs on your Supabase database instead:

```bash
cp .env.example .env.local     # fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (anon key only)
```

1. Create a Supabase project (or run `supabase start` locally).
2. Apply `supabase/migrations/*.sql` (`supabase db push`, or `supabase db reset` locally, which also loads `supabase/seed.sql`).
3. Build and host the static site as below.

Two businesses, role-scoped users and customer portal accounts from the demo are in `seed.sql` (password `demo`). Do **not** load that seed into a production project.

What the database enforces, whatever the browser does (tested against real Postgres, `npm run test:db`):

- **Isolation:** every row belongs to a business; a signed-in user sees only businesses they are an active member of. Customers see only their own organisation and never drafts; staff cannot read bank, bills, suppliers, API keys or integrations.
- **Writes by role:** staff can prepare documents but not change periods, numbering, settings or members; only owners manage members, and a business always keeps an owner.
- **Money rules:** issued invoices and accepted quotations are frozen; allocations cannot exceed a receipt or an invoice or cross customers; locked periods refuse backdated documents; document numbers, receipt references, provider events and vendor bills cannot be duplicated; requesters cannot approve their own adjustment; the audit trail is append-only; numbering never goes backwards.
- **Access changes take effect on the next request:** suspending a member or revoking a customer's portal access removes their data access at once.

If the database refuses a change, the app shows the reason and reloads the server's copy.

## Honest limits: read before launch

- **Demo mode** keeps data in the browser (`localStorage`) with synthetic data, and sign-in is a demo. Never enter real data there.
- **Supabase mode is built and unit/DB-tested but has not been run against a live Supabase project** in this repository's checks (no Docker or project was available). The SQL ran on Postgres 16 with a stand-in for Supabase's `auth` schema; the client was verified to build, boot and fail safely, and its sync planner is unit-tested. Run it once against a real project before relying on it, and expect small fixes.
- **Business rules beyond the database** (approval thresholds, reminder pausing, matching suggestions, GST maths) still run in the browser. The invariants listed above are the ones the database guarantees.
- **Not wired yet:** payment provider and email (still simulated; the portal shows a bank-transfer notice in Supabase mode), two-factor sign-in (Supabase TOTP), creating platform staff or customer portal accounts from the UI (invite through Supabase Auth; `claim_access()` attaches them on first sign-in), password-reset email.
- **Policy pages are working drafts** and must be approved by counsel. Statutory e-invoicing/IRN is not implied by the PDF output.
- Not included, as the spec states: general ledger, statutory filings, live bank feeds, OCR, e-signatures, SSO, native apps, multi-currency consolidation.

## Deploy

`npm run build` writes a static site to `dist/` (relative asset paths, hash routing), so it works from any path
on any static host (Hostinger, Cloudflare Pages, Netlify, Render static site, S3 + CDN).
