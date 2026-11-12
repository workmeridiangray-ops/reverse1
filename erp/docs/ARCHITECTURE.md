# Architecture and rules that matter

**Tenancy.** Every business table has `tenant_id`; child rows reference parents by `(tenant_id, id)` composite foreign keys, so a row cannot point at another company's record. PostgreSQL row-level security (FORCE) scopes every query to `app.tenant_id`, set per transaction by `withTenant*`. The app connects as a non-owner role without BYPASSRLS. Control-plane tables (identity, billing, audit, jobs) use a separate `app.system` mode that **cannot** read business documents (tested). Platform staff therefore see company metadata only; reading records needs a company-approved, time-limited support grant.

**Money and quantity.** Integer paise (bigint) and integer thousandths of the base unit. Half-up rounding at each of gross → discount → tax. Tax is one combined rate per tax code (no CGST/SGST split).

**Stock.** `stock_movements` is append-only (trigger + revoked UPDATE/DELETE). `stock_balances` (on-hand, reserved, in-transit) are updated only through `moveStock/reserveStock` under `SELECT … FOR UPDATE`; CHECK constraints guarantee `reserved ≤ on_hand`. A unique index on (doc_type, doc_line_id, kind) rejects duplicate postings.

**Ledger.** Deferred constraint trigger rejects any non-draft journal whose debits ≠ credits; posted journals/lines are immutable (reverse instead); closed periods reject postings; missing periods reject postings. Posting rules (decided here — confirm with the client's accountant):
| Event | Entry |
|---|---|
| Goods receipt | Dr Inventory / Cr GRNI at PO cost |
| Supplier bill (matched) | Dr GRNI (+/- purchase price variance) + Input tax / Cr Payables |
| Dispatch | Dr COGS / Cr Inventory at weighted-average cost (stock and COGS post at dispatch) |
| Invoice | Dr Receivables / Cr Sales + Output tax (revenue posts at invoice) |
| Receipt | Dr Cash / Cr Receivables (unallocated stays on account) |
| Credit note | Dr Sales returns + Output tax / Cr Receivables; excess over outstanding becomes a refund due |
| Return restocked | Dr Inventory / Cr COGS (once, at dispatch cost) |
| Stock count | Dr/Cr Inventory adjustments vs Inventory |

**Jobs.** `jobs` table, claimed with `FOR UPDATE SKIP LOCKED`, bounded retries with exponential backoff, `dead` state visible in the platform console, dedupe keys. Run `npm run worker` (or call `POST /api/cron/jobs` every minute with `Authorization: Bearer $CRON_SECRET`; add `?sweep=1` every 10 min for renewals/grace/trial expiry).

**Payments.** Provider adapter (`lib/billing/provider.ts`): `razorpay` (orders API, checkout, HMAC-verified webhooks) or `test` (built-in simulator that posts signed events to the real webhook path; disabled in production). Webhooks are verified on the raw body, stored once by provider event id, applied as retryable jobs, amount-checked and idempotent. Subscriber billing tables are separate from each company's own books.

**Security controls.** scrypt passwords, optional TOTP + recovery codes (mandatory for platform staff), login throttling, idle + absolute session expiry, session revocation on role change/removal/password reset, CSP + security headers, upload type/size/signature checks, CSV formula neutralisation, SSRF-guarded webhooks, append-only audit log.
