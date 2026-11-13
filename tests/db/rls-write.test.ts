/**
 * RLS + trigger write rules, against real Supabase Postgres.
 * Every test runs in a rolled-back transaction.
 */
import { afterAll, describe, expect, it } from "vitest";
import { as, attempt, CLINIC_A, CLINIC_B, ID, pool, U } from "./helpers";

afterAll(() => pool.end());

const NEW_PATIENT = `insert into public.patients (clinic_id, given_name, family_name, date_of_birth)
                     values ($1, 'Test', 'Person', '2000-01-01') returning id`;

describe("patients", () => {
  it.each(["deskA", "adminA"] as const)("%s can register a patient in their clinic", async (u) => {
    await as(u, async (q) => {
      const r = await attempt(q, NEW_PATIENT, [CLINIC_A]);
      expect(r).toMatchObject({ ok: true, rows: 1 });
      const [row] = await q<{ mrn: string }>(`select mrn from public.patients order by created_at desc limit 1`);
      expect(row?.mrn).toMatch(/^P\d{6}$/);
    });
  });

  it.each(["doctorA", "labA", "pharmA", "patientA", "inactiveDeskA"] as const)(
    "%s cannot register a patient",
    async (u) => {
      await as(u, async (q) => {
        const r = await attempt(q, NEW_PATIENT, [CLINIC_A]);
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/row-level security/);
      });
    },
  );

  it("reception cannot register a patient into another clinic", async () => {
    await as("deskA", async (q) => {
      const r = await attempt(q, NEW_PATIENT, [CLINIC_B]);
      expect(r.error).toMatch(/row-level security/);
    });
  });

  it("reception cannot edit another clinic's patient (0 rows touched)", async () => {
    await as("deskA", async (q) => {
      const r = await attempt(q, `update public.patients set phone = '1' where id = $1 returning id`, [ID.jon]);
      expect(r).toMatchObject({ ok: true, rows: 0 });
    });
  });

  it("a patient cannot edit their own record (front desk owns demographics)", async () => {
    await as("patientA", async (q) => {
      const r = await attempt(q, `update public.patients set phone = '1' where id = $1 returning id`, [ID.amal]);
      expect(r.rows).toBe(0);
    });
  });

  it("rows cannot be moved to another clinic", async () => {
    await as("deskA", async (q) => {
      const r = await attempt(q, `update public.patients set clinic_id = $1 where id = $2`, [CLINIC_B, ID.amal]);
      expect(r.ok).toBe(false);
    });
  });

  it("nobody can delete patients", async () => {
    for (const u of ["adminA", "deskA"] as const) {
      await as(u, async (q) => {
        const r = await attempt(q, `delete from public.patients where id = $1 returning id`, [ID.george]);
        expect(r.rows, u).toBe(0);
      });
    }
  });
});

describe("appointments", () => {
  const book = (doctor: string, room: string | null, patient: string, startOffsetMin: number, minutes = 20, clinic = CLINIC_A) =>
    [
      `insert into public.appointments (clinic_id, patient_id, doctor_id, room_id, starts_at, ends_at)
       values ($1, $2, $3, $4, now() + make_interval(mins => $5), now() + make_interval(mins => $5 + $6)) returning id`,
      [clinic, patient, doctor, room, startOffsetMin, minutes],
    ] as const;

  it("reception can book a free slot", async () => {
    await as("deskA", async (q) => {
      expect((await attempt(q, ...book(U.doctorA, ID.roomA1, ID.george, 3000))).ok).toBe(true);
    });
  });

  it("the database blocks doctor double-booking", async () => {
    await as("deskA", async (q) => {
      expect((await attempt(q, ...book(U.doctorA, null, ID.george, 3000))).ok).toBe(true);
      const r = await attempt(q, ...book(U.doctorA, null, ID.amal, 3010));
      expect(r.error).toMatch(/appointments_no_doctor_overlap/);
    });
  });

  it("the database blocks room double-booking", async () => {
    await as("deskA", async (q) => {
      expect((await attempt(q, ...book(U.doctorA, ID.roomA1, ID.george, 3000))).ok).toBe(true);
      const r = await attempt(q, ...book(U.doctorA2, ID.roomA1, ID.amal, 3005));
      expect(r.error).toMatch(/appointments_no_room_overlap/);
    });
  });

  it("back-to-back slots are allowed (half-open ranges)", async () => {
    await as("deskA", async (q) => {
      expect((await attempt(q, ...book(U.doctorA, ID.roomA1, ID.george, 3000, 20))).ok).toBe(true);
      expect((await attempt(q, ...book(U.doctorA, ID.roomA1, ID.amal, 3020, 20))).ok).toBe(true);
    });
  });

  it("cannot book another clinic's patient, room or doctor (composite foreign keys)", async () => {
    await as("deskA", async (q) => {
      expect((await attempt(q, ...book(U.doctorA, null, ID.jon, 3000))).error).toMatch(/foreign key|violates/);
      expect((await attempt(q, ...book(U.doctorA, ID.roomB, ID.george, 3100))).error).toMatch(/foreign key|violates/);
      expect((await attempt(q, ...book(U.doctorB, null, ID.george, 3200))).error).toMatch(/foreign key|violates|active doctor/);
    });
  });

  it("only doctors can be booked as the clinician", async () => {
    await as("deskA", async (q) => {
      expect((await attempt(q, ...book(U.deskA, null, ID.george, 3000))).error).toMatch(/active doctor/);
    });
  });

  it("enforces the status machine", async () => {
    await as("deskA", async (q) => {
      const skip = await attempt(q, `update public.appointments set status = 'completed' where id = $1`, [ID.apptSofiaExpected]);
      expect(skip.error).toMatch(/Cannot change appointment from scheduled to completed/);
      const checkIn = await attempt(q, `update public.appointments set status = 'arrived' where id = $1 returning checked_in_at`, [ID.apptSofiaExpected]);
      expect(checkIn.ok).toBe(true);
      const [row] = await q<{ checked_in_at: Date; checked_in_by: string }>(
        `select checked_in_at, checked_in_by from public.appointments where id = $1`,
        [ID.apptSofiaExpected],
      );
      expect(row?.checked_in_at).toBeInstanceOf(Date);
      expect(row?.checked_in_by).toBe(U.deskA);
    });
  });

  it("cancelling requires a reason", async () => {
    await as("deskA", async (q) => {
      expect((await attempt(q, `update public.appointments set status = 'cancelled' where id = $1`, [ID.apptSofiaExpected])).error).toMatch(/reason/);
      expect(
        (await attempt(q, `update public.appointments set status = 'cancelled', cancelled_reason = 'Unwell' where id = $1`, [ID.apptSofiaExpected])).ok,
      ).toBe(true);
    });
  });

  it("doctor can progress their own visit but not reschedule it", async () => {
    await as("doctorA", async (q) => {
      expect((await attempt(q, `update public.appointments set status = 'completed' where id = $1 returning id`, [ID.apptRaviInRoom])).rows).toBe(1);
    });
    await as("doctorA", async (q) => {
      const r = await attempt(q, `update public.appointments set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour' where id = $1`, [ID.apptRaviInRoom]);
      expect(r.error).toMatch(/visit status only/);
    });
  });

  it("doctor cannot touch another doctor's appointment", async () => {
    await as("doctorA", async (q) => {
      const r = await attempt(q, `update public.appointments set status = 'in_room' where id = $1 returning id`, [ID.apptOwenWaiting]);
      expect(r.rows).toBe(0);
    });
  });

  it.each(["doctorA", "labA", "pharmA", "patientA"] as const)("%s cannot book appointments", async (u) => {
    await as(u, async (q) => {
      expect((await attempt(q, ...book(U.doctorA, null, ID.amal, 5000))).error).toMatch(/row-level security/);
    });
  });
});

describe("consultations", () => {
  it("doctor can sign their own note; it is then locked", async () => {
    await as("doctorA", async (q) => {
      const sign = await attempt(
        q,
        `update public.consultations set assessment = 'Hypertension', plan = 'Start treatment', signed_at = now(), signed_by = $2 where id = $1 returning id`,
        [ID.consultUnsigned, U.doctorA],
      );
      expect(sign.rows).toBe(1);
      const edit = await attempt(q, `update public.consultations set plan = 'changed' where id = $1`, [ID.consultUnsigned]);
      expect(edit.error).toMatch(/Signed notes cannot be edited/);
      const resolve = await attempt(q, `update public.consultations set is_critical = false where id = $1`, [ID.consultUnsigned]);
      expect(resolve.ok).toBe(true);
    });
  });

  it("signing an empty note is refused", async () => {
    await as("doctorA", async (q) => {
      const r = await attempt(q, `update public.consultations set signed_at = now(), signed_by = $2 where id = $1`, [ID.consultCritical, U.doctorA]);
      expect(r.error).toMatch(/assessment or plan/);
    });
  });

  it("another doctor cannot edit or sign a colleague's note", async () => {
    await as("doctorA2", async (q) => {
      const r = await attempt(q, `update public.consultations set plan = 'x' where id = $1 returning id`, [ID.consultUnsigned]);
      expect(r.rows).toBe(0);
    });
  });

  it("a doctor cannot write a note as someone else", async () => {
    await as("doctorA", async (q) => {
      const r = await attempt(
        q,
        `insert into public.consultations (clinic_id, patient_id, doctor_id) values ($1, $2, $3)`,
        [CLINIC_A, ID.george, U.doctorA2],
      );
      expect(r.error).toMatch(/row-level security/);
    });
  });

  it("critical flag needs a reason", async () => {
    await as("doctorA", async (q) => {
      const r = await attempt(q, `update public.consultations set is_critical = true, critical_reason = ' ' where id = $1`, [ID.consultUnsigned]);
      expect(r.ok).toBe(false);
    });
  });

  it.each(["deskA", "adminA", "labA", "pharmA", "patientA"] as const)("%s cannot write clinical notes", async (u) => {
    await as(u, async (q) => {
      const r = await attempt(q, `insert into public.consultations (clinic_id, patient_id, doctor_id) values ($1, $2, $3)`, [CLINIC_A, ID.george, U.doctorA]);
      expect(r.error).toMatch(/row-level security/);
    });
  });
});

describe("prescriptions (Phase 1: storage + RLS only)", () => {
  it("pharmacist cannot edit or flip prescriptions directly; dispensing is the only way (see pharmacy tests)", async () => {
    await as("pharmA", async (q) => {
      expect((await attempt(q, `update public.prescriptions set dose = '400 mg' where id = $1 returning id`, [ID.rxActive])).rows).toBe(0);
      expect((await attempt(q, `update public.prescriptions set status = 'dispensed' where id = $1 returning id`, [ID.rxActive])).rows).toBe(0);
    });
  });
  it("reception cannot read or write prescriptions", async () => {
    await as("deskA", async (q) => {
      expect((await attempt(q, `update public.prescriptions set status = 'cancelled' where id = $1 returning id`, [ID.rxActive])).rows).toBe(0);
    });
  });
});

describe("billing", () => {
  const newInvoice = `insert into public.invoices (clinic_id, patient_id) values ($1, $2) returning id, number, currency`;

  it("reception: create, add lines, issue, take partial payments", async () => {
    await as("deskA", async (q) => {
      const [inv] = await q<{ id: string; number: string; currency: string }>(newInvoice, [CLINIC_A, ID.george]);
      expect(inv?.number).toMatch(/^INV-\d{6}$/);
      expect(inv?.currency).toBe("GBP"); // defaulted from the clinic
      await q(`insert into public.invoice_lines (clinic_id, invoice_id, description, quantity, unit_price_minor) values ($1, $2, 'Consult', 1, 5000)`, [CLINIC_A, inv?.id]);
      await q(`update public.invoices set state = 'issued' where id = $1`, [inv?.id]);
      await q(`insert into public.payments (clinic_id, invoice_id, amount_minor, method) values ($1, $2, 2000, 'cash')`, [CLINIC_A, inv?.id]);
      const [b] = await q<{ payment_status: string; balance_due_minor: number }>(`select payment_status, balance_due_minor from public.invoice_balances where invoice_id = $1`, [inv?.id]);
      expect(b).toEqual({ payment_status: "partially_paid", balance_due_minor: 3000 });
      const over = await attempt(q, `insert into public.payments (clinic_id, invoice_id, amount_minor, method) values ($1, $2, 3001, 'cash')`, [CLINIC_A, inv?.id]);
      expect(over.error).toMatch(/more than the patient currently owes/);
      await q(`insert into public.payments (clinic_id, invoice_id, amount_minor, method) values ($1, $2, 3000, 'card')`, [CLINIC_A, inv?.id]);
      const [p] = await q<{ payment_status: string }>(`select payment_status from public.invoice_balances where invoice_id = $1`, [inv?.id]);
      expect(p?.payment_status).toBe("paid");
    });
  });

  it("money columns reject fractions and negatives", async () => {
    await as("deskA", async (q) => {
      // A fractional amount sent by a client is rejected, not rounded.
      const frac = await attempt(q, `insert into public.invoice_lines (clinic_id, invoice_id, description, quantity, unit_price_minor) values ($1, $2, 'x', 1, $3)`, [CLINIC_A, ID.invRaviDraft, "10.5"]);
      expect(frac.error).toMatch(/invalid input syntax for type bigint/);
      expect((await attempt(q, `insert into public.invoice_lines (clinic_id, invoice_id, description, quantity, unit_price_minor) values ($1, $2, 'y', 1, -1)`, [CLINIC_A, ID.invRaviDraft])).ok).toBe(false);
      expect((await attempt(q, `insert into public.payments (clinic_id, invoice_id, amount_minor, method) values ($1, $2, 0, 'cash')`, [CLINIC_A, ID.invAmal])).ok).toBe(false);
    });
  });

  it("payments only on issued invoices", async () => {
    await as("deskA", async (q) => {
      const r = await attempt(q, `insert into public.payments (clinic_id, invoice_id, amount_minor, method) values ($1, $2, 100, 'cash')`, [CLINIC_A, ID.invRaviDraft]);
      expect(r.error).toMatch(/issued invoices/);
    });
  });

  it("payments are append-only, even for admins", async () => {
    await as("adminA", async (q) => {
      expect((await attempt(q, `update public.payments set amount_minor = 1 where invoice_id = $1`, [ID.invAmal])).error).toMatch(/permission denied/);
      expect((await attempt(q, `delete from public.payments where invoice_id = $1`, [ID.invAmal])).error).toMatch(/permission denied/);
    });
  });

  it("lines are frozen once an invoice is issued", async () => {
    await as("deskA", async (q) => {
      const r = await attempt(q, `insert into public.invoice_lines (clinic_id, invoice_id, description, quantity, unit_price_minor) values ($1, $2, 'Extra', 1, 100)`, [CLINIC_A, ID.invAmal]);
      expect(r.error).toMatch(/draft/);
      const d = await attempt(q, `delete from public.invoice_lines where invoice_id = $1`, [ID.invAmal]);
      expect(d.error).toMatch(/draft/);
    });
  });

  it("invoices with payments cannot be voided; issued cannot go back to draft", async () => {
    await as("deskA", async (q) => {
      expect((await attempt(q, `update public.invoices set state = 'void', void_reason = 'x' where id = $1`, [ID.invAmal])).error).toMatch(/cannot be voided/);
      expect((await attempt(q, `update public.invoices set state = 'draft' where id = $1`, [ID.invAmal])).error).toMatch(/Cannot change invoice/);
    });
  });

  it("insurance claim cannot exceed the total", async () => {
    await as("deskA", async (q) => {
      const r = await attempt(q, `update public.invoices set insurance_status = 'pending', insurance_claimed_minor = 999999 where id = $1`, [ID.invAmal]);
      expect(r.error).toMatch(/exceed the invoice total/);
    });
  });

  it("REGRESSION: settling a claim for less than claimed closes the invoice", async () => {
    await as("deskA", async (q) => {
      // Amal: total 105.00, claimed 70.00, paid 20.00 of 35.00 share.
      await q(`insert into public.payments (clinic_id, invoice_id, amount_minor, method) values ($1, $2, 1500, 'card')`, [CLINIC_A, ID.invAmal]);
      await q(`update public.invoices set insurance_status = 'settled', insurance_paid_minor = 6100 where id = $1`, [ID.invAmal]);
      const [b] = await q(`select payment_status, balance_due_minor, insurance_adjustment_minor from public.invoice_balances where invoice_id = $1`, [ID.invAmal]);
      expect(b).toEqual({ payment_status: "paid", balance_due_minor: 0, insurance_adjustment_minor: 900 });
    });
  });

  it.each(["doctorA", "labA", "pharmA", "patientA"] as const)("%s cannot create invoices or take payments", async (u) => {
    await as(u, async (q) => {
      expect((await attempt(q, newInvoice, [CLINIC_A, ID.amal])).error).toMatch(/row-level security/);
      expect((await attempt(q, `insert into public.payments (clinic_id, invoice_id, amount_minor, method) values ($1, $2, 100, 'cash')`, [CLINIC_A, ID.invAmal])).error).toMatch(/row-level security/);
    });
  });

  it("reception cannot bill another clinic's patient", async () => {
    await as("deskA", async (q) => {
      expect((await attempt(q, newInvoice, [CLINIC_A, ID.jon])).error).toMatch(/foreign key|violates/);
      expect((await attempt(q, newInvoice, [CLINIC_B, ID.jon])).error).toMatch(/row-level security/);
    });
  });
});

describe("profiles and roles", () => {
  it("staff cannot promote themselves", async () => {
    await as("deskA", async (q) => {
      expect((await attempt(q, `update public.profiles set role = 'admin' where id = $1 returning id`, [U.deskA])).rows).toBe(0);
    });
  });
  it("admin manages staff in their own clinic only", async () => {
    await as("adminA", async (q) => {
      expect((await attempt(q, `update public.profiles set active = false where id = $1 returning id`, [U.labA])).rows).toBe(1);
      expect((await attempt(q, `update public.profiles set active = false where id = $1 returning id`, [U.deskB])).rows).toBe(0);
    });
  });
  it("deactivating a user removes their access immediately", async () => {
    await as("adminA", async (q) => {
      await q(`update public.profiles set active = false where id = $1`, [U.deskA]);
      // Same transaction, now acting as the deactivated receptionist.
      await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.deskA, role: "authenticated" })]);
      const rows = await q(`select id from public.patients`);
      expect(rows).toHaveLength(0);
    });
  });
});

describe("rooms", () => {
  it("only admins manage rooms", async () => {
    await as("adminA", async (q) => {
      expect((await attempt(q, `update public.rooms set out_of_service = true where id = $1 returning id`, [ID.roomA1])).rows).toBe(1);
    });
    await as("deskA", async (q) => {
      expect((await attempt(q, `update public.rooms set out_of_service = true where id = $1 returning id`, [ID.roomA1])).rows).toBe(0);
    });
  });
});
