# Launch checklist

The application and database are complete for the scope listed in README. Items below need
accounts, keys or decisions that code cannot supply. Nothing here has been done for you.

## 1. Infrastructure (once)
1. Create a Supabase project (Mumbai region for INR customers). Run `supabase link` then `supabase db push` — applies `supabase/migrations/*` in order.
2. Auth → enable email confirmations, set Site URL and redirect URLs to the production domain, configure SMTP (Brevo/SES) so verification mail leaves from your domain.
3. Create your own account via /signup, then promote it: `insert into public.platform_admins select id from auth.users where email='you@…';`
4. Deploy `berp/` (Vercel/Render/Hostinger Node). Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Never expose the service-role key to the app; it is not used.
5. Turn on Supabase backups (PITR on a paid plan) and **test a restore** before onboarding customers.

## 2. Subscription payments (not built)
`change_plan()` switches the plan and logs a `subscription_events` row, but collects no money.
Pick a provider (Razorpay Subscriptions or Stripe), then: create plans there, add a webhook route that verifies the signature, is idempotent on the event id, and calls a definer function to set `tenants.status` (`active` / `past_due`) and insert `subscription_events`. Define grace period and proration with your accountant.

## 3. Decisions before real customers
- Accountant sign-off on posting rules (inventory/GRNI/COGS/GST accounts in `create_workspace`).
- Revenue and stock recognition: currently stock and COGS post at dispatch, revenue at invoice.
- Tax: GST rates are per item; no filing, e-invoicing, e-way bills or TDS.
- Data retention, closure export and deletion policy (tenant rows with posted ledgers are intentionally not cascade-deletable).
- Privacy policy, terms and DPA pages (linked from the footer once approved).
- Load targets: tenants, users, rows, concurrency. Reservations serialise per tenant with an advisory lock — fine for hundreds of orders/min per tenant, measure before promising more.

## 4. Known limitations
- Single operating currency (INR) and language (English); one stock location per order.
- Receipts allocate to invoices explicitly; over-payment/advance and credit notes are not modelled.
- Item cost used for COGS is the master cost, not a moving average from receipts.
- Authenticated screens were type-checked and built, and the data layer is covered by the DB suite, but no browser end-to-end run against a live Supabase stack has been done yet. Do one before launch (sign up → full order-to-cash).
