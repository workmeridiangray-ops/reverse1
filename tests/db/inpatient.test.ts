/**
 * Inpatient workflow against real Postgres: admission -> bed -> transfer ->
 * nursing record -> discharge authorisation -> clearances -> final discharge,
 * plus the refusals (wrong role, other clinic, conflicting bed, skipped step).
 */
import { afterAll, describe, expect, it } from "vitest";
import { as, asOwner, attempt, failure, ID, pool, U } from "./helpers";

afterAll(() => pool.end());

const callAs = (user: Parameters<typeof as>[0], sql: string, params: unknown[] = []) => as(user, (q) => q(sql, params));

describe("requesting an admission", () => {
  it("reception can request an emergency admission without a deposit", async () => {
    const r = await as("deskA", (q) => q<{ id: string }>(
      `insert into public.admissions (clinic_id, patient_id, attending_id, admission_type, reason)
       values ('aaaaaaaa-0000-4000-8000-000000000000', $1, $2, 'emergency', 'Fall with head injury') returning id`,
      [ID.ravi, U.doctorA]));
    expect(r).toHaveLength(1);
  });

  it("an elective admission needs a deposit reference under default policy", async () => {
    const msg = await failure(as("deskA", (q) => q(
      `insert into public.admissions (clinic_id, patient_id, attending_id, admission_type, reason)
       values ('aaaaaaaa-0000-4000-8000-000000000000', $1, $2, 'elective', 'Planned surgery')`, [ID.ravi, U.doctorA])));
    expect(msg).toMatch(/deposit reference/);
  });

  it("the hospital can switch the deposit rule off", async () => {
    await asOwner(async (q) => {
      await q(`update public.clinics set require_deposit_for_elective = false where id = 'aaaaaaaa-0000-4000-8000-000000000000'`);
      const r = await q(`insert into public.admissions (clinic_id, patient_id, attending_id, admission_type, reason)
        values ('aaaaaaaa-0000-4000-8000-000000000000', $1, $2, 'elective', 'Planned surgery') returning id`, [ID.ravi, U.doctorA]);
      expect(r).toHaveLength(1);
    });
  });

  it("a patient can have only one open admission", async () => {
    const msg = await failure(callAs("deskA",
      `insert into public.admissions (clinic_id, patient_id, attending_id, admission_type, reason)
       values ('aaaaaaaa-0000-4000-8000-000000000000', $1, $2, 'emergency', 'Second request')`, [ID.george, U.doctorA]));
    expect(msg).toMatch(/admissions_one_open_per_patient/);
  });

  it("the attending clinician must be a doctor", async () => {
    const msg = await failure(callAs("deskA",
      `insert into public.admissions (clinic_id, patient_id, attending_id, admission_type, reason)
       values ('aaaaaaaa-0000-4000-8000-000000000000', $1, $2, 'emergency', 'Bad attending')`, [ID.ravi, U.labA]));
    expect(msg).toMatch(/must be an active doctor/);
  });

  it("cannot reference another clinic's patient or doctor", async () => {
    const m1 = await failure(callAs("deskA",
      `insert into public.admissions (clinic_id, patient_id, attending_id, admission_type, reason)
       values ('aaaaaaaa-0000-4000-8000-000000000000', $1, $2, 'emergency', 'Cross-clinic')`, [ID.jon, U.doctorA]));
    expect(m1).toMatch(/foreign key/);
  });

  it("nurses, lab and patients cannot request admissions", async () => {
    for (const u of ["nurseA", "labA", "patientA", "pharmA"] as const) {
      const r = await as(u, (q) => attempt(q,
        `insert into public.admissions (clinic_id, patient_id, attending_id, admission_type, reason)
         values ('aaaaaaaa-0000-4000-8000-000000000000', $1, $2, 'emergency', 'Not allowed')`, [ID.ravi, U.doctorA]));
      expect(r.ok, u).toBe(false);
    }
  });

  it("clients cannot create an admission that is already 'admitted'", async () => {
    const r = await as("deskA", (q) => attempt(q,
      `insert into public.admissions (clinic_id, patient_id, attending_id, admission_type, status, reason, admitted_at)
       values ('aaaaaaaa-0000-4000-8000-000000000000', $1, $2, 'emergency', 'admitted', 'Skip the queue', now())`, [ID.ravi, U.doctorA]));
    expect(r.ok).toBe(false);
  });

  it("clients cannot move workflow columns directly", async () => {
    for (const set of ["status = 'admitted', admitted_at = now()", `discharge_authorised_by = '${U.doctorA}', discharge_authorised_at = now()`, "row_version = 99", "patient_id = '" + ID.amal + "'"]) {
      const r = await as("adminA", (q) => attempt(q, `update public.admissions set ${set} where id = $1`, [ID.admOwen]));
      expect(r.ok, set).toBe(false);
    }
  });

  it("row_version increases on every edit (for concurrent-edit detection)", async () => {
    await as("deskA", async (q) => {
      const [before] = await q<{ row_version: number }>(`select row_version from public.admissions where id = $1`, [ID.admGeorge]);
      const rows = await q<{ row_version: number }>(
        `update public.admissions set expected_discharge_on = current_date + 5 where id = $1 returning row_version`, [ID.admGeorge]);
      expect(rows[0]?.row_version).toBe((before?.row_version ?? 0) + 1);
    });
  });
});

describe("allocating a bed", () => {
  it("a nurse allocates a clean bed; admission becomes admitted and a stay opens", async () => {
    await as("nurseA", async (q) => {
      await q(`select public.allocate_bed($1, $2)`, [ID.admOwen, ID.bedA2]);
      const [adm] = await q<{ status: string; admitted_at: string }>(`select status, admitted_at from public.admissions where id = $1`, [ID.admOwen]);
      expect(adm?.status).toBe("admitted");
      expect(adm?.admitted_at).toBeTruthy();
      const stays = await q(`select 1 from public.bed_stays where admission_id = $1 and bed_id = $2 and ends_at is null`, [ID.admOwen, ID.bedA2]);
      expect(stays).toHaveLength(1);
    });
  });

  it("refuses an occupied bed", async () => {
    expect(await failure(callAs("nurseA", `select public.allocate_bed($1, $2)`, [ID.admOwen, ID.bedA1]))).toMatch(/already occupied/);
  });
  it("refuses a bed that still needs cleaning", async () => {
    expect(await failure(callAs("nurseA", `select public.allocate_bed($1, $2)`, [ID.admOwen, ID.bedA3]))).toMatch(/not been cleaned/);
  });
  it("refuses a bed that is out of service", async () => {
    expect(await failure(callAs("nurseA", `select public.allocate_bed($1, $2)`, [ID.admOwen, ID.bedA4]))).toMatch(/out of service/);
  });
  it("refuses an admission that already has a bed", async () => {
    expect(await failure(callAs("nurseA", `select public.allocate_bed($1, $2)`, [ID.admGeorge, ID.bedA2]))).toMatch(/Only a requested admission/);
  });
  it("doctors, lab and patients cannot allocate beds", async () => {
    for (const u of ["doctorA", "labA", "patientA", "pharmA"] as const) {
      expect(await failure(callAs(u, `select public.allocate_bed($1, $2)`, [ID.admOwen, ID.bedA2])), u).toMatch(/permission/);
    }
  });
  it("a clinic cannot allocate another clinic's bed or admission", async () => {
    expect(await failure(callAs("nurseB", `select public.allocate_bed($1, $2)`, [ID.admOwen, ID.bedB]))).toMatch(/Admission not found/);
    expect(await failure(callAs("nurseA", `select public.allocate_bed($1, $2)`, [ID.admOwen, ID.bedB]))).toMatch(/Bed not found/);
  });
  it("respects a reservation held for another admission", async () => {
    await as("nurseA", async (q) => {
      await q(`insert into public.bed_reservations (clinic_id, bed_id, admission_id, reserved_from, reserved_until)
               values ('aaaaaaaa-0000-4000-8000-000000000000', $1, $2, now() - interval '1 hour', now() + interval '3 hours')`, [ID.bedA2, ID.admInes]);
      const blocked = await attempt(q, `select public.allocate_bed($1, $2)`, [ID.admOwen, ID.bedA2]);
      expect(blocked.ok).toBe(false);
      expect(blocked.error).toMatch(/reserved for another/);
      // ...but the admission it is reserved for can take it, which fulfils the reservation.
      await q(`select public.allocate_bed($1, $2)`, [ID.admInes, ID.bedA2]);
      const [r] = await q<{ status: string }>(`select status from public.bed_reservations where admission_id = $1`, [ID.admInes]);
      expect(r?.status).toBe("fulfilled");
    });
  });
  it("two reservations for the same bed cannot overlap", async () => {
    await as("nurseA", async (q) => {
      await q(`insert into public.bed_reservations (clinic_id, bed_id, admission_id, reserved_from, reserved_until)
               values ('aaaaaaaa-0000-4000-8000-000000000000', $1, $2, now(), now() + interval '2 hours')`, [ID.bedA2, ID.admInes]);
      const r = await attempt(q, `insert into public.bed_reservations (clinic_id, bed_id, admission_id, reserved_from, reserved_until)
               values ('aaaaaaaa-0000-4000-8000-000000000000', $1, $2, now() + interval '1 hour', now() + interval '3 hours')`, [ID.bedA2, ID.admOwen]);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/bed_reservations_no_overlap/);
    });
  });
  it("direct inserts into bed_stays are refused for every client role", async () => {
    for (const u of ["adminA", "nurseA", "deskA", "doctorA"] as const) {
      const r = await as(u, (q) => attempt(q, `insert into public.bed_stays (clinic_id, admission_id, patient_id, bed_id, starts_at, reason)
        values ('aaaaaaaa-0000-4000-8000-000000000000', $1, $2, $3, now(), 'admission')`, [ID.admOwen, ID.ptOwen, ID.bedA2]));
      expect(r.ok, u).toBe(false);
    }
  });
});

describe("concurrent allocation (scripted safety case)", () => {
  it("two nurses racing for the same bed: exactly one wins, the other is refused", async () => {
    const claims = (u: string) => JSON.stringify({ sub: u, role: "authenticated", aud: "authenticated" });
    const open = async (user: string) => {
      const c = await pool.connect();
      await c.query("begin");
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims', $1, true)", [claims(user)]);
      return c;
    };
    const c1 = await open(U.nurseA);
    const c2 = await open(U.nurseA);
    const started = (await pool.query(`select clock_timestamp() as t`)).rows[0].t as Date;
    // Make the effects visible only on commit: c1 allocates but does not commit yet.
    try {
      await c1.query(`select public.allocate_bed($1, $2)`, [ID.admOwen, ID.bedA2]);
      // c2 now tries the same bed for a different patient; it must queue on the bed lock.
      const second = c2.query(`select public.allocate_bed($1, $2)`, [ID.admInes, ID.bedA2]).then(() => "ok", (e: Error) => e.message);
      await new Promise((r) => setTimeout(r, 300));
      await c1.query("commit");
      const outcome = await second;
      expect(outcome).toMatch(/already occupied|bed_stays_no_bed_overlap/);
      const check = await pool.query(`select count(*)::int as n from public.bed_stays where bed_id = $1 and ends_at is null`, [ID.bedA2]);
      expect(check.rows[0].n).toBe(1);
    } finally {
      await c2.query("rollback").catch(() => undefined);
      c1.release();
      c2.release();
      // This test must commit (it needs two real sessions), so restore the seed
      // exactly afterwards. Triggers are bypassed only for this clean-up.
      const t = await pool.connect();
      try {
        await t.query("begin");
        await t.query("set local session_replication_role = replica");
        await t.query(`delete from public.bed_stays where admission_id in ($1, $2)`, [ID.admOwen, ID.admInes]);
        await t.query(`update public.admissions set status = 'requested', admitted_at = null, row_version = 1 where id in ($1, $2)`, [ID.admOwen, ID.admInes]);
        await t.query(`delete from public.audit_log where occurred_at >= $1`, [started]);
        await t.query("commit");
      } finally {
        t.release();
      }
    }
  });
});
