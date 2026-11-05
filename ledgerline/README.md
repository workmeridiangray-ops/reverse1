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
npm test           # business-rule unit tests
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

## Honest limits: read before launch

- **It is a front-end app.** Data lives in the browser (`localStorage`) and is seeded with synthetic data. There is no
  shared backend, so two users on two devices do not see each other's changes. The data layer is isolated in
  `src/store.ts`; replacing it with an API (and moving the role/tenant checks server-side) is the production step.
- **Payments, email and SMS are simulated.** No money moves and no email is sent. Connect one payment provider and one
  transactional email service, per the spec's integration allowances.
- **Authentication is a demo.** Passwords are checked client-side. Do not put real credentials or real financial data in it.
- **Policy pages are working drafts** and must be approved by counsel. Statutory e-invoicing/IRN is not implied by the PDF output.
- Not included, as the spec states: general ledger, statutory filings, live bank feeds, OCR, e-signatures, SSO, native apps,
  multi-currency consolidation.

## Deploy

`npm run build` writes a static site to `dist/` (relative asset paths, hash routing), so it works from any path
on any static host (Hostinger, Cloudflare Pages, Netlify, Render static site, S3 + CDN).
