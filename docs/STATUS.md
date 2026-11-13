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
| 14 Purchasing, stores, assets | **Not built** | |
| 15 Portals | **Not built** (patients can see their own published lab results at database level only; no portal UI) | |
| 13 Billing | Invoices, payments, insurance + **tariff versions with snapshot charges, bed-day charges, bills from charges, deposits, refunds with second-person approval** | `billing.test`. **Missing:** packages, estimates, discount approval, corporate payer contracts, per-payer split beyond the insurance claim fields. |
| 16 Governance, 17 Super admin, 18 Integrations | **Not built** (audit log exists) | |

## Verification (latest run, real local Supabase in Docker)
* `npm run db:reset` then `npm run test:db`: **1388/1388** (includes `auth-e2e`, RLS matrices for every table, concurrency races for bed allocation and dispensing).
* `npm run test:unit`: 205/205. `npx tsc --noEmit` clean. `next build` succeeds.
* `scripts/smoke.mjs`: ~70 role/screen checks incl. axe WCAG A/AA, role redirects: pass (one transient failure right after a reset was not reproducible in 3 reruns).
* `scripts/journey.mjs` (inpatient, 18 steps) and `scripts/journey2.mjs` (billing, investigations, pharmacy, theatre, 33 steps): pass. Run `npm run db:reset` before each.
* Defaults that need hospital approval: lab results need a second reviewer; refunds, returns need a second person; controlled medicines need a witness; emergency theatre start may override the checklist with a reason; critical acknowledgement window is 30 minutes (`clinics.critical_ack_minutes`).
* Not done: lint (no ESLint config), phone-width checks of logged-in screens, load/restore drills, deployment (no target or credentials supplied).
