# Administrator guide

**Operator (platform) staff** sign in at `/login`; they land on `/platform`. They can list businesses, suspend/reactivate (reason mandatory), extend trials, activate a business against a payment reference, retry failed email jobs and read the audit log. They **cannot read customer project data** — the database gives the operator role no access to project tables.

**Business owners** manage Team (invite, role change, suspend — takes effect on the next request), Settings (business details, plan with limit checks on downgrade, JSON export), the Audit trail, and per-project Access (assign clients/consultants/restricted staff).

Roles: owner, project manager, site engineer, procurement, accounts, read-only, client, consultant (see the matrix on the Team page). A member with no explicit project assignments sees all projects; with any assignment, only those. Clients/consultants always need assignments.

Typical project flow: create project → import/add BOQ → (Budget) → contract terms → approve → award → site records measurements → manager verifies → accounts prepares bill → manager/client certifies (partial allowed with a note) → invoice → receipts / disputes → handover checklist → close.

Recovery: locked-out user → "Forgot password"; revoked/expired invitation → send a new one; wrongly posted receipt → reverse with a reason; wrong bill → return/cancel while draft or submitted.
