/**
 * Patient portal against real Supabase Postgres: appointment requests and
 * self-service contact details. A patient can ask or tidy their own details;
 * staff decide. Everything is scoped to the signed-in patient by RLS.
 */
import { afterAll, describe, expect, it } from "vitest";
import { MAX_OPEN_REQUESTS } from "@/lib/rules/portal";
import { act, as, attempt, CLINIC_A, ID, pool, scenario, U } from "./helpers";

afterAll(() => pool.end());

const newRequest = (q: Parameters<typeof attempt>[0], patient: string, clinic = CLINIC_A) =>
  attempt(q, `insert into public.appointment_requests (clinic_id, patient_id, preferred, reason) values ($1, $2, 'Mornings', 'Check-up') returning id`, [clinic, patient]);

describe("appointment requests: patient side", () => {
  it("a patient creates a request for themselves; it starts open", async () => {
    await as("patientA", async (q) => {
      expect(await newRequest(q, ID.amal)).toMatchObject({ ok: true, rows: 1 });
      const rows = await q<{ status: string }>(`select status from public.appointment_requests order by created_at`);
      expect(rows.map((r) => r.status)).toEqual(["open", "open"]);
    });
  });
  it("the database limit equals MAX_OPEN_REQUESTS in lib/rules", async () => {
    await as("patientA", async (q) => {
      let created = 1; // Amal already has one open request in the seed
      for (let i = 0; i < 10; i++) {
        const r = await newRequest(q, ID.amal);
        if (!r.ok) { expect(r.error).toMatch(/already have 3 requests/); break; }
        created++;
      }
      expect(created).toBe(MAX_OPEN_REQUESTS);
    });
  });
  it("cannot create a request for someone else, in another clinic, or without being a patient", async () => {
    await as("patientA", async (q) => {
      expect((await newRequest(q, ID.george)).error).toMatch(/row-level security/);
      expect((await newRequest(q, ID.jon)).error).toMatch(/row-level security/);
    });
    for (const u of ["doctorA", "deskA", "adminA", "labA", "pharmA"] as const) {
      await as(u, async (q) => { expect((await newRequest(q, ID.amal)).error, u).toMatch(/row-level security/); });
    }
  });
  it("a request cannot be edited, only cancelled, and a closed one cannot be reopened", async () => {
    await as("patientA", async (q) => {
      expect((await attempt(q, `update public.appointment_requests set reason = 'something else' where id = $1`, [ID.requestAmal])).error).toMatch(/cannot be edited/);
      expect((await attempt(q, `update public.appointment_requests set status = 'booked' where id = $1`, [ID.requestAmal])).error).toMatch(/only cancel/);
      expect((await attempt(q, `update public.appointment_requests set status = 'cancelled' where id = $1 returning id`, [ID.requestAmal])).rows).toBe(1);
      expect((await attempt(q, `update public.appointment_requests set status = 'open' where id = $1`, [ID.requestAmal])).error).toMatch(/already closed/);
    });
  });
  it("sees only their own requests", async () => {
    await as("patientA", async (q) => {
      expect((await q<{ id: string }>(`select id from public.appointment_requests`)).map((r) => r.id)).toEqual([ID.requestAmal]);
      expect((await attempt(q, `update public.appointment_requests set status = 'cancelled' where id = $1 returning id`, [ID.requestJon])).rows).toBe(0);
    });
  });
});

describe("appointment requests: staff side", () => {
  it("reception books a request by linking an appointment for the same patient", async () => {
    await as("deskA", async (q) => {
      const r = await attempt(q, `update public.appointment_requests set status = 'booked', appointment_id = $2 where id = $1 returning id`, [ID.requestAmal, ID.apptAmalToday]);
      expect(r.rows).toBe(1);
      const [row] = await q<{ handled_by: string; handled_at: Date }>(`select handled_by, handled_at from public.appointment_requests where id = $1`, [ID.requestAmal]);
      expect(row?.handled_by).toBe(U.deskA);
      expect(row?.handled_at).toBeInstanceOf(Date);
    });
  });
  it("refuses to link another patient's appointment, or to book without one", async () => {
    await as("deskA", async (q) => {
      expect((await attempt(q, `update public.appointment_requests set status = 'booked', appointment_id = $2 where id = $1`, [ID.requestAmal, ID.apptOwenWaiting])).error).toMatch(/same patient/);
      expect((await attempt(q, `update public.appointment_requests set status = 'booked' where id = $1`, [ID.requestAmal])).error).toMatch(/Choose the appointment/);
    });
  });
  it("declining needs a reason", async () => {
    await as("deskA", async (q) => {
      expect((await attempt(q, `update public.appointment_requests set status = 'declined' where id = $1`, [ID.requestAmal])).error).toMatch(/check constraint/);
      expect((await attempt(q, `update public.appointment_requests set status = 'declined', decline_reason = 'Dr Okafor is away that week' where id = $1 returning id`, [ID.requestAmal])).rows).toBe(1);
    });
  });
  it("staff cannot cancel on a patient's behalf, and other clinics' staff cannot see or change it", async () => {
    await as("deskA", async (q) => {
      expect((await attempt(q, `update public.appointment_requests set status = 'cancelled' where id = $1`, [ID.requestAmal])).error).toMatch(/book or decline/);
    });
    await as("deskB", async (q) => {
      expect((await q<{ id: string }>(`select id from public.appointment_requests`)).map((r) => r.id)).toEqual([ID.requestJon]);
      expect((await attempt(q, `update public.appointment_requests set status = 'declined', decline_reason = 'nope nope' where id = $1 returning id`, [ID.requestAmal])).rows).toBe(0);
    });
  });
  it.each(["doctorA", "labA", "pharmA"] as const)("%s cannot see requests", async (u) => {
    await as(u, async (q) => { expect(await q(`select id from public.appointment_requests`)).toHaveLength(0); });
  });
  it("is audited", async () => {
    await scenario(async (q) => {
      await act(q, "patientA");
      await newRequest(q, ID.amal);
      await act(q, null);
      const rows = await q<{ actor_role: string; action: string }>(`select actor_role, action from public.audit_log where table_name = 'appointment_requests' and action = 'insert' order by id desc limit 1`);
      expect(rows[0]).toEqual({ actor_role: "patient", action: "insert" });
    });
  });
});

describe("update_my_details", () => {
  it("a patient updates only their own contact details and reminder consent", async () => {
    await as("patientA", async (q) => {
      await q(`select public.update_my_details('+44 7700 900999', 'amal.new@example.test', '12 Cedar Lane', false)`);
      const rows = await q<{ id: string; phone: string; email: string; address: string; consent_communication: boolean }>(`select id, phone, email, address, consent_communication from public.patients`);
      expect(rows).toEqual([{ id: ID.amal, phone: "+44 7700 900999", email: "amal.new@example.test", address: "12 Cedar Lane", consent_communication: false }]);
    });
    // nobody else's record moved
    await as("deskA", async (q) => {
      const [g] = await q<{ phone: string }>(`select phone from public.patients where id = $1`, [ID.george]);
      expect(g?.phone).toBe("+44 7700 900102");
    });
  });
  it("rejects bad phone and email, blank clears them, and non-patients are refused", async () => {
    await as("patientA", async (q) => {
      expect((await attempt(q, `select public.update_my_details('abc', null, null, null)`)).error).toMatch(/valid phone/);
      expect((await attempt(q, `select public.update_my_details(null, 'no-at-sign', null, null)`)).error).toMatch(/valid email/);
      expect((await attempt(q, `select public.update_my_details('', '', '', null)`)).ok).toBe(true);
      const [row] = await q<{ phone: string | null; email: string | null; consent_communication: boolean }>(`select phone, email, consent_communication from public.patients`);
      expect(row).toEqual({ phone: null, email: null, consent_communication: true }); // null leaves reminder consent as it was
    });
    for (const u of ["doctorA", "deskA", "adminA", "labA", "pharmA"] as const) {
      await as(u, async (q) => { expect((await attempt(q, `select public.update_my_details('+44 123456', null, null, null)`)).error, u).toMatch(/Not a patient account/); });
    }
    await as(null, async (q) => { expect((await attempt(q, `select public.update_my_details('+44 123456', null, null, null)`)).error).toMatch(/permission denied/); });
  });
  it("a patient still cannot change their record any other way", async () => {
    await as("patientA", async (q) => {
      expect((await attempt(q, `update public.patients set given_name = 'Hacked' where id = $1 returning id`, [ID.amal])).rows).toBe(0);
      expect((await attempt(q, `update public.patients set consent_treatment_at = null where id = $1 returning id`, [ID.amal])).rows).toBe(0);
    });
  });
  it("is audited as the patient, with field names only", async () => {
    await scenario(async (q) => {
      await act(q, "patientA");
      await q(`select public.update_my_details('+44 7700 900777', 'x@example.test', null, null)`);
      await act(q, null);
      const [row] = await q<{ actor_role: string; changed_fields: string[]; s: string }>(
        `select actor_role, changed_fields, a::text as s from public.audit_log a where table_name = 'patients' and action = 'update' order by id desc limit 1`);
      expect(row?.actor_role).toBe("patient");
      expect(row?.changed_fields).toEqual(expect.arrayContaining(["phone", "email"]));
      expect(row?.s).not.toContain("900777");
    });
  });
});
