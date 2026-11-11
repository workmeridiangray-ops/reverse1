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
| 10 Theatre, 11 Investigations, 12 Pharmacy, 14 Purchasing, 15 Portals | **Not built** | |
| 13 Billing | Phase 1 invoices, payments, insurance | Tariff versions, packages, deposits ledger, refunds, payer contracts not built. |
| 16 Governance, 17 Super admin, 18 Integrations | **Not built** (audit log exists) | |

## Verification limits in this build environment
* No Docker daemon and no access to download GoTrue/PostgREST, so
  `tests/db/auth-e2e` and `scripts/smoke.mjs` (real sign-in) were **not run**.
  The database layer was tested on Postgres 16 with a Supabase shim
  (`scripts/local-pg.sh`). Screens behind login were type-checked and built but
  **not exercised in a browser**.
* No deployment target or credentials were provided; nothing is deployed.
