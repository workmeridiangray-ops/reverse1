# Administrator guide

**Company owner.** Settings → Business (legal name, GSTIN, address) → Masters (branches, warehouses, items with units/tax/price lists, customers, suppliers) → opening stock (Inventory → Counts) → Team (invite with a role and optional branch limits) → Studio (approval thresholds, custom fields, numbering) → Billing (choose plan). Downgrades are scheduled for period end and refused until users/branches fit. Removing a user or changing a role ends their sessions immediately.

**Day to day.** Quotation → approval → order → confirm (reserves stock, shows shortage; credit limit may place it on hold; override needs permission + reason) → raise purchase request → approve → PO → receive (partial OK; backorders auto-allocated oldest first) → dispatch → invoice → receipt. Corrections are reversals/credit notes with a reason, never edits. Close a period only after drafts are posted; reopening needs a reason.

**Platform staff.** `/platform`: suspend/restore companies (reason; ends sessions), extend trials, grant credit, publish plan versions (existing subscribers keep theirs), record refunds (issue the refund in Razorpay too), retry failed jobs, request time-limited read-only support access (the company owner approves in Settings → Data), publish announcements, handle demo requests, confirm company closure after the final export.

**Support access.** Staff cannot read company records: the database refuses it in platform mode. Staff can *request* access and owners can approve (1–72 h), deny or revoke it, all audited — but the read-only viewer that would use an approved grant is **not built yet**, so today a grant is a recorded authorisation only.
