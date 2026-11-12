# Launch checklist

Everything the application can do without your accounts or decisions is built and tested.
The items below need accounts, keys or sign-off. Nothing here has been done for you.

## 1. Infrastructure (once)
1. Create a Supabase project (Mumbai for INR customers). `supabase link`, then `supabase db push` (migrations 0100–1300 in order).
2. Auth → enable email confirmations, set Site URL / redirect URLs to the production domain, configure SMTP so verification mail leaves from your domain.
3. Sign up yourself, then promote: `insert into public.platform_admins select id from auth.users where email='you@…';`
4. Deploy `berp/` (Vercel / Render / Hostinger Node). Environment:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and **server-only** `SUPABASE_SERVICE_ROLE_KEY` (used only by the payment webhook, `/api/v1` and the delivery worker, which filter by tenant explicitly), and `CRON_SECRET` (any random string of 16+ characters).
5. Turn on backups (PITR on a paid plan) and **test a restore** before onboarding customers.
6. Run `npm run test:e2e` once against a staging Supabase-compatible stack, or do the sign-up → collected-payment walkthrough by hand on staging.

## 2. Subscription payments (code done, needs your Razorpay account)
1. In Razorpay create six subscription plans (starter/growth/scale × monthly/yearly).
2. Env: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, and `RAZORPAY_PLAN_STARTER_MONTHLY`, `…_STARTER_YEARLY`, `…_GROWTH_*`, `…_SCALE_*` with the Razorpay plan ids.
3. Webhook URL: `https://YOUR-DOMAIN/api/webhooks/razorpay`; events: `subscription.charged`, `subscription.halted`, `subscription.cancelled`, `subscription.completed`, `payment.failed`.
4. Do a test-mode purchase end to end. The checkout call and webhook mapping are unit-tested but have **not** been exercised against Razorpay itself.
5. Behaviour: failed renewal → `past_due`, writes allowed for 7 days then read-only; success restores `active`; cancellation → read-only (`cancelled`). Confirm grace length and proration with your accountant.

## 2b. Outbound webhook worker
`vercel.json` calls `/api/cron/webhooks` every minute (per-minute cron needs a paid Vercel plan; elsewhere, schedule a POST with `Authorization: Bearer $CRON_SECRET`). Without it, events queue but are never sent.
Verify once on staging: create a webhook to a request-catcher URL, confirm an order, and check the delivery arrives with a valid `X-BERP-Signature`. Delivery code is unit-tested and DB-tested; the network leg could not run in the build sandbox.

## 3. Decisions before real customers
- Accountant sign-off on posting rules (inventory / GRNI / COGS / GST / maintenance accounts).
- Legal pages (terms, privacy, DPA) — not included; add and link from the footer.
- Data retention, closure export and deletion policy (tenants with posted ledgers are deliberately not cascade-deletable).
- Load targets (tenants, users, rows, concurrency). Stock reservation serialises per tenant with an advisory lock; measure before promising more.
- Customer receipts must be allocated to invoices; advances / refunds are not modelled.

## 4. Known limitations
- Tracking mode (none/batch/serial) is fixed once an item has moved. Transfers and spares of tracked items pick earliest-expiry unexpired lots unless lots are named in the API.
- Lot allocation at dispatch is earliest-expiry-first; reservations are per item and warehouse, not per lot.
- Labels are browser-printed sheets (Code 128); direct thermal-printer drivers (ZPL/TSPL) are not included.
- COGS uses the item master cost at dispatch, not a moving average from receipts.
- Single currency (INR) and language (English); an order ships from one warehouse.
- Project labour cost rates are set by the approving manager per time entry.
- Browser journeys ran in Chromium at desktop and 390 px widths; no Safari/Firefox pass, and no formal screen-reader audit.
