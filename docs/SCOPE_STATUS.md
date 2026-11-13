# Scope status (against "Construction Project & Contractor ERP SaaS — Full Scope")

Evidence: `npm test` (100 unit + database-isolation tests), `npm run build`, `npm run test:e2e` (177 browser checks, 0 failures,
0 console errors; production build; real PostgreSQL 16; roles: owner, manager, engineer, client, second company, platform operator;
axe WCAG 2.1 A/AA scans on 11 pages with no violations).

Legend: **Verified** = exercised in the e2e/DB tests · **Built** = implemented, type-checked, not exercised end to end · **Not built**.

| Scope § | Area | Status |
|---|---|---|
| 2 | Public site (home, features, solutions, pricing from DB, demo, contact, help, updates, legal) | Verified loads + lead forms. Legal text is **draft, needs counsel**. |
| 2 | Sign up, sign in, recovery, invitations (revoke/expire/reuse), workspace switch, sessions, access denied, expired session | Verified. Email verification link: Built. **Two-factor, SSO: Not built.** |
| 3 | Trial, plan limits, plan change with downgrade checks, plan history, export | Verified/Built. **Payment checkout, renewals, proration, invoices, cancellation flow: Not built (no provider/credentials).** Activation is manual via platform console. |
| 4 | Roles/permissions matrix, invitations, suspension (immediate), audit trail, project assignment | Verified. Custom role editor, support-access approval UI: Not built (table `support_grants` exists, unused). |
| 5 | Projects, client, project team/access, lifecycle | Verified. Zones/WBS, authority matrix: Not built. |
| 6 | BOQ (CSV import with row errors), budget vs tender vs committed, contract basis | Verified. Opportunity/tender documents, rate analysis, estimate revisions, bid review: Not built. |
| 7 | Contract terms, retention/cap/advance/recovery, approval snapshot | Verified. Milestones, guarantees, obligations, amendment, renewal: Not built. |
| 8 | Schedule: activities, finish-to-start dependencies with loop detection, frozen baseline (never rewritten), variance + delay reasons, 3-week lookahead, progress measured from verified quantity | Verified. Resource plan, equipment allocation, recovery plans, critical-chain: Not built. |
| 9 | Drawing register, revisions, approve/supersede, distribution log, RFIs | Verified. Transmittals, annotations: Not built. |
| 10 | Material request → approval → PO → goods receipt, rejected quantities, budget commitment | Verified. RFQ/comparison, store issue, site transfers, returns, stock count: **Not built.** |
| 11 | Daily reports, review/return, photo upload (content-sniffed) | Verified. Upload auto-retry/offline: Not built. |
| 12 | Subcontract packages, work orders capped at permitted BOQ quantity, three-person measurement (prepare/verify/approve), cumulative bills with retention and material recovery, no double billing | Verified. Subcontract bids/rate versions, mobilisation advances, bill-level deduction library: Not built. |
| 13 | Inspections with hold points, snags, verification | Verified. Incident/safety records, nonconformance workflow: Not built. |
| 14 | Measurement book, cumulative running bills, partial certification, retention, advance recovery, variations, invoices, receipts, disputes, reversals | Verified with worked examples (₹1,91,250 and ₹1,78,500 nets). |
| 15 | Client/consultant portal (scoped, approved-only), decisions inbox | Verified. Cash forecast, cost-to-complete, portfolio reports: Not built. |
| 16 | Snag handover, completion checklist, closure, read-only after close, exports | Verified. As-builts/warranties/defect-period reminders, migration of opening balances: Not built. |
| 17 | Platform console: businesses, suspend/activate/extend trial (reasons), jobs + retry, leads, audit | Verified. Coupons, credits/refunds, payment failures, incidents, announcements: Not built. |
| 18 | Outbox email worker with bounded retries; health endpoint | Built; **real provider send never exercised**. Webhooks/API credentials/field mapping: Not built. |
| 20 | Isolation on every API/file/export/job; guessed ids; duplicate submits; concurrent bill creation; retry | Verified (DB tests + e2e). Load/recovery objectives, malware scanning: **not done**. |

## Limits / things you must do
- Replace draft legal pages; connect a payment provider and an email provider; provide hosting access and a domain.
- Run the restore drill in `docs/DEPLOY.md` and record timings; run load tests against real volumes.
- Browser coverage is Chromium only. Desktop (1280px) is covered by the e2e suite; a 390px touch-viewport pass (`scripts/mobile-check.mjs`, against a seeded demo database) found no horizontal overflow and no WCAG A/AA violations on 9 owner pages and 2 client pages. Tablet and Safari/Firefox were not tested.
- `scripts/seed-demo.mjs` was run and verified (demo owner/manager/engineer/client).
- Demo data lives only in a clearly flagged tenant (`scripts/seed-demo.mjs`, `tenants.is_demo`); never run it on a customer database.
