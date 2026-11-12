# Scope checklist — evidence and honest gaps

Legend: **V** = verified by automated test against a real database and/or real browser run in this environment · **B** = built and loads without error, not exercised end-to-end · **P** = partial · **N** = not built.
Test totals at handover: 23 unit, 49 database (isolation, identity, full commercial chain), 8 real-browser journeys.

| Scope section | Status | Notes |
|---|---|---|
| 2 Public site: home, product, solutions, pricing, demo, contact, help, updates, policies | **V** (loads + lead forms B) | Policy text is a **draft needing legal approval**. Trial = sign-up. "Add-ons" is a text list. |
| 2 Auth: sign-up, verification, sign-in, 2FA (TOTP), recovery, invitations, workspace switch, denied/suspended/expired, profile, security, sessions, notification prefs | **V** (db tests: lockout, reset single-use/expiry/session revoke, MFA, invites; browser: sign-up→verify→login, wrong password) | SSO/other languages not included (as scoped). Email delivery via Resend is **unverified** (no key here). |
| 3 Subscriptions: plans/versions, entitlements, checkout, proration, coupons, GST, grace, read-only, cancel, downgrade rules, invoices | **V** logic + browser test-payment; **live Razorpay unverified** | Saved payment methods & automatic recurring charge not built: renewals create a due notice + grace, customer pays via checkout. Onboarding steps/sample-data screen: checklist **P**; guided import/sample data **N**. |
| 4 Roles: directory, invitations, role editor, branch assignment, sensitive permissions, suspension, audit, support-access approval | **V** (db) / **B** (UI) | Role editor, sensitive grants, branch assignment UIs are not browser-tested. Record-ownership filters **N**. |
| 5 Projects, parties, WBS, authority matrix, dashboards | **V/B** | Effective-dated assignments; separate approval authority + limits. Consultants as separate party records: via Companies. |
| 6 Tender, estimate revisions, BOQ import, rate analysis, award, baseline budget, contingency | **V** (db) / **B** UI | CSV import preview/commit UI built; column-mapping UI **N** (fixed agreed format). |
| 7 Contracts, milestones, advance/retention/security, guarantees, amendments | **V** (db) / **B** | Renewal workflow **N**. Security-deposit ledger kind exists; no deposit-specific screen. |
| 8 Planning: activities, dependencies (cycle + FS conflict checks), baseline versions, variance, resources, material needs | **V** (db) / **B** | Equipment allocation = resource lines. Lookahead view **N**. |
| 9 Drawings, revisions (supersede), transmittals, RFIs (+portal response) | **V** (db) / **B** | Annotations/inspection links **N**. |
| 10 Procurement/stores: MR, approval, RFQ compare, PO (authority + budget), GRN with quarantine, issue, transfer, returns, count | **V** (db, incl. concurrency) / **B** UI | Delivery-schedule screen **N**. |
| 11 Daily reports: draft, labour, equipment, photos with retry, claimed vs verified, correction | **V** (browser: mobile submit→verify; db) | Weather note is free text. Offline sync **N** (as scoped optional); local draft backup built. |
| 12 Subcontract: packages, bids, work orders, measurement (cumulative, tolerance, duplicate block), 3-person approval, bills with visible deductions | **V** (db) / **B** UI | Rate-version screen **N**. |
| 13 Quality/safety: inspections, hold points, NCR + evidence, observations, restricted incidents | **V** (db) / **B** | Checklist item editor **N** (title/outcome only); attachments supported. |
| 14 Billing: measurement book, cumulative RA bills, partial certification, retention, advance recovery, invoices, receipts, disputes/write-off, variations (rate-locked) | **V** (db worked examples) / **B** UI | Worked example numbers in `tests/unit` and `tests/db/chain.test.ts`. Client-portal certification path **B** (not browser-run). |
| 15 Portals: client/consultant/contractor home, drawings, bills, variations, RFIs, forecast | **V** (isolation in db + browser: client sees portal only) / **B** decisions | Variation decision limited by delegated authority (db-tested). |
| 16 Snags, checklist, warranties, final account, defect period, close, export ZIP | **V** (db) / **B** | Opening-balance **migration with reconciliation N**. Retention release exists on contract. |
| 17 Platform admin: overview, businesses, trials, plans/versions, subscriptions, invoices/payments, refunds, coupons, suspension, tickets, incidents, jobs+retry, webhook log, staff, announcements | **B** (loads for authorised staff; not browser-run) | Staff areas are permission-separated and 2FA-gated. Storage/deletion-failure view is a count only. |
| 18 Integrations: Razorpay webhook (signed, idempotent), mail outbox, CSV import/export, jobs with retries | **V** logic / **B** | API keys & outbound-webhook endpoint **tables exist; no UI or delivery**. Field-mapping **N**. |
| 20 Security: RLS tenant isolation, cross-tenant FK guard, guessed-id tests, append-only audit/stock ledger, upload type/size/magic-byte checks, headers | **V** | **Malware scanning N** (hook point: `lib/storage.ts`). Load/performance and concurrency targets **not measured**. |
| Accessibility / responsive | **P** | Labelled forms, visible focus, 44px targets, no horizontal scroll at 390px verified on 2 screens. **No automated axe audit, no tablet/Safari/Firefox pass.** |
| Premium UI design | **P** | Tokens from brief; not reviewed by a designer; no Figma files. |
