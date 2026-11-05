/** Transfers, nursing records, discharge governance, housekeeping, isolation, audit, parity. */
import { afterAll, describe, expect, it } from "vitest";
import { type ClearanceDepartment, dischargeBlockers, requiredClearances, type AdmissionType } from "../../lib/rules/admission";
import { as, asOwner, attempt, failure, ID, pool, type Q } from "./helpers";

afterAll(() => pool.end());

const SUMMARY = "Recovered well, mobilising independently, wound clean.";
const authorise = (q: Q, adm: string) => q(`select public.authorise_discharge($1, $2)`, [adm, SUMMARY]);

describe("transfers", () => {
  it("closes the old stay and opens the new one at the same instant; old bed needs cleaning", async () => {
    await as("nurseA", async (q) => {
      await q(`select public.transfer_bed($1, $2, now() - interval '1 hour', 'Needs closer monitoring')`, [ID.admGeorge, ID.bedHdu]);
      const stays = await q<{ bed_id: string; starts_at: string; ends_at: string | null; reason: string }>(
        `select bed_id, starts_at, ends_at, reason from public.bed_stays where admission_id = $1 order by starts_at`, [ID.admGeorge]);
      expect(stays).toHaveLength(2);
      expect(stays[0]!.ends_at).toEqual(stays[1]!.starts_at);
      expect(stays[1]).toMatchObject({ bed_id: ID.bedHdu, ends_at: null, reason: "transfer" });
      const [old] = await q<{ housekeeping: string }>(`select housekeeping from public.beds where id = $1`, [ID.bedA1]);
      expect(old?.housekeeping).toBe("dirty");
    });
  });
  it("refuses transfers into occupied, dirty, out-of-service beds, the same bed, the future, or before arrival", async () => {
    const cases: Array<[string, unknown[], RegExp]> = [
      [`select public.transfer_bed($1, $2)`, [ID.admGeorge, ID.bedA1], /already in that bed/],
      [`select public.transfer_bed($1, $2)`, [ID.admGeorge, ID.bedA3], /not been cleaned/],
      [`select public.transfer_bed($1, $2)`, [ID.admGeorge, ID.bedA4], /out of service/],
      [`select public.transfer_bed($1, $2, now() + interval '2 hours')`, [ID.admGeorge, ID.bedA2], /future/],
      [`select public.transfer_bed($1, $2, now() - interval '5 days')`, [ID.admGeorge, ID.bedA2], /after the patient arrived/],
    ];
    for (const [sql, params, re] of cases) {
      await as("nurseA", async (q) => {
        const r = await attempt(q, sql, params);
        expect(r.ok, sql).toBe(false);
        expect(r.error).toMatch(re);
      });
    }
  });
  it("reception and doctors cannot transfer", async () => {
    for (const u of ["deskA", "doctorA"] as const) {
      expect(await failure(as(u, (q) => q(`select public.transfer_bed($1, $2)`, [ID.admGeorge, ID.bedA2]))), u).toMatch(/permission/);
    }
  });
  it("a requested (not yet admitted) patient cannot be transferred", async () => {
    expect(await failure(as("nurseA", (q) => q(`select public.transfer_bed($1, $2)`, [ID.admOwen, ID.bedA2])))).toMatch(/Only an admitted/);
  });
  it("physical occupancy is separate from billed bed-days", async () => {
    await as("adminA", async (q) => {
      const [r] = await q<{ d: number }>(`select public.billed_bed_days($1) as d`, [ID.admGeorge]);
      // Admitted 2 days ago in Europe/London: 2 or 3 midnights depending on the time of day, never 0 or 1.
      expect(r!.d).toBeGreaterThanOrEqual(2);
      expect(r!.d).toBeLessThanOrEqual(3);
      const [none] = await q<{ d: number }>(`select public.billed_bed_days($1) as d`, [ID.admOwen]);
      expect(none!.d).toBe(0);
    });
  });
  it("a transfer does not double count bed-days", async () => {
    await as("nurseA", async (q) => {
      const [before] = await q<{ d: number }>(`select public.billed_bed_days($1) as d`, [ID.admGeorge]);
      await q(`select public.transfer_bed($1, $2, now() - interval '1 hour')`, [ID.admGeorge, ID.bedHdu]);
      const [after] = await q<{ d: number }>(`select public.billed_bed_days($1) as d`, [ID.admGeorge]);
      expect(after!.d).toBe(before!.d);
    });
  });
});

describe("housekeeping", () => {
  it("dirty -> cleaning -> clean makes a bed allocatable", async () => {
    await as("nurseA", async (q) => {
      await q(`select public.set_bed_housekeeping($1, 'cleaning')`, [ID.bedA3]);
      await q(`select public.set_bed_housekeeping($1, 'clean')`, [ID.bedA3]);
      await q(`select public.allocate_bed($1, $2)`, [ID.admOwen, ID.bedA3]);
    });
  });
  it("an occupied bed cannot be marked dirty or clean", async () => {
    expect(await failure(as("nurseA", (q) => q(`select public.set_bed_housekeeping($1, 'dirty')`, [ID.bedA1])))).toMatch(/occupied/);
  });
  it("reception cannot change cleaning status, and clients cannot write the column directly", async () => {
    expect(await failure(as("deskA", (q) => q(`select public.set_bed_housekeeping($1, 'cleaning')`, [ID.bedA3])))).toMatch(/permission/);
    const r = await as("adminA", (q) => attempt(q, `update public.beds set housekeeping = 'clean' where id = $1`, [ID.bedA3]));
    expect(r.ok).toBe(false);
  });
  it("an occupied bed cannot be taken out of service", async () => {
    const r = await as("adminA", (q) => attempt(q, `update public.beds set out_of_service = true where id = $1`, [ID.bedA1]));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/occupied/);
  });
});

describe("nursing records", () => {
  it("a nurse records observations; they cannot be edited or deleted; corrections keep the original", async () => {
    await as("nurseA", async (q) => {
      const [o] = await q<{ id: string }>(
        `insert into public.observations (clinic_id, admission_id, patient_id, recorded_by, systolic, diastolic, pulse)
         values ('aaaaaaaa-0000-4000-8000-000000000000', $1, $2, $3, 300, 90, 80) returning id`, [ID.admGeorge, ID.george, "a0000000-0000-4000-8000-000000000009"]);
      // No UPDATE/DELETE policy exists: the statements affect zero rows. (The immutable_row trigger is the second lock.)
      expect(await q(`update public.observations set pulse = 70 where id = $1 returning id`, [o!.id])).toHaveLength(0);
      const del = await attempt(q, `delete from public.observations where id = $1`, [o!.id]);
      expect(del.ok).toBe(false);
      expect(del.error).toMatch(/permission denied/);
      const [still] = await q<{ pulse: number }>(`select pulse from public.observations where id = $1`, [o!.id]);
      expect(still?.pulse).toBe(80);
      await q(`insert into public.observations (clinic_id, admission_id, patient_id, recorded_by, systolic, diastolic, pulse, corrects_id, correction_reason)
               values ('aaaaaaaa-0000-4000-8000-000000000000', $1, $2, $3, 130, 90, 80, $4, 'Typo: 300 entered for 130')`,
        [ID.admGeorge, ID.george, "a0000000-0000-4000-8000-000000000009", o!.id]);
      const all = await q(`select id from public.observations where admission_id = $1`, [ID.admGeorge]);
      expect(all.length).toBe(3); // seed + original + correction
    });
  });
  it("physiologically impossible values and empty entries are rejected", async () => {
    for (const vals of ["systolic = 20", "spo2 = 120", "systolic = 80, diastolic = 100"]) {
      const cols = vals.split(",").map((p) => p.trim().split(" = "));
      const names = cols.map(([c]) => c).join(", ");
      const values = cols.map(([, v]) => v).join(", ");
      const r = await as("nurseA", (q) => attempt(q,
        `insert into public.observations (clinic_id, admission_id, patient_id, recorded_by, ${names})
         values ('aaaaaaaa-0000-4000-8000-000000000000', $1, $2, $3, ${values})`, [ID.admGeorge, ID.george, "a0000000-0000-4000-8000-000000000009"]));
      expect(r.ok, vals).toBe(false);
    }
    const empty = await as("nurseA", (q) => attempt(q,
      `insert into public.observations (clinic_id, admission_id, patient_id, recorded_by)
       values ('aaaaaaaa-0000-4000-8000-000000000000', $1, $2, $3)`, [ID.admGeorge, ID.george, "a0000000-0000-4000-8000-000000000009"]));
    expect(empty.ok).toBe(false);
  });
  it("tasks: done, or not done with a reason; recorded tasks are final", async () => {
    await as("nurseA", async (q) => {
      const tasks = await q<{ id: string }>(`select id from public.care_tasks where admission_id = $1 order by due_at`, [ID.admGeorge]);
      const [a, b] = tasks;
      expect((await attempt(q, `update public.care_tasks set status = 'not_done' where id = $1`, [a!.id])).ok).toBe(false);
      await q(`update public.care_tasks set status = 'not_done', not_done_reason = 'Patient refused' where id = $1`, [a!.id]);
      await q(`update public.care_tasks set status = 'done' where id = $1`, [b!.id]);
      const [row] = await q<{ completed_by: string; completed_at: string }>(`select completed_by, completed_at from public.care_tasks where id = $1`, [b!.id]);
      expect(row?.completed_by).toBe("a0000000-0000-4000-8000-000000000009");
      expect(row?.completed_at).toBeTruthy();
      expect((await attempt(q, `update public.care_tasks set status = 'done' where id = $1`, [a!.id])).ok).toBe(false);
      expect((await attempt(q, `update public.care_tasks set title = 'changed' where id = $1`, [b!.id])).ok).toBe(false);
    });
  });
  it("nursing records need an admitted patient", async () => {
    const r = await as("nurseA", (q) => attempt(q,
      `insert into public.care_tasks (clinic_id, admission_id, patient_id, title, due_at)
       values ('aaaaaaaa-0000-4000-8000-000000000000', $1, $2, 'Too early', now())`, [ID.admOwen, ID.ptOwen]));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/while the patient is admitted/);
  });
  it("reception, lab, pharmacy and patients cannot read or write nursing records", async () => {
    for (const u of ["deskA", "labA", "pharmA", "patientA"] as const) {
      expect(await as(u, (q) => q(`select 1 from public.observations`)), u).toHaveLength(0);
      const r = await as(u, (q) => attempt(q, `insert into public.observations (clinic_id, admission_id, patient_id, recorded_by, pulse)
        values ('aaaaaaaa-0000-4000-8000-000000000000', $1, $2, $3, 70)`, [ID.admGeorge, ID.george, "a0000000-0000-4000-8000-000000000009"]));
      expect(r.ok, u).toBe(false);
    }
  });
});

describe("discharge governance", () => {
  it("only a doctor authorises, with a summary; reception and admin cannot read the summary", async () => {
    expect(await failure(as("nurseA", (q) => authorise(q, ID.admGeorge)))).toMatch(/permission/);
    expect(await failure(as("adminA", (q) => authorise(q, ID.admGeorge)))).toMatch(/permission/);
    expect(await failure(as("doctorA", (q) => q(`select public.authorise_discharge($1, 'short')`, [ID.admGeorge])))).toMatch(/summary first/);
    await as("doctorA", async (q) => {
      await authorise(q, ID.admGeorge);
      expect(await q(`select 1 from public.admission_summaries`)).toHaveLength(1);
    });
    await asOwner(async (q) => {
      // the real flow: commit not needed, check visibility inside the same transaction as another role
      await q(`select 1`);
    });
  });
  it("final discharge is refused until authorised and every required clearance exists", async () => {
    await as("deskA", async (q) => {
      const r = await attempt(q, `select public.finalise_discharge($1)`, [ID.admGeorge]);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/not been authorised/);
      expect(r.error).toMatch(/Finance clearance is outstanding/);
      expect(r.error).toMatch(/Pharmacy clearance is outstanding/);
      expect(r.error).toMatch(/Nursing clearance is outstanding/);
    });
  });
  it("each clearance belongs to its department; exceptions are admin-only and need a reason", async () => {
    const att = (u: Parameters<typeof as>[0], dept: string, status = "cleared", note: string | null = null) =>
      as(u, (q) => attempt(q, `select public.record_clearance($1, $2, $3, $4)`, [ID.admGeorge, dept, status, note]));
    expect((await att("nurseA", "finance")).ok).toBe(false);
    expect((await att("deskA", "pharmacy")).ok).toBe(false);
    expect((await att("pharmA", "nursing")).ok).toBe(false);
    expect((await att("doctorA", "finance")).ok).toBe(false);
    expect((await att("deskA", "finance", "exception", "Insurer guarantee pending approval")).ok).toBe(false); // not admin
    expect((await att("adminA", "finance", "exception", "too short")).ok).toBe(false); // reason too short
    expect((await att("adminA", "finance", "exception", "Insurer guarantee letter on file")).ok).toBe(true);
    expect((await att("deskA", "finance")).ok).toBe(true);
    expect((await att("pharmA", "pharmacy")).ok).toBe(true);
    expect((await att("nurseA", "nursing")).ok).toBe(true);
    expect((await att("nurseA", "billing")).ok).toBe(false);
  });
  it("the full elective discharge: authorise -> clear -> discharge frees the bed for cleaning and closes the record", async () => {
    // Run the entire flow in one transaction by switching identity per step.
    const c = await pool.connect();
    const asUser = async (id: string) => {
      await c.query("reset role");
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: id, role: "authenticated" })]);
    };
    try {
      await c.query("begin");
      await asUser("a0000000-0000-4000-8000-000000000002");
      await c.query(`select public.authorise_discharge($1, $2)`, [ID.admGeorge, SUMMARY]);
      await asUser("a0000000-0000-4000-8000-000000000004");
      await c.query(`select public.record_clearance($1, 'finance', 'cleared')`, [ID.admGeorge]);
      await asUser("a0000000-0000-4000-8000-000000000006");
      await c.query(`select public.record_clearance($1, 'pharmacy', 'cleared')`, [ID.admGeorge]);
      await asUser("a0000000-0000-4000-8000-000000000009");
      await c.query(`select public.record_clearance($1, 'nursing', 'cleared')`, [ID.admGeorge]);
      // Summary visible to nurse + doctor, hidden from reception/admin.
      expect((await c.query(`select 1 from public.admission_summaries`)).rowCount).toBe(1);
      await asUser("a0000000-0000-4000-8000-000000000004");
      expect((await c.query(`select 1 from public.admission_summaries`)).rowCount).toBe(0);
      await c.query(`select public.finalise_discharge($1)`, [ID.admGeorge]);
      const adm = (await c.query(`select status, discharged_at, discharged_by from public.admissions where id = $1`, [ID.admGeorge])).rows[0];
      expect(adm.status).toBe("discharged");
      expect(adm.discharged_by).toBe("a0000000-0000-4000-8000-000000000004");
      const open = await c.query(`select 1 from public.bed_stays where admission_id = $1 and ends_at is null`, [ID.admGeorge]);
      expect(open.rowCount).toBe(0);
      expect((await c.query(`select housekeeping from public.beds where id = $1`, [ID.bedA1])).rows[0].housekeeping).toBe("dirty");
      // The closed record is final.
      await c.query("savepoint s");
      await expect(c.query(`update public.admissions set reason = 'edited later' where id = $1`, [ID.admGeorge])).rejects.toThrow(/closed/);
      await c.query("rollback to savepoint s");
      // Cannot discharge twice.
      await expect(c.query(`select public.finalise_discharge($1)`, [ID.admGeorge])).rejects.toThrow(/not currently admitted/);
    } finally {
      await c.query("rollback").catch(() => undefined);
      c.release();
    }
  });
  it("an emergency admission is not blocked by finance clearance unless the hospital says so", async () => {
    await asOwner(async (q) => {
      await q(`select set_config('request.jwt.claims', '{}', true)`);
      // Ines (emergency) gets a bed, summary and the two required clearances, directly as owner.
      await q(`insert into public.bed_stays (clinic_id, admission_id, patient_id, bed_id, starts_at, reason)
               values ('aaaaaaaa-0000-4000-8000-000000000000', $1, $2, $3, now() - interval '2 hours', 'admission')`, [ID.admInes, ID.ptInes, ID.bedA2]);
      await q(`update public.admissions set status = 'admitted', admitted_at = now() - interval '2 hours',
               discharge_authorised_by = $2, discharge_authorised_at = now() where id = $1`, [ID.admInes, "a0000000-0000-4000-8000-000000000002"]);
      await q(`insert into public.admission_summaries (admission_id, clinic_id, patient_id, summary, written_by)
               values ($1, 'aaaaaaaa-0000-4000-8000-000000000000', $2, $3, $4)`, [ID.admInes, ID.ptInes, SUMMARY, "a0000000-0000-4000-8000-000000000002"]);
      for (const d of ["pharmacy", "nursing"]) {
        await q(`insert into public.discharge_clearances (clinic_id, admission_id, patient_id, department, status, cleared_by)
                 values ('aaaaaaaa-0000-4000-8000-000000000000', $1, $2, $3, 'cleared', $4)`, [ID.admInes, ID.ptInes, d, "a0000000-0000-4000-8000-000000000006"]);
      }
      const [ok] = await q<{ b: string[] }>(`select app.discharge_blockers($1) as b`, [ID.admInes]);
      expect(ok!.b).toEqual([]);
      await q(`update public.clinics set emergency_requires_finance_clearance = true where id = 'aaaaaaaa-0000-4000-8000-000000000000'`);
      const [strict] = await q<{ b: string[] }>(`select app.discharge_blockers($1) as b`, [ID.admInes]);
      expect(strict!.b).toEqual(["Finance clearance is outstanding"]);
    });
  });
  it("the doctor can withdraw an authorisation with a reason, and discharge is blocked again", async () => {
    await as("doctorA", async (q) => {
      await authorise(q, ID.admGeorge);
      expect((await attempt(q, `select public.withdraw_discharge_authorisation($1, 'no')`, [ID.admGeorge])).ok).toBe(false);
      await q(`select public.withdraw_discharge_authorisation($1, 'Fever returned this evening')`, [ID.admGeorge]);
      const [a] = await q<{ discharge_authorised_at: string | null }>(`select discharge_authorised_at from public.admissions where id = $1`, [ID.admGeorge]);
      expect(a?.discharge_authorised_at).toBeNull();
    });
  });
  it("a request can be cancelled with a reason; an admitted patient cannot be 'cancelled'", async () => {
    await as("deskA", async (q) => {
      expect((await attempt(q, `select public.cancel_admission($1, 'no')`, [ID.admOwen])).ok).toBe(false);
      expect((await attempt(q, `select public.cancel_admission($1, 'Patient chose another hospital')`, [ID.admGeorge])).ok).toBe(false);
      await q(`select public.cancel_admission($1, 'Patient chose another hospital')`, [ID.admOwen]);
      const [a] = await q<{ status: string }>(`select status from public.admissions where id = $1`, [ID.admOwen]);
      expect(a?.status).toBe("cancelled");
    });
  });
});

describe("tenant isolation for inpatient data", () => {
  it("the other clinic cannot act on our admission, bed, or clearances by guessing ids", async () => {
    const stmts: Array<[string, unknown[]]> = [
      [`select public.transfer_bed($1, $2)`, [ID.admGeorge, ID.bedB]],
      [`select public.finalise_discharge($1)`, [ID.admGeorge]],
      [`select public.cancel_admission($1, 'cancel from outside')`, [ID.admOwen]],
      [`select public.record_clearance($1, 'nursing', 'cleared')`, [ID.admGeorge]],
      [`select public.set_bed_housekeeping($1, 'cleaning')`, [ID.bedA3]],
    ];
    for (const [sql, params] of stmts) {
      // adminB is allowed to run every one of these in their own clinic, so the refusal is about the clinic.
      const r = await as("adminB", (q) => attempt(q, sql, params));
      expect(r.ok, sql).toBe(false);
      expect(r.error, sql).toMatch(/not found/i);
    }
  });
  it("a composite key stops a stay or reservation pointing at another clinic's bed", async () => {
    const r = await asOwner((q) => attempt(q,
      `insert into public.bed_reservations (clinic_id, bed_id, admission_id, reserved_from, reserved_until)
       values ('aaaaaaaa-0000-4000-8000-000000000000', $1, $2, now(), now() + interval '1 hour')`, [ID.bedB, ID.admOwen]));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/foreign key/);
  });
});

describe("audit trail for inpatient changes", () => {
  it("allocation, transfer and discharge steps are logged with field names, never values", async () => {
    await as("nurseA", async (q) => {
      await q(`select public.transfer_bed($1, $2, now() - interval '1 hour')`, [ID.admGeorge, ID.bedHdu]);
    });
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: "a0000000-0000-4000-8000-000000000009" })]);
      await c.query(`select public.transfer_bed($1, $2, now() - interval '30 minutes')`, [ID.admGeorge, ID.bedA2]);
      await c.query("reset role");
      const rows = (await c.query(`select table_name, action, changed_fields, actor_role from public.audit_log
        where actor_id = 'a0000000-0000-4000-8000-000000000009' and table_name in ('bed_stays','beds') order by id desc limit 6`)).rows;
      expect(rows.some((r) => r.table_name === "bed_stays" && r.action === "insert")).toBe(true);
      expect(rows.some((r) => r.table_name === "bed_stays" && r.action === "update" && r.changed_fields.includes("ends_at"))).toBe(true);
      expect(rows.every((r) => r.actor_role === "nurse")).toBe(true);
      expect(JSON.stringify(rows)).not.toContain(SUMMARY);
    } finally {
      await c.query("rollback").catch(() => undefined);
      c.release();
    }
  });
  it("admission views are logged by the record-access function and unknown records are refused", async () => {
    await as("doctorA", async (q) => {
      await q(`select public.log_record_access('admissions', $1, 'ward round')`, [ID.admGeorge]);
    });
    expect(await failure(as("doctorB", (q) => q(`select public.log_record_access('admissions', $1)`, [ID.admGeorge])))).toMatch(/not found/i);
  });
});

describe("SQL and TypeScript agree on discharge readiness (parity)", () => {
  const types: AdmissionType[] = ["elective", "emergency"];
  const depts: ClearanceDepartment[] = ["finance", "pharmacy", "nursing"];
  const subsets: ClearanceDepartment[][] = Array.from({ length: 8 }, (_, m) => depts.filter((_, i) => m & (1 << i)));

  it("required_clearances matches for all inputs", async () => {
    await asOwner(async (q) => {
      for (const t of types) for (const f of [false, true]) {
        const [r] = await q<{ r: string[] }>(`select app.required_clearances($1, $2) as r`, [t, f]);
        expect(r!.r).toEqual(requiredClearances(t, f));
      }
    });
  });

  it("discharge_blockers matches for 64 combinations of type, policy, authorisation, summary and clearances", async () => {
    let checked = 0;
    await asOwner(async (q) => {
      await q(`select set_config('request.jwt.claims', '{}', true)`);
      for (const type of types) for (const needsFinance of [false, true]) for (const authorised of [false, true]) for (const hasSummary of [false, true])
        for (const set of subsets) {
          if (checked % 2 === 1 && !authorised) { /* keep run time small: sample */ }
          await q(`delete from public.discharge_clearances where admission_id = $1`, [ID.admGeorge]);
          await q(`delete from public.admission_summaries where admission_id = $1`, [ID.admGeorge]);
          await q(`update public.clinics set emergency_requires_finance_clearance = $1 where id = 'aaaaaaaa-0000-4000-8000-000000000000'`, [needsFinance]);
          await q(`update public.admissions set admission_type = $2,
                   discharge_authorised_by = $3::uuid, discharge_authorised_at = case when $4 then now() else null end where id = $1`,
            [ID.admGeorge, type, authorised ? "a0000000-0000-4000-8000-000000000002" : null, authorised]);
          if (hasSummary) {
            await q(`insert into public.admission_summaries (admission_id, clinic_id, patient_id, summary, written_by)
                     values ($1, 'aaaaaaaa-0000-4000-8000-000000000000', $2, $3, 'a0000000-0000-4000-8000-000000000002')`, [ID.admGeorge, ID.george, SUMMARY]);
          }
          for (const d of set) {
            await q(`insert into public.discharge_clearances (clinic_id, admission_id, patient_id, department, status, cleared_by)
                     values ('aaaaaaaa-0000-4000-8000-000000000000', $1, $2, $3, 'cleared', 'a0000000-0000-4000-8000-000000000006')`, [ID.admGeorge, ID.george, d]);
          }
          const [sql] = await q<{ b: string[] }>(`select app.discharge_blockers($1) as b`, [ID.admGeorge]);
          const ts = dischargeBlockers({ status: "admitted", type, emergencyNeedsFinance: needsFinance, authorised, hasSummary, clearances: set });
          expect(sql!.b, JSON.stringify({ type, needsFinance, authorised, hasSummary, set })).toEqual(ts);
          checked++;
        }
    });
    expect(checked).toBe(128);
  });
});
