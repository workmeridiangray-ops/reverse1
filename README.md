# Tendwell

Clinic management for small and mid-size clinics. Six roles (admin, doctor,
receptionist, lab, pharmacist, patient), every table behind row-level security,
and the business rules in small pure modules with their own tests.

**Status: Phases 1 and 2.**
- Phase 1: schema, auth and role routing, front desk, doctor's day, patient and appointment CRUD, basic billing.
- Phase 2: allergies, prescribing with class-based allergy checking, lab orders, result entry and flagging, critical-result handling, release of results to patients.
- Not built yet (Phase 3): pharmacy stock and batch dispensing, the full patient portal, analytics.

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

Demo accounts (password `tendwell-demo-pass`): `desk@cedarlane.test`,
`dr.okafor@cedarlane.test`, `admin@cedarlane.test`, `lab@cedarlane.test`,
`pharmacy@cedarlane.test`, `amal.haddad@patient.test`, and a second clinic
`desk@northgate.test` to see isolation.

## Tests

```bash
npm run test:unit    # pure rules, no database
npm run db:reset     # re-seed, then:
npm run test:db      # RLS, audit and parity tests against real local Supabase
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
| `tests/db/allergy-prescribing` | allergies are removed, never edited; the database demands a written reason for a drug-class match; clients cannot claim "clear" |
| `tests/db/lab` | who orders, enters, acknowledges and releases; the flag is computed by the database; patients see released results only; ranges can't overlap |
| `tests/db/allergy-parity` | TypeScript allergy check vs the database over every drug × patient × reason below |
| `tests/db/lab-parity` | flag maths, age maths (birthdays, leap days, time zones), range choice, and the stored flag through the real triggers |

## Layout

```
app/(auth)/login            sign in / out
app/(app)/reception         front desk: who is here, who is next, payment, rooms (live)
app/(app)/doctor            doctor's day + consultation notes
app/(app)/patients          list/search, register, record, edit (consent)
app/(app)/appointments      day schedule, book, reschedule, status, cancel
app/(app)/billing           invoices, items, insurance, partial payments
app/(app)/admin             staff, rooms, audit log
app/(app)/doctor/notes/[id] note + allergies + prescriptions + lab orders; /prescribe has the live allergy check
app/(app)/lab               queue and result entry
app/(app)/pharmacy          active prescriptions with allergy status and the prescriber's override reason
app/(app)/me                the patient's own appointments, bills, medicines and RELEASED results
app/(app)/admin/lab         tests and reference ranges (read-only; review status shown)
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

### Phase 2 rules

- **Allergies are matched by drug class, not by name.** Amoxicillin is caught
  for a penicillin allergy because both map to the `penicillin` class
  (`lib/rules/drug-catalog.ts`). A match **warns and requires a written reason**
  (10+ characters), which is saved and shown to the pharmacist. It never blocks.
  The database enforces the same rule, so it holds even if a client skips the
  check, and it computes the stored status so nobody can claim "clear".
- **"Could not check" is never "safe".** A medicine not in the list is
  reported as "allergy check not run". A patient with nothing recorded is
  reported as "no allergy record", which is not the same as "no known allergies"
  (that is a recorded, clinician-confirmed fact).
- **Result flags use the right range first.** The range is chosen by the
  patient's sex at birth and age, then the value is compared, so 13 g/dL
  haemoglobin is normal for a woman and low for a man. No matching range, or
  an unknown/intersex patient with only sex-specific ranges, means **no flag**.
  The database sets the flag, so it can't be typed in or forged.
- **Critical results** stay on the ordering doctor's home screen, and on the
  lab's order screen as "phone the doctor", until the doctor acknowledges them.
  Correcting a value clears the acknowledgement.
- **Results reach the patient only after a doctor releases them**, enforced by
  row-level security, not by the interface.

### Clinical placeholders (need review before real use)

`lib/rules/drug-catalog.ts` (classes, cross-reactions), `lib/rules/lab-flags.ts`
(logic is general, numbers are not), the seeded reference ranges
(`reviewed_at` is empty until a clinician signs them off; results flagged from an
unreviewed range say so), and the doctor's-list ordering. Not included on
purpose: dose-range checking, interaction checking and renal/age dose
adjustment, which need a clinician-reviewed formulary.
