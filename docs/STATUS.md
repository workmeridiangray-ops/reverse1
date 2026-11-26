# Scope status (Hospital Management Information SaaS)

Honest map of the 22-section scope document against this repository.
"Verified" = automated test or observed run, with the evidence named.

| Scope section | State | Evidence / gap |
|---|---|---|
| 2 Website & access: home, features, pricing, demo request, policies, sign in | Partly built | Public pages pass axe WCAG A/AA at 390 and 1280 px; demo intake tested (`tests/db/demo-requests`). **Missing:** sign-up, email verification, 2FA, recovery, invitations, workspace switch, profile/security/sessions, SSO. Policy pages are marked draft. Pricing shows no prices (no provider). |
| 3 Subscriptions & onboarding | **Not built** | Needs a payment provider and decisions (plans, proration). |
| 4 Roles & isolation | Built for 7 fixed roles in one organisation per user | RLS matrices (`rls-read`, `rls-write`, `inpatient*`). **Missing:** role editor, invitations, multi-membership, support-access approval, session revocation UI. |
| 5 Structure & masters | Wards, beds, policy switches | Departments, specialties, charge catalogue, credentials, groups not built. |
| 6 Patients & appointments | Phase 1 | Duplicate review/merge, guardians, unknown identities not built. |
| 7 Outpatient consultation | Phase 1 SOAP notes with signing | Allergies, structured orders, amendments not built. |
| 8 Admissions & beds | **Built** | `inpatient.test`, `inpatient-flow.test` incl. real concurrent-allocation race, parity with `lib/rules/admission`. |
| 9 Nursing | Observations (append-only, corrections), care tasks with not-done reasons | Medication administration record, handover, escalation not built. |
| 10 Theatre | **Built (baseline)** | `theatre.test`: room/staff/patient conflicts refused by the database, checklist + consent gate, emergency override logged, versioned notes, late-change log. No anaesthesia/machine integration. |
| 11 Investigations | **Built (manual baseline)** | `laboratory.test`: accession, four-eyes review (reviewer is not the enterer), amendments as versions, critical-result acknowledgement and overdue escalation list, notifications, patient sees own published results. **Missing:** PDF attachments, CSV/analyser import, escalation by SMS/phone. |
| 12 Pharmacy | **Built (baseline)** | `pharmacy.test`: expired/quarantined/recalled stock blocked, FIFO list in UI, partial dispense, substitution approval by prescriber, returns reviewed by a second person, recall notifies prescribers, controlled-item witness, stock ledger balances, race between two pharmacists. **Missing:** purchase receipts against POs, formulary governance workflow, drug-interaction/allergy checks (out of scope). |
| 14 Purchasing, stores, assets | **Built (baseline)** | `purchasing.test`: request and PO each need a second person, goods receipt only against an approved PO and never above the ordered quantity, stock ledger balances, issue/transfer/count (count differences need a reason), supplier bill kept as a reference only, asset register, fault -> maintenance -> resolve with downtime. **Missing:** asset depreciation, biomedical certification, per-item batch/expiry for consumables, linking store receipts to the pharmacy ledger. |
| 15 Portals | **Patient portal built (baseline)** | `portal.test`: patients see only their own appointments, issued bills, active medicines, published lab results and discharge summaries a doctor has explicitly shared. No online payment (no provider), no proxy/guardian access, no document upload or sharing, no booking. Staff task inbox and management dashboards (occupancy, revenue, pending discharge) are **not built**. |
| 13 Billing | Invoices, payments, insurance + **tariff versions with snapshot charges, bed-day charges, bills from charges, deposits, refunds with second-person approval** | `billing.test`. **Missing:** packages, estimates, discount approval, corporate payer contracts, per-payer split beyond the insurance claim fields. |
| 16 Governance, 17 Super admin, 18 Integrations | **Not built** (audit log exists) | |

## Verification (latest run, real local Supabase in Docker)
* `npm run db:reset` then `npm run test:db`: **1823/1823** (includes `auth-e2e`, RLS matrices for every table, concurrency races for bed allocation and dispensing).
* `npm run test:unit`: 205/205. `npx tsc --noEmit` clean. `next build` succeeds.
* `scripts/smoke.mjs`: every role and screen incl. axe WCAG A/AA and role redirects: pass.
* Journeys through the real UI, each after a fresh `npm run db:reset`: `journey.mjs` (inpatient, 18 steps), `journey2.mjs` (billing, investigations, pharmacy, theatre, 33), `journey3.mjs` (purchasing, stores, assets, discharge to patient portal, 24): all pass.
* Bug found by journey 3 and fixed: reception could not read the discharge summary, so the page wrongly showed discharge as blocked. The page now asks the database (`discharge_blockers`) for what it will enforce.
* Defaults that need hospital approval: second reviewer for lab results, refunds, returns, purchase requests and orders; witness for controlled medicines; emergency theatre override with reason; critical acknowledgement window 30 minutes (`clinics.critical_ack_minutes`).
* Not done: lint (no ESLint config), phone-width checks of logged-in screens, load/restore drills, deployment (no target or credentials supplied).
* Demo seed has two administrators (`admin@cedarlane.test`, `admin2@cedarlane.test`) because four-eyes approval needs two.
