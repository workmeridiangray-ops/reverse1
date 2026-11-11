# Tendwell

Clinic management for small and mid-size clinics. Six roles (admin, doctor,
receptionist, lab, pharmacist, patient), every table behind row-level security,
and the business rules in small pure modules with their own tests.

**Status: Phase 1 + inpatient care.** Schema, auth and role routing, front desk,
doctor's day, patient and appointment CRUD, billing, plus wards and beds,
admissions, bed allocation/transfer/reservation, nursing observations and
tasks, discharge governance, a public marketing site and demo-request intake.
**Not built:** theatre, lab/imaging, pharmacy stock, purchasing/assets, patient
portal, subscriptions/payments, multi-hospital groups, SSO/2FA, migration
tooling, platform super-admin. See `docs/STATUS.md` for the full scope map.

> Clinical rules are placeholders until a clinician reviews them. Look for
> `CLINICAL PLACEHOLDER` and `CLINICAL_REVIEW_REQUIRED` in the code.

## Run it locally

Needs Node 22 and Docker.

```bash
npm install
npm run db:start                 # local Supabase: Postgres, Auth, REST, Realtime
cp .env.example .env.local       # paste ANON_KEY from `npx supabase status`
npm run dev                      # http://127.0.0.1:3000
```

Demo accounts (password `tendwell-demo-pass`): `desk@cedarlane.test`, `nurse@cedarlane.test`,
`dr.okafor@cedarlane.test`, `admin@cedarlane.test`, `lab@cedarlane.test`,
`pharmacy@cedarlane.test`, `amal.haddad@patient.test`, and a second clinic
`desk@northgate.test` to see isolation.

## Tests

```bash
npm run test:unit    # pure rules, no database
npm run db:reset     # re-seed, then:
npm run test:db      # RLS, audit and parity tests against real local Supabase
npm run db:local     # no Docker? plain Postgres 16 + Supabase shim, migrations and seed (tests/db except auth-e2e)
npm run db:types:local  # regenerate lib/supabase/database.types.ts without Docker
npm run test:smoke   # with `npm run dev` running: every role, every screen, axe WCAG AA
npm run typecheck
```

| Suite | What it proves |
|---|---|
| `lib/rules/*.test.ts` | money, invoices, scheduling, status machine, reception board, worklist ordering, routing, consent, search |
| `lib/rules/purity.test.ts` | rules import nothing but each other; they don't read the clock, env or network |
| `lib/design/tokens.test.ts` | every text/background token pair meets WCAG AA; the focus ring is visible |
| `tests/db/rls-read` | exact rows visible per role per table; nobody ever sees another clinic's rows; anon gets nothing |
| `tests/db/rls-write` | who may write what; double-booking; cross-clinic references rejected by composite FKs; locked notes; billing invariants |
| `tests/db/audit` | changes and record views are logged with field names only; the log is append-only even for admins and the service role |
| `tests/db/parity` | SQL and TypeScript agree: status machine (36 pairs), payment status (1,368 inputs), full invoices built through real triggers |
| `tests/db/auth-e2e` | real sign-in → JWT → PostgREST → RLS |

## Layout

```
app/(auth)/login            sign in / out
app/(app)/reception         front desk: who is here, who is next, payment, rooms (live)
app/(app)/doctor            doctor's day + consultation notes
app/(app)/patients          list/search, register, record, edit (consent)
app/(app)/appointments      day schedule, book, reschedule, status, cancel
app/(app)/billing           invoices, items, insurance, partial payments
app/(app)/admin             staff, rooms, audit log
app/(app)/{lab,pharmacy,me} role homes (Phase 2/3 placeholders)
components/ui               token-driven primitives: Badge, Button, Field, Table…
lib/rules                   pure business rules (no framework, no DB)
lib/data                    server-side queries, run as the signed-in user
lib/design/tokens.ts        colours, type, spacing, radius → tailwind.config.ts
supabase/migrations         schema, triggers, RLS, audit, realtime
supabase/seed.sql           two demo clinics
tests/db                    database tests
scripts/smoke.mjs           browser + accessibility smoke test
```

## Rules that matter

- **Money** is integer minor units everywhere (`bigint` in SQL). Amounts are
  parsed from the string the user typed; too many decimals is an error, never
  rounded. `lib/rules/invoice.ts` and the `invoice_balances` view compute the
  same figures, a test proves it, and the invoice page refuses payments if
  they ever disagree.
- **Insurance**: when a claim settles, the claimed part is closed. Any
  shortfall is written off as an adjustment, not left as patient debt.
- **Tenancy**: child rows reference parents by `(id, clinic_id)`, so a row
  can't point at another clinic's patient, doctor, room or invoice, even if
  the app code is wrong. RLS scopes every read and write to the caller's clinic.
- **Least access**: reception and admin can't read clinical notes; doctors
  can't read billing; lab and pharmacy can't read the schedule; patients see
  only their own rows. Deactivating staff revokes access immediately.
- **Audit**: row changes are logged by triggers; opening a record is logged
  before it renders (`lib/data/audit.ts`). If logging fails, the page doesn't
  show the record.
- **No service-role key in the app.** The server always acts as the user.
