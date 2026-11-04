# Project brief: multi-company network-management SaaS

A multi-company SaaS platform for managing business networks: franchises, company-owned branches, regional offices, outlets, kitchens, service centres, and other locations.

Each subscribing company gets its own workspace, branding, organisation structure, users, operating rules, financial settings, and reports. The platform controls subscriptions, access, usage limits, support, and the underlying software.

The product is **a shared management foundation plus industry-specific modules**. Restaurants, printing businesses, and education chains share branch management, purchasing, inspections, training, and support. Their specialised daily workflows need different screens and rules.

The scope below is the proposed full product and screen inventory. Tabs, forms, drawers, and approval steps may sit within a parent screen during design.

- Part A: Product scope (sections 1–27)
- Part B: UI/UX direction

---

# Part A: Product scope

## 1. Platform hierarchy

| Level | What it represents | Example |
|---|---|---|
| SaaS platform | The software business | Your brand |
| Tenant/company | A subscribing organisation | A restaurant group |
| Brand | A brand operated by that company | Two restaurant concepts |
| Legal entity | Company responsible for contracts and billing | Separate operating companies |
| Region/area | Management grouping | East region |
| Franchise partner | Independent operator within the network | Partner operating five outlets |
| Branch/location | Physical or operational unit | One outlet |
| Department/team | Responsibility within a location | Kitchen, accounts, sales |
| User | Person with scoped access | Regional manager |

These relationships must be configurable. A company with three branches must not be forced to create regions, franchise partners, or multiple brands.

One person may belong to several companies but **must explicitly switch workspaces**. Their access and data remain separate.

## 2. Roles and dashboards

Roles are configurable permission bundles, not a fixed set of titles.

| Role | Primary access |
|---|---|
| Platform super admin | Entire SaaS business |
| Platform billing admin | Subscriptions, invoices, collections, credits |
| Platform support | Tickets and approved customer assistance |
| Platform technical operations | Health, failures, integrations, deployment diagnostics |
| Company owner | Entire subscribing company |
| Company administrator | Organisation settings, users, modules |
| Brand head | Assigned brands |
| Regional/area manager | Assigned locations and teams |
| Franchise owner | Own franchise agreement and branches |
| Branch manager | Own branch operations |
| Department head | Assigned department |
| Finance/purchasing/HR/training staff | Relevant functional modules |
| Auditor/inspector | Assigned inspections and corrective actions |
| Employee | Assigned tasks, forms, training, requests |
| Supplier/contractor | Limited external portal |
| External accountant/adviser | Explicitly permitted records |

**Permissions** cover: view, create, edit, approve, reject, assign, export, delete/archive, pay, refund, configure, and access sensitive fields.

Access also depends on **company, brand, region, branch, department, record ownership, and approval authority**.

## 3. Public SaaS website

Screens: homepage; product overview; franchise management solution; multi-branch management solution; industry pages (restaurants, printing, retail, education, services); feature/module pages; pricing and plan comparison; add-ons and usage explanation; interactive demo or product tour; book a demonstration; start trial; contact sales; help centre; product updates; integration directory; about; privacy, terms, subscription/cancellation and other approved policy pages; service-status page.

Scope: explain what each plan includes, which modules are optional, user/location limits, trial restrictions, and support coverage. Public marketing content stays separate from private company records.

## 4. Authentication and account access

Screens: sign up; email/contact verification; sign in; two-factor authentication; recovery codes; forgot/reset password; accept invitation; invitation expired/revoked; join an existing company; create a company; workspace selector; request access; access awaiting approval; account suspended; session expired; personal profile; security settings; active sessions/devices; notification preferences.

Scope: account recovery, session revocation, verification, optional SSO, secure workspace switching, and protection against unauthorised organisation discovery.

## 5. Company onboarding

Screens: welcome and setup checklist; business profile; industry selection; operating model selection; country, currency, timezone and financial year; brand/legal-entity setup; organisation structure setup; first branch; module selection; plan selection; billing details and checkout; invite team; import existing data; choose operating templates; configure approvals; sample-data workspace; setup review; activate workspace.

Scope: save progress, resume later, validate prerequisites, explain incomplete steps, allow assisted onboarding requests, and distinguish sample data from live records.

Operating models: company-owned branches, franchises, mixed networks, private internal operations, and service networks.

## 6. Platform super-admin workspace

The dashboard for selling and operating the SaaS.

Screens: platform overview; company directory; company account detail; trial accounts; onboarding progress; subscription plans; plan editor and version history; module/add-on catalogue; feature entitlements; subscription detail; usage and overages; billing/invoice list; payment failures and recovery; credit notes/refunds; coupons/promotions; account suspension/reactivation; cancellation requests; platform staff and permissions; support overview; service incidents; background jobs and failed tasks; integration health; storage/usage overview; platform audit log; global templates; announcements; platform settings.

Scope: plan changes must not silently rewrite historical invoices or remove access to unresolved paid work. Support access to customer workspaces must be permission-controlled, time-limited, and audited.

## 7. Company command centre

Screens: company overview; owner dashboard; brand dashboard; regional dashboard; franchise-owner dashboard; branch-manager dashboard; department dashboard; employee home; exceptions and alerts; pending approvals; assigned actions; calendar; activity feed; announcements; saved dashboard views.

Scope: each dashboard shows relevant information and actionable exceptions. Widgets depend on enabled modules and permissions. Examples: overdue inspections, unacknowledged SOP updates, unpaid royalties, purchase delays, equipment downtime, unresolved customer complaints.

## 8. Organisation, brands, and branches

Screens: organisation tree; brand directory/detail; legal-entity directory/detail; region/area directory/detail; franchise-partner directory/detail; branch directory; branch map; branch profile; create/edit branch; opening hours; contacts; capabilities/services; documents; staff; targets; lifecycle history; transfer/reassign branch; suspend/close branch; reopening checklist.

Scope: central defaults with authorised local overrides. Preserve historical reporting when a branch changes region, ownership, brand, or manager. Closing a branch must address pending orders, stock, dues, assets, integrations, users, and retention.

## 9. Franchise acquisition and onboarding

Screens: franchise enquiry form; applicant pipeline; applicant profile; qualification checklist; meeting/site-visit record; territory map and availability; territory reservation; proposal; application review; document verification; agreement register; agreement detail/version; fee/deposit schedule; franchise approval; opening project; launch-readiness dashboard; renewal pipeline; ownership transfer; termination/offboarding.

Scope: track applications through opening without confusing a prospective franchisee with an active partner. Define agreement dates, renewal reminders, territory conflicts, required evidence, and approval authority. Electronic signatures and legal-document generation are separately selectable integrations.

## 10. Branch opening and project management

Screens: opening-project list; project detail; milestones/timeline; site readiness; fit-out and branding checklist; equipment readiness; recruitment readiness; licence/document checklist; training readiness; budget and expenditure; vendor/contractor assignments; site photographs/evidence; dependency blockers; launch approval; post-launch review.

Scope: templates vary by industry (a restaurant opening checklist differs from a print centre), while task ownership, deadlines, evidence, escalation, and approval use the same engine.

## 11. Daily operations, tasks, and approvals

Screens: daily branch workspace; opening checklist; closing checklist; recurring checklist schedule; form submission; submission review; task list; kanban/calendar views; task detail; assignment/reassignment; approval inbox; approval detail; delegation; escalation queue; missed submissions; operational incidents; shift handover.

Scope: recurring tasks, mandatory evidence, deadlines in branch timezones, dependencies, comments, checklists, approval/rejection reasons, resubmission, overdue escalation, completion history. Approval rules may depend on amount, branch, department, issue severity, or document type.

## 12. SOPs, documents, and knowledge

Screens: knowledge home; SOP library; SOP reader; SOP editor; version comparison/history; review and publish; audience assignment; acknowledgement tracker; document library; document detail; expiry/renewal tracker; template library; search results; archive.

Scope: draft/review/published states, effective dates, restricted content, downloadable templates, acknowledgements, branch applicability, replacing obsolete instructions. A revised SOP can trigger new training or acknowledgement tasks.

## 13. Inspections, audits, and corrective actions

Screens: inspection dashboard; audit-template library; checklist/scoring editor; inspection schedule; assigned inspections; conduct inspection; evidence capture; inspection report; score breakdown; findings register; corrective-action detail; verification queue; reinspection; dispute/review; compliance trends.

Scope: weighted scores, critical failures, required comments/evidence, assigned corrective actions, due dates, escalation, proof of correction, independent verification, reopening unresolved findings. Offline inspection capture is a separately defined capability with synchronisation rules.

## 14. Training and certification

Screens: training dashboard; course catalogue; course detail; lesson player; course/lesson editor; quiz builder; assessment; assignment rules; learning paths; attendance; practical evaluation; completion tracker; certificate; expiring certifications; retraining assignments; trainer calendar.

Scope: role-based onboarding, required courses, pass marks, attempt limits, expiry, refresher training, branch-level completion reporting. Video hosting, live-class integrations, advanced content standards, and proctored exams need explicit selection.

## 15. People and workforce coordination

Screens: employee directory/profile; employment/assignment details; branch transfers; role and skill register; document checklist; shift roster; availability; leave/request submission; attendance summary; staff shortage alerts; onboarding/offboarding checklist.

Scope: basic workforce coordination sits in the shared product. Full payroll, biometric attendance, recruitment, statutory calculations, and country-specific HR compliance are separate modules or integrations.

## 16. Purchasing, suppliers, and inventory

Screens: purchasing dashboard; approved supplier directory/profile; approved-item catalogue; purchase requisition; approval queue; request for quotation; supplier quotation comparison; purchase order; supplier order acknowledgement; goods receipt; partial receipt/discrepancy; return to supplier; supplier invoice attachment; stock overview; location stock ledger; stock transfer; transfer receipt; stock count; adjustment/wastage; reorder alerts; supplier performance.

Scope: branch requisition → approval → order → receipt → discrepancy handling. Define units, taxes, quantities, partial deliveries, cancellation, and approval limits. Batch/expiry tracking, recipes, manufacturing, and full warehouse operations are selectable extensions.

## 17. Sales reporting, fees, royalties, and finance

Screens: sales dashboard; daily sales submission; sales import; POS reconciliation; revenue adjustments; royalty-rule configuration; royalty calculation preview; royalty statement; franchise fee/deposit ledger; invoice/dues register; collection status; payment allocation; credit note/adjustment; dispute; outstanding ageing; financial period close; accounting export.

Scope: fixed fees, percentage royalties, minimum guarantees, effective dates, exclusions, adjustments, and approval before finalising statements.

**Two payment relationships stay separate and balances are never combined:**

- Companies pay the platform for the SaaS.
- Franchise partners pay their brand royalties or other charges.

Marketplace payouts, stored-value wallets, and automated royalty collection require separately defined payment flows.

## 18. Marketing and local campaigns

Screens: campaign dashboard; campaign calendar; campaign brief; participating branches; asset library; localisation request; creative approval; branch execution checklist; proof of execution; campaign budget; lead/customer-enquiry allocation; results submission; performance comparison.

Scope: central teams distribute approved campaigns; branches request permitted changes, execute activities, upload evidence, and report results. Advertising-platform buying, social publishing, and full customer CRM are separate selectable capabilities.

## 19. Customer experience, tickets, and incidents

Screens: support dashboard; ticket list/detail; raise request; ticket assignment; SLA/escalation configuration; complaint register; incident report; major-incident workspace; resolution verification; feedback/survey builder; response dashboard; customer escalation history.

Scope: separate internal branch requests, end-customer complaints, and platform support. Route each to the appropriate company, branch, department, or SaaS support team. Support audit-linked issues, equipment failures, purchasing queries, refund requests, and safety incidents through configurable categories.

## 20. Assets, maintenance, and licences

Screens: asset directory/detail; asset assignment; location transfer; warranty/AMC register; maintenance calendar; breakdown request; work order; contractor assignment; service report; downtime history; disposal approval; licence/permit register; expiry reminders.

Scope: track ownership, location, serial numbers, service dates, cost, warranty, recurring maintenance, evidence, and business interruption. Specialised printer agents or restaurant equipment integrations are industry modules, not automatic features of the shared asset register.

## 21. Reports and business intelligence

Screens: report library; branch comparison; region/brand comparison; franchise-partner scorecard; operations compliance; audit trends; training compliance; purchasing performance; stock exceptions; sales/royalty performance; support performance; asset downtime; custom report builder; scheduled reports; export history.

Scope: permission-aware filters, saved views, agreed metric definitions, timezones, reporting periods, drill-down, CSV/PDF exports, scheduled distribution. Benchmarks between unrelated subscribing companies must never expose private business data.

## 22. Workflow and configuration studio

Essential for supporting different industries.

Screens: industry-template selector; module enablement; custom fields; form builder; checklist builder; workflow builder; approval-rule builder; notification rules; escalation rules; numbering formats; status configuration; terminology settings; branding; template preview/test; configuration version history.

Scope: companies configure approved building blocks rather than requesting custom development for every variation. Include field types, validation, conditions, permissions, applicability, effective dates, and safe publishing. Configuration changes must not corrupt existing submissions.

**Do not promise unrestricted no-code software creation.** The builder operates within defined modules and supported rules.

## 23. Integrations, imports, and external portals

Screens: integration marketplace; connection setup; credential/permission management; data mapping; sync schedule; sync history; failed records; retry/reconciliation; import wizard; validation preview; duplicate resolution; export centre; API credentials; webhook subscriptions/logs; supplier portal; contractor portal; external-auditor access.

Scope: every integration needs a named provider, supported objects, direction of sync, frequency, source of truth, failure handling, and support responsibility. "POS integration" cannot mean every POS product; each supported connector has its own scope.

## 24. Industry modules

| Industry | Additional workflows/screens |
|---|---|
| Printing networks | Print-job orders, artwork checks, production status, printer/agent health, consumables, reprints, customer collection |
| Restaurants | Food-safety logs, temperature checks, cleaning schedules, wastage, recipe compliance, POS summaries, kitchen equipment checks |
| Retail | Promotions, stock transfers, merchandising inspections, returns summaries, product compliance |
| Education chains | Centre readiness, trainer qualifications, batch summaries, student-service complaints, academic-standard checks |
| Service networks | Appointment summaries, technician assignment, service checklists, job completion evidence, warranty follow-up |

These modules use the shared permissions, tasks, approvals, documents, and reporting foundation.

Full restaurant POS, school ERP, print-production software, and retail billing software remain distinct products unless explicitly included.

## 25. Subscription, limits, and company offboarding

Company-facing screens: current plan; compare/change plan; module add-ons; user/location/storage usage; billing contacts; payment methods; invoices and receipts; renewal failure; overage approval; cancel subscription; export company data; closure checklist.

Scope: trials, renewals, proration, upgrades/downgrades, grace periods, feature access, resource limits, export windows, deletion schedules. Define what happens when a company downgrades below its existing number of branches or users. Existing data must not simply disappear.

## 26. Screen states and behaviour

For each relevant screen, cover:

- Empty and first-use states.
- Loading and background processing.
- Validation and actionable errors.
- No permission and restricted fields.
- Draft, pending, approved, rejected, and resubmitted records.
- Archived, suspended, expired, and deleted records.
- Search with no results.
- Partial import or integration failure.
- Stale data and conflicting edits.
- Unsaved changes.
- Bulk-action confirmation.
- Export progress and failure.
- Trial/plan limit reached.
- Mobile and tablet layouts.
- Offline/reconnection behaviour where supported.
- Destructive-action confirmation and recovery where available.

## 27. Engineering and delivery scope

| Area | Required work |
|---|---|
| Architecture | Tenant isolation, organisation relationships, shared services, background processing, extensible module boundaries |
| Security | Authentication, permissions, protected files, session controls, sensitive-action logging |
| Financial integrity | Versioned rules, immutable transaction references, reconciliation, approval-controlled adjustments |
| Reliability | Retries, duplicate prevention, alerts, failure queues, backup and recovery |
| Data lifecycle | Imports, exports, retention, archival, closure, deletion |
| Quality assurance | Role/tenant isolation, workflow exceptions, financial calculations, integration failures, responsive behaviour |
| Operations | Production deployment, monitoring, incident procedures, documentation |
| Handover | Source, configuration guides, dependency list, administrator training, agreed operating responsibilities |

This is scoped as a modular SaaS product, with a **screen register** linking every screen to its role, workflow, permissions, data, and acceptance criteria. The inventory above is the product blueprint. The next design step is to turn each module into connected desktop/mobile flows and decide which parts belong in the first commercial release versus separately priced extensions.

---

# Part B: UI/UX direction

> Design a complete, premium SaaS platform for managing multiple companies, brands, franchises, and branches. The interface should feel calm, precise, professional, and carefully designed. It must make complex operations easy to understand, with clear priorities, readable information, and consistent behaviour across every module.

## B1. Visual direction

- Light interface with warm white backgrounds, subtle grey surfaces, dark charcoal text, and one restrained accent colour such as deep blue.
- Reserve semantic colours for clear meanings: green for success, amber for attention, red for errors, blue for information.
- Create depth through spacing, borders, and subtle elevation.
- Keep gradients, glass effects, decorative illustrations, and oversized rounded cards limited.
- Use a consistent icon family with labelled actions. No emoji icons.
- Allow company branding within controlled settings that preserve readability and consistency.

## B2. Typography and spacing

- One professional typeface such as Inter, with consistent weights and a clear hierarchy.
- Comfortable body text, readable table content, visible form labels.
- Align numbers consistently; use tabular numerals for financial figures and comparisons.
- 8-point spacing system, with consistent page margins, section gaps, and component padding.
- Keep long forms and reading content within comfortable widths. Let operational tables use the available workspace.

## B3. Navigation and workspace clarity

- Persistent desktop sidebar, compact top bar, clear page titles.
- Always show the active company and the relevant branch or regional scope.
- Keep workspace switching separate from report filtering.
- Group navigation by business activity: Operations, Network, People, Purchasing, Finance, Reports, Settings.
- Show modules according to permissions and subscription access.
- Preserve filters and position when users return from a record.
- Include global search, recent records, favourites, and a clearly visible notification centre.

## B4. Dashboard design

Every dashboard helps its user decide **what needs attention and what to do next**.

- Lead with pending approvals, overdue work, exceptions, and operational priorities.
- Keep summary metrics selective, with clear definitions and comparison periods.
- Each metric or alert opens the relevant filtered records.
- Use charts only when they explain a trend or comparison.
- Show when information was last updated.
- Provide useful first-use guidance when no business data exists.

## B5. Tables and record pages

Tables are a primary working surface.

- Search, relevant filters, sorting, pagination, saved views, and column controls.
- Comfortable and compact density where useful.
- Predictable row actions; permission-aware bulk actions.
- Status labels that remain understandable without colour.
- Readable financial totals, dates, owners, branches, and due dates.
- Quick previews in drawers; dedicated pages for detailed work.
- Record pages are structured around a clear summary, primary action, related information, documents, and activity history.

## B6. Forms and approvals

- Divide long forms into meaningful sections with clear progress.
- Persistent field labels, helpful examples, inline validation.
- Show conditional fields only when relevant.
- Save drafts for substantial workflows and protect unsaved work.
- Explain the effect of sensitive changes before submission.
- Approval screens show the request, supporting evidence, financial impact, previous decisions, and available actions together.
- Require reasons where rejection, adjustment, or override needs an audit trail.

## B7. Consistency across modules

Build a reusable design system before expanding the screens.

| Component group | Required patterns |
|---|---|
| Navigation | Sidebar, breadcrumbs, tabs, workspace switcher |
| Data | Tables, filters, charts, metrics, status labels |
| Forms | Inputs, selectors, uploads, date fields, validation |
| Actions | Buttons, menus, bulk actions, confirmations |
| Feedback | Notifications, inline alerts, loading, progress |
| Records | Detail pages, preview drawers, timelines, attachments |
| Workflows | Approval steps, checklists, assignments, activity history |

Use the same interaction for the same action throughout the platform. Industry modules inherit the shared system.

## B8. Responsive behaviour and accessibility

- Desktop screens for detailed administration; mobile screens for field work.
- Prioritise mobile tasks: inspections, evidence uploads, approvals, checklists, tickets, training.
- Adapt navigation and information hierarchy to smaller screens; design deliberate alternatives for wide tables.
- Keyboard navigation, visible focus, screen-reader labels, accessible contrast, comfortable touch targets.
- Respect reduced-motion preferences. Keep animation subtle and purposeful.

## B9. Complete screen states

Design populated, empty, loading, error, restricted-access, archived, and plan-limit states. Include partial failures, upload progress, conflicting edits, and recovery actions where relevant.

Messages explain **what happened, what was saved, and what the user can do next**.

## B10. Design acceptance criteria

The final design demonstrates complete connected workflows:

1. Company registration → setup → first branch → staff invitation.
2. Inspection → finding → corrective action → verification.
3. Purchase request → approval → order → partial receipt.
4. Royalty calculation → review → statement → payment allocation.
5. Subscription change → limit validation → billing confirmation.
6. Branch closure → outstanding-work review → access removal.

**Premium is visible in the details:** aligned layouts, restrained colour, clear wording, responsive controls, predictable navigation, and smooth handling of complicated work. Every screen feels like part of one coherent product.
