# Administrator guide

**Business owner** (per company): Settings → company details, invite people (Settings → Team), change a role or deactivate (reason required; the person's sessions end immediately), approve or deny platform-support access requests (time-limited), import CSV (preview first), Plan & billing (upgrade with proration, pay, retry failed payment, cancel at period end), Audit trail, CSV exports.
**Roles**: owner, manager, planner, buyer, storekeeper, supervisor, operator, quality, sales, finance, viewer; portal roles customer and supplier (linked to a customer/supplier record). The permission matrix is in `lib/server/perms.ts` and shown (sensitive permissions) in Settings.
**Approvals with separation of duty**: a purchase order cannot be approved by its creator; an engineering change cannot be approved by its requester; stock adjustments/reversals, cost corrections, inspection decisions and NCR dispositions need their specific permission and a reason.
**Platform staff** (`/admin`): owner (all), billing (plans, invoices, refunds records, coupons), support (businesses, tickets, access requests, user suspension), techops (jobs, webhooks, email). Support cannot read tenant records; they must request access, which the company owner approves for a limited time.
**Closing a period**: Costing → Close period (fails if open jobs remain). Later corrections post to the current open period.
**Failed jobs**: Admin → Jobs, webhooks & email → Retry (bounded retries with backoff happen automatically).
**Sample data**: only loadable into an empty workspace; the workspace shows a DEMO DATA marker until the owner clears it.
