import { afterAll, describe, expect, it } from "vitest";
import { ID, pool, U } from "./helpers";

afterAll(() => pool.end());
type Row = Record<string, unknown>;
async function scenario(fn: (as2: (u: string) => Promise<void>, q: (sql: string, p?: unknown[]) => Promise<Row[]>) => Promise<void>) {
  const c = await pool.connect();
  const as2 = async (uid: string) => {
    await c.query("reset role"); await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
  };
  try { await c.query("begin"); await fn(as2, async (sql, p) => (await c.query(sql, p)).rows); } finally { await c.query("rollback").catch(() => undefined); c.release(); }
}
const fails = (c: Promise<unknown>, re: RegExp) => expect(c).rejects.toThrow(re);
const A = "aaaaaaaa-0000-4000-8000-000000000000";

async function amalDischarged(q: (sql: string, p?: unknown[]) => Promise<Row[]>, status: string) {
  await q(`set local session_replication_role = replica`);
  const id = (await q(`insert into public.admissions (clinic_id, patient_id, attending_id, admission_type, status, reason, admitted_at, discharged_at, discharged_by)
    values ($1, $2, $3, 'emergency', $4, 'Pneumonia', now() - interval '3 days', case when $4 = 'discharged' then now() else null end, case when $4 = 'discharged' then $3::uuid end) returning id`, [A, ID.amal, U.doctorA, status]))[0]!.id as string;
  await q(`insert into public.admission_summaries (admission_id, clinic_id, patient_id, summary, written_by) values ($1, $2, $3, 'Treated with antibiotics, recovered well.', $4)`, [id, A, ID.amal, U.doctorA]);
  await q(`set local session_replication_role = origin`);
  return id;
}

describe("patient portal release rules", () => {
  it("a discharge summary is invisible to the patient until a doctor shares it, and only to that patient", async () => {
    await scenario(async (as2, q) => {
      const adm = await amalDischarged(q, "discharged");
      await as2(U.patientA);
      expect(await q(`select 1 from public.admission_summaries`)).toHaveLength(0);
      await as2(U.doctorA); await q(`select public.share_discharge_summary($1)`, [adm]);
      await as2(U.patientA);
      expect((await q(`select summary from public.admission_summaries`)).map((r) => r.summary)).toEqual(["Treated with antibiotics, recovered well."]);
      await as2(U.patientB); expect(await q(`select 1 from public.admission_summaries`)).toHaveLength(0);
      await as2(U.deskA); expect(await q(`select 1 from public.admission_summaries`)).toHaveLength(0);
      await as2(U.doctorA);
      await q("savepoint s"); await fails(q(`select public.share_discharge_summary($1)`, [adm]), /no unshared summary/); await q("rollback to savepoint s");
    });
  });
  it("only doctors share, and only after discharge", async () => {
    await scenario(async (as2, q) => {
      const open = await amalDischarged(q, "admitted");
      await as2(U.doctorA);
      await q("savepoint s"); await fails(q(`select public.share_discharge_summary($1)`, [open]), /once the patient has been discharged/); await q("rollback to savepoint s");
      await as2(U.nurseA);
      await q("savepoint s2"); await fails(q(`select public.share_discharge_summary($1)`, [open]), /permission/); await q("rollback to savepoint s2");
      await as2(U.patientA);
      await q("savepoint s3"); await fails(q(`select public.share_discharge_summary($1)`, [open]), /permission/); await q("rollback to savepoint s3");
    });
  });
  it("the patient cannot read admissions, notes or draft results, even their own", async () => {
    await scenario(async (as2, q) => {
      await amalDischarged(q, "discharged");
      await as2(U.patientA);
      for (const t of ["admissions", "care_tasks", "observations", "consultations", "procedures", "lab_orders", "dispensings", "charges", "deposits"]) {
        expect(await q(`select 1 from public.${t}`), t).toHaveLength(0);
      }
    });
  });
});

describe("discharge_blockers for roles that cannot read the summary", () => {
  it("reception sees the same blockers the database enforces, and no clinical text", async () => {
    await scenario(async (as2, q) => {
      await as2(U.doctorA);
      await q(`select public.authorise_discharge($1, 'Recovered well, walking independently.')`, [ID.admGeorge]);
      await as2(U.deskA);
      expect(await q(`select 1 from public.admission_summaries`)).toHaveLength(0); // cannot read it
      const b = (await q(`select public.discharge_blockers($1) as b`, [ID.admGeorge]))[0]!.b as string[];
      expect(b).not.toContain("Discharge summary has not been written");
      expect(b).toContain("Finance clearance is outstanding");
      await as2(U.labA);
      await q("savepoint s"); await fails(q(`select public.discharge_blockers($1)`, [ID.admGeorge]), /permission/); await q("rollback to savepoint s");
      await as2(U.adminB);
      await q("savepoint s2"); await fails(q(`select public.discharge_blockers($1)`, [ID.admGeorge]), /not found/i); await q("rollback to savepoint s2");
    });
  });
});
