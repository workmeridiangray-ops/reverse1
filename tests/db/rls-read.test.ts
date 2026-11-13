/**
 * RLS read matrix, against real Supabase Postgres.
 * Each row: which rows of each table every role can see, by exact count, plus
 * a blanket check that nobody ever sees another clinic's rows.
 */
import { afterAll, describe, expect, it } from "vitest";
import { as, CLINIC_A, CLINIC_B, failure, ID, pool, type UserKey } from "./helpers";

afterAll(() => pool.end());

type Table =
  | "clinics"
  | "profiles"
  | "patients"
  | "rooms"
  | "appointments"
  | "consultations"
  | "prescriptions"
  | "invoices"
  | "invoice_lines"
  | "payments"
  | "invoice_balances"
  | "audit_log"
  | "wards"
  | "beds"
  | "admissions"
  | "admission_summaries"
  | "bed_stays"
  | "bed_reservations"
  | "discharge_clearances"
  | "care_tasks"
  | "observations"
  | "tariff_versions"
  | "tariff_items"
  | "charges"
  | "deposits"
  | "refunds"
  | "lab_orders"
  | "lab_results"
  | "notifications"
  | "medicines"
  | "stock_batches"
  | "stock_movements"
  | "dispensings"
  | "substitutions"
  | "stock_returns"
  | "procedures"
  | "procedure_team"
  | "procedure_checklist"
  | "procedure_consents"
  | "procedure_notes"
  | "procedure_changes";

const TABLES: Table[] = [
  "clinics",
  "profiles",
  "patients",
  "rooms",
  "appointments",
  "consultations",
  "prescriptions",
  "invoices",
  "invoice_lines",
  "payments",
  "invoice_balances",
  "audit_log",
  "wards",
  "beds",
  "admissions",
  "admission_summaries",
  "bed_stays",
  "bed_reservations",
  "discharge_clearances",
  "care_tasks",
  "observations",
  "tariff_versions",
  "tariff_items",
  "charges",
  "deposits",
  "refunds",
  "lab_orders",
  "lab_results",
  "notifications",
  "medicines",
  "stock_batches",
  "stock_movements",
  "dispensings",
  "substitutions",
  "stock_returns",
  "procedures",
  "procedure_team",
  "procedure_checklist",
  "procedure_consents",
  "procedure_notes",
  "procedure_changes",
];

// Expected visible row counts from supabase/seed.sql. "audit" = any (>0).
const EXPECTED: Record<UserKey, Partial<Record<Table, number | "some">>> = {
  adminA: { clinics: 1, profiles: 9, patients: 7, rooms: 6, appointments: 10, consultations: 0, prescriptions: 0, invoices: 3, invoice_lines: 4, payments: 2, invoice_balances: 3, audit_log: "some", wards: 2, beds: 5, admissions: 3, admission_summaries: 0, bed_stays: 1, bed_reservations: 0, discharge_clearances: 0, care_tasks: 0, observations: 0, tariff_versions: 1, tariff_items: 3, charges: 1, deposits: 1, refunds: 0, lab_orders: 2, lab_results: 0, notifications: 0, medicines: 3, stock_batches: 6, stock_movements: 6, dispensings: 0, substitutions: 0, stock_returns: 0, procedures: 1, procedure_team: 0, procedure_checklist: 0, procedure_consents: 0, procedure_notes: 0, procedure_changes: 0 },
  doctorA: { clinics: 1, profiles: 9, patients: 7, rooms: 6, appointments: 10, consultations: 3, prescriptions: 2, invoices: 0, invoice_lines: 0, payments: 0, invoice_balances: 0, audit_log: 0, wards: 2, beds: 5, admissions: 3, admission_summaries: 0, bed_stays: 1, bed_reservations: 0, discharge_clearances: 0, care_tasks: 2, observations: 1, tariff_versions: 1, tariff_items: 3, charges: 0, deposits: 0, refunds: 0, lab_orders: 2, lab_results: 0, notifications: 0, medicines: 3, stock_batches: 0, stock_movements: 0, dispensings: 0, substitutions: 0, stock_returns: 0, procedures: 1, procedure_team: 0, procedure_checklist: 0, procedure_consents: 0, procedure_notes: 0, procedure_changes: 0 },
  doctorA2: { clinics: 1, profiles: 9, patients: 7, rooms: 6, appointments: 10, consultations: 3, prescriptions: 2, invoices: 0, invoice_lines: 0, payments: 0, invoice_balances: 0, audit_log: 0, wards: 2, beds: 5, admissions: 3, admission_summaries: 0, bed_stays: 1, bed_reservations: 0, discharge_clearances: 0, care_tasks: 2, observations: 1, tariff_versions: 1, tariff_items: 3, charges: 0, deposits: 0, refunds: 0, lab_orders: 2, lab_results: 0, notifications: 0, medicines: 3, stock_batches: 0, stock_movements: 0, dispensings: 0, substitutions: 0, stock_returns: 0, procedures: 1, procedure_team: 0, procedure_checklist: 0, procedure_consents: 0, procedure_notes: 0, procedure_changes: 0 },
  deskA: { clinics: 1, profiles: 9, patients: 7, rooms: 6, appointments: 10, consultations: 0, prescriptions: 0, invoices: 3, invoice_lines: 4, payments: 2, invoice_balances: 3, audit_log: 0, wards: 2, beds: 5, admissions: 3, admission_summaries: 0, bed_stays: 1, bed_reservations: 0, discharge_clearances: 0, care_tasks: 0, observations: 0, tariff_versions: 1, tariff_items: 3, charges: 1, deposits: 1, refunds: 0, lab_orders: 0, lab_results: 0, notifications: 0, medicines: 0, stock_batches: 0, stock_movements: 0, dispensings: 0, substitutions: 0, stock_returns: 0, procedures: 0, procedure_team: 0, procedure_checklist: 0, procedure_consents: 0, procedure_notes: 0, procedure_changes: 0 },
  labA: { clinics: 1, profiles: 9, patients: 7, rooms: 6, appointments: 0, consultations: 0, prescriptions: 0, invoices: 0, invoice_lines: 0, payments: 0, invoice_balances: 0, audit_log: 0, wards: 0, beds: 0, admissions: 0, admission_summaries: 0, bed_stays: 0, bed_reservations: 0, discharge_clearances: 0, care_tasks: 0, observations: 0, tariff_versions: 0, tariff_items: 0, charges: 0, deposits: 0, refunds: 0, lab_orders: 2, lab_results: 0, notifications: 0, medicines: 0, stock_batches: 0, stock_movements: 0, dispensings: 0, substitutions: 0, stock_returns: 0, procedures: 0, procedure_team: 0, procedure_checklist: 0, procedure_consents: 0, procedure_notes: 0, procedure_changes: 0 },
  pharmA: { clinics: 1, profiles: 9, patients: 7, rooms: 6, appointments: 0, consultations: 0, prescriptions: 2, invoices: 0, invoice_lines: 0, payments: 0, invoice_balances: 0, audit_log: 0, wards: 0, beds: 0, admissions: 3, admission_summaries: 0, bed_stays: 0, bed_reservations: 0, discharge_clearances: 0, care_tasks: 0, observations: 0, tariff_versions: 0, tariff_items: 0, charges: 0, deposits: 0, refunds: 0, lab_orders: 0, lab_results: 0, notifications: 0, medicines: 3, stock_batches: 6, stock_movements: 6, dispensings: 0, substitutions: 0, stock_returns: 0, procedures: 0, procedure_team: 0, procedure_checklist: 0, procedure_consents: 0, procedure_notes: 0, procedure_changes: 0 },
  // Amal: own record, own 2 appointments, only the ACTIVE prescription, own ISSUED invoice and its lines/payments.
  patientA: { clinics: 1, profiles: 1, patients: 1, rooms: 0, appointments: 2, consultations: 0, prescriptions: 1, invoices: 1, invoice_lines: 2, payments: 1, invoice_balances: 1, audit_log: 0, wards: 0, beds: 0, admissions: 0, admission_summaries: 0, bed_stays: 0, bed_reservations: 0, discharge_clearances: 0, care_tasks: 0, observations: 0, tariff_versions: 0, tariff_items: 0, charges: 0, deposits: 0, refunds: 0, lab_orders: 0, lab_results: 0, notifications: 0, medicines: 0, stock_batches: 0, stock_movements: 0, dispensings: 0, substitutions: 0, stock_returns: 0, procedures: 0, procedure_team: 0, procedure_checklist: 0, procedure_consents: 0, procedure_notes: 0, procedure_changes: 0 },
  // Deactivated staff: everything resolves to nothing.
  inactiveDeskA: { clinics: 0, profiles: 1, patients: 0, rooms: 0, appointments: 0, consultations: 0, prescriptions: 0, invoices: 0, invoice_lines: 0, payments: 0, invoice_balances: 0, audit_log: 0, wards: 0, beds: 0, admissions: 0, admission_summaries: 0, bed_stays: 0, bed_reservations: 0, discharge_clearances: 0, care_tasks: 0, observations: 0, tariff_versions: 0, tariff_items: 0, charges: 0, deposits: 0, refunds: 0, lab_orders: 0, lab_results: 0, notifications: 0, medicines: 0, stock_batches: 0, stock_movements: 0, dispensings: 0, substitutions: 0, stock_returns: 0, procedures: 0, procedure_team: 0, procedure_checklist: 0, procedure_consents: 0, procedure_notes: 0, procedure_changes: 0 },
  adminB: { clinics: 1, profiles: 5, patients: 2, rooms: 2, appointments: 2, consultations: 0, prescriptions: 0, invoices: 1, invoice_lines: 1, payments: 0, invoice_balances: 1, audit_log: "some", wards: 1, beds: 1, admissions: 1, admission_summaries: 0, bed_stays: 1, bed_reservations: 0, discharge_clearances: 0, care_tasks: 0, observations: 0, tariff_versions: 1, tariff_items: 1, charges: 0, deposits: 0, refunds: 0, lab_orders: 0, lab_results: 0, notifications: 0, medicines: 1, stock_batches: 0, stock_movements: 0, dispensings: 0, substitutions: 0, stock_returns: 0, procedures: 0, procedure_team: 0, procedure_checklist: 0, procedure_consents: 0, procedure_notes: 0, procedure_changes: 0 },
  doctorB: { clinics: 1, profiles: 5, patients: 2, rooms: 2, appointments: 2, consultations: 1, prescriptions: 0, invoices: 0, invoice_lines: 0, payments: 0, invoice_balances: 0, audit_log: 0, wards: 1, beds: 1, admissions: 1, admission_summaries: 0, bed_stays: 1, bed_reservations: 0, discharge_clearances: 0, care_tasks: 0, observations: 0, tariff_versions: 1, tariff_items: 1, charges: 0, deposits: 0, refunds: 0, lab_orders: 0, lab_results: 0, notifications: 0, medicines: 1, stock_batches: 0, stock_movements: 0, dispensings: 0, substitutions: 0, stock_returns: 0, procedures: 0, procedure_team: 0, procedure_checklist: 0, procedure_consents: 0, procedure_notes: 0, procedure_changes: 0 },
  deskB: { clinics: 1, profiles: 5, patients: 2, rooms: 2, appointments: 2, consultations: 0, prescriptions: 0, invoices: 1, invoice_lines: 1, payments: 0, invoice_balances: 1, audit_log: 0, wards: 1, beds: 1, admissions: 1, admission_summaries: 0, bed_stays: 1, bed_reservations: 0, discharge_clearances: 0, care_tasks: 0, observations: 0, tariff_versions: 1, tariff_items: 1, charges: 0, deposits: 0, refunds: 0, lab_orders: 0, lab_results: 0, notifications: 0, medicines: 0, stock_batches: 0, stock_movements: 0, dispensings: 0, substitutions: 0, stock_returns: 0, procedures: 0, procedure_team: 0, procedure_checklist: 0, procedure_consents: 0, procedure_notes: 0, procedure_changes: 0 },
  nurseA: { clinics: 1, profiles: 9, patients: 7, rooms: 3, appointments: 0, consultations: 0, prescriptions: 0, invoices: 0, invoice_lines: 0, payments: 0, invoice_balances: 0, audit_log: 0, wards: 2, beds: 5, admissions: 3, admission_summaries: 0, bed_stays: 1, bed_reservations: 0, discharge_clearances: 0, care_tasks: 2, observations: 1, tariff_versions: 1, tariff_items: 3, charges: 0, deposits: 0, refunds: 0, lab_orders: 2, lab_results: 0, notifications: 0, medicines: 3, stock_batches: 0, stock_movements: 0, dispensings: 0, substitutions: 0, stock_returns: 0, procedures: 1, procedure_team: 0, procedure_checklist: 0, procedure_consents: 0, procedure_notes: 0, procedure_changes: 0 },
  nurseB: { clinics: 1, profiles: 5, patients: 2, rooms: 1, appointments: 0, consultations: 0, prescriptions: 0, invoices: 0, invoice_lines: 0, payments: 0, invoice_balances: 0, audit_log: 0, wards: 1, beds: 1, admissions: 1, admission_summaries: 0, bed_stays: 1, bed_reservations: 0, discharge_clearances: 0, care_tasks: 0, observations: 0, tariff_versions: 1, tariff_items: 1, charges: 0, deposits: 0, refunds: 0, lab_orders: 0, lab_results: 0, notifications: 0, medicines: 1, stock_batches: 0, stock_movements: 0, dispensings: 0, substitutions: 0, stock_returns: 0, procedures: 0, procedure_team: 0, procedure_checklist: 0, procedure_consents: 0, procedure_notes: 0, procedure_changes: 0 },
  patientB: { clinics: 1, profiles: 1, patients: 1, rooms: 0, appointments: 1, consultations: 0, prescriptions: 0, invoices: 1, invoice_lines: 1, payments: 0, invoice_balances: 1, audit_log: 0, wards: 0, beds: 0, admissions: 0, admission_summaries: 0, bed_stays: 0, bed_reservations: 0, discharge_clearances: 0, care_tasks: 0, observations: 0, tariff_versions: 0, tariff_items: 0, charges: 0, deposits: 0, refunds: 0, lab_orders: 0, lab_results: 0, notifications: 0, medicines: 0, stock_batches: 0, stock_movements: 0, dispensings: 0, substitutions: 0, stock_returns: 0, procedures: 0, procedure_team: 0, procedure_checklist: 0, procedure_consents: 0, procedure_notes: 0, procedure_changes: 0 },
};

const HOME_CLINIC: Record<UserKey, string> = {
  adminA: CLINIC_A, doctorA: CLINIC_A, doctorA2: CLINIC_A, deskA: CLINIC_A, labA: CLINIC_A, pharmA: CLINIC_A,
  patientA: CLINIC_A, inactiveDeskA: CLINIC_A, nurseA: CLINIC_A, nurseB: CLINIC_B,
  adminB: CLINIC_B, doctorB: CLINIC_B, deskB: CLINIC_B, patientB: CLINIC_B,
};

const users = Object.keys(EXPECTED) as UserKey[];
const cases = users.flatMap((u) => TABLES.map((t) => [u, t] as const));

describe("RLS read matrix", () => {
  it.each(cases)("%s sees the expected rows of %s", async (user, table) => {
    const expected = EXPECTED[user][table];
    const rows = await as(user, (q) => q<{ n: number }>(`select count(*)::int as n from public.${table}`));
    const n = rows[0]?.n ?? -1;
    if (expected === "some") expect(n).toBeGreaterThan(0);
    else expect(n).toBe(expected);
  });
});

describe("clinic isolation", () => {
  const withClinic: Table[] = TABLES.filter((t) => t !== "clinics");
  it.each(users.flatMap((u) => withClinic.map((t) => [u, t] as const)))(
    "%s never sees another clinic's rows in %s",
    async (user, table) => {
      const other = HOME_CLINIC[user] === CLINIC_A ? CLINIC_B : CLINIC_A;
      const rows = await as(user, (q) =>
        q<{ n: number }>(`select count(*)::int as n from public.${table} where clinic_id = $1`, [other]),
      );
      expect(rows[0]?.n).toBe(0);
    },
  );

  it.each(users)("%s cannot read another clinic's patient by id", async (user) => {
    const target = HOME_CLINIC[user] === CLINIC_A ? ID.jon : ID.amal;
    const rows = await as(user, (q) => q(`select id from public.patients where id = $1`, [target]));
    expect(rows).toHaveLength(0);
  });
});

describe("patient self-scoping", () => {
  it("patient sees only their own patient record", async () => {
    const rows = await as("patientA", (q) => q<{ id: string }>(`select id from public.patients`));
    expect(rows.map((r) => r.id)).toEqual([ID.amal]);
  });
  it("patient cannot see draft prescriptions", async () => {
    const rows = await as("patientA", (q) => q(`select id from public.prescriptions where id = $1`, [ID.rxDraft]));
    expect(rows).toHaveLength(0);
  });
  it("patient cannot see clinical notes, even their own", async () => {
    const rows = await as("patientA", (q) => q(`select id from public.consultations where patient_id = $1`, [ID.amal]));
    expect(rows).toHaveLength(0);
  });
  it("patient cannot see other staff profiles", async () => {
    const rows = await as("patientA", (q) => q<{ role: string }>(`select role from public.profiles`));
    expect(rows.map((r) => r.role)).toEqual(["patient"]);
  });
});

describe("minimum necessary access for staff", () => {
  it("reception and admin cannot read clinical notes", async () => {
    for (const u of ["deskA", "adminA"] as const) {
      const rows = await as(u, (q) => q(`select id from public.consultations`));
      expect(rows, u).toHaveLength(0);
    }
  });
  it("doctors cannot read billing", async () => {
    const rows = await as("doctorA", (q) => q(`select id from public.invoices`));
    expect(rows).toHaveLength(0);
  });
  it("lab and pharmacy cannot read the schedule", async () => {
    for (const u of ["labA", "pharmA"] as const) {
      expect(await as(u, (q) => q(`select id from public.appointments`)), u).toHaveLength(0);
    }
  });
});

describe("anonymous access", () => {
  it.each(TABLES)("anon is refused on %s", async (table) => {
    const msg = await failure(as(null, (q) => q(`select 1 from public.${table} limit 1`)));
    expect(msg).toMatch(/permission denied/);
  });

  it("anon cannot call log_record_access", async () => {
    const msg = await failure(as(null, (q) => q(`select public.log_record_access('patients', $1)`, [ID.amal])));
    expect(msg).toMatch(/permission denied/);
  });

  it("internal helper schema is not reachable by anon", async () => {
    const msg = await failure(as(null, (q) => q(`select app.clinic_id()`)));
    expect(msg).toMatch(/permission denied/);
  });
});
