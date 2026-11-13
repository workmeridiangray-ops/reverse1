import { afterAll, describe, expect, it } from "vitest";
import { as, attempt, ID, pool, U } from "./helpers";

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
const sp = async (q: (s: string, p?: unknown[]) => Promise<Row[]>, n: string, fn: () => Promise<void>) => { await q(`savepoint ${n}`); await fn(); await q(`rollback to savepoint ${n}`); };
const H = (h: number) => `now() + interval '${h} hours'`;

describe("requesting and scheduling", () => {
  it("only doctors request; the surgeon must be a doctor; admission must be open", async () => {
    await as("doctorA", async (q) => {
      expect((await attempt(q, `select public.request_procedure($1, null, $2, 'Appendicectomy', 'urgent')`, [ID.amal, U.labA])).error).toMatch(/must be an active doctor/);
      expect((await attempt(q, `select public.request_procedure($1, $2, $3, 'Appendicectomy', 'urgent')`, [ID.amal, ID.admGeorge, U.doctorA])).error).toMatch(/not open/);
      expect((await attempt(q, `select public.request_procedure($1, null, $2, 'Appendicectomy', 'urgent')`, [ID.amal, U.doctorA])).ok).toBe(true);
    });
    expect((await as("nurseA", (q) => attempt(q, `select public.request_procedure($1, null, $2, 'x y z', 'urgent')`, [ID.amal, U.doctorA]))).error).toMatch(/permission/);
  });
  it("scheduling needs a procedure room in service, creates the checklist and puts the surgeon on the team", async () => {
    await scenario(async (as2, q) => {
      await as2(U.nurseA);
      await sp(q, "a", () => fails(q(`select public.schedule_procedure($1, $2, ${H(2)}, ${H(4)}, '[]')`, [ID.procHip, ID.roomA1]), /procedure room/));
      await q(`select public.schedule_procedure($1, $2, ${H(2)}, ${H(4)}, $3::jsonb)`, [ID.procHip, ID.theatre1, JSON.stringify([{ user: U.deskA, role: "assistant" }])]);
      expect((await q(`select status from public.procedures where id = $1`, [ID.procHip]))[0]?.status).toBe("scheduled");
      expect((await q(`select count(*)::int as n from public.procedure_checklist`))[0]?.n).toBe(5);
      expect((await q(`select team_role from public.procedure_team where user_id = $1 and active`, [U.doctorA]))[0]?.team_role).toBe("surgeon");
    });
  });
  it("doctors, reception and others cannot schedule", async () => {
    for (const u of ["doctorA", "deskA", "pharmA", "labA", "patientA"] as const) {
      expect((await as(u, (q) => attempt(q, `select public.schedule_procedure($1, $2, ${H(2)}, ${H(4)}, '[]')`, [ID.procHip, ID.theatre1]))).error, u).toMatch(/permission/);
    }
  });
});

describe("conflicts are refused by the database", () => {
  async function two(q: (s: string, p?: unknown[]) => Promise<Row[]>, as2: (u: string) => Promise<void>) {
    await as2(U.doctorA2);
    const p2 = (await q(`select public.request_procedure($1, null, $2, 'Hernia repair', 'elective') as id`, [ID.amal, U.doctorA2]))[0]!.id as string;
    const p3 = (await q(`select public.request_procedure($1, null, $2, 'Cataract surgery', 'elective') as id`, [ID.ravi, U.doctorA]))[0]!.id as string;
    await as2(U.nurseA);
    await q(`select public.schedule_procedure($1, $2, ${H(2)}, ${H(4)}, '[]')`, [ID.procHip, ID.theatre1]);
    return { p2, p3 };
  }
  it("same room overlapping; touching times are fine", async () => {
    await scenario(async (as2, q) => {
      const { p2 } = await two(q, as2);
      await sp(q, "a", () => fails(q(`select public.schedule_procedure($1, $2, ${H(3)}, ${H(5)}, '[]')`, [p2, ID.theatre1]), /procedures_no_room_overlap/));
      await q(`select public.schedule_procedure($1, $2, ${H(4)}, ${H(6)}, '[]')`, [p2, ID.theatre1]);
    });
  });
  it("same surgeon or staff member in two places at once", async () => {
    await scenario(async (as2, q) => {
      const { p3 } = await two(q, as2); // p3 surgeon is doctorA who is already in Theatre 1
      await sp(q, "a", () => fails(q(`select public.schedule_procedure($1, $2, ${H(3)}, ${H(5)}, '[]')`, [p3, ID.theatre2]), /procedure_team_no_staff_overlap/));
      await q(`select public.schedule_procedure($1, $2, ${H(5)}, ${H(7)}, '[]')`, [p3, ID.theatre2]);
    });
  });
  it("same patient in two procedures at once", async () => {
    await scenario(async (as2, q) => {
      await as2(U.doctorA2);
      const dup = (await q(`select public.request_procedure($1, null, $2, 'Second procedure', 'elective') as id`, [ID.george, U.doctorA2]))[0]!.id as string;
      await as2(U.nurseA);
      await q(`select public.schedule_procedure($1, $2, ${H(2)}, ${H(4)}, '[]')`, [ID.procHip, ID.theatre1]);
      await sp(q, "a", () => fails(q(`select public.schedule_procedure($1, $2, ${H(3)}, ${H(5)}, '[]')`, [dup, ID.theatre2]), /procedures_no_patient_overlap/));
    });
  });
  it("a cancelled procedure frees its room, surgeon and patient", async () => {
    await scenario(async (as2, q) => {
      const { p3 } = await two(q, as2);
      await as2(U.doctorA);
      await sp(q, "a", () => fails(q(`select public.cancel_procedure($1, 'no')`, [ID.procHip]), /reason/));
      await q(`select public.cancel_procedure($1, 'Patient unfit on the day')`, [ID.procHip]);
      await as2(U.nurseA);
      await q(`select public.schedule_procedure($1, $2, ${H(2)}, ${H(4)}, '[]')`, [p3, ID.theatre1]);
    });
  });
});

describe("checklist, consent and starting", () => {
  async function ready(as2: (u: string) => Promise<void>, q: (s: string, p?: unknown[]) => Promise<Row[]>) {
    await as2(U.nurseA); await q(`select public.schedule_procedure($1, $2, ${H(1)}, ${H(3)}, '[]')`, [ID.procHip, ID.theatre1]);
  }
  it("cannot start with open checklist items or no consent; with both it starts", async () => {
    await scenario(async (as2, q) => {
      await ready(as2, q);
      await sp(q, "a", () => fails(q(`select public.start_procedure($1)`, [ID.procHip]), /5 checklist item\(s\) not done; no consent recorded/));
      const items = (await q(`select id from public.procedure_checklist`)).map((r) => r.id as string);
      for (const i of items) await q(`select public.tick_checklist($1)`, [i]);
      await sp(q, "b", () => fails(q(`select public.tick_checklist($1)`, [items[0]]), /already done/));
      await sp(q, "c", () => fails(q(`select public.start_procedure($1)`, [ID.procHip]), /no consent recorded/));
      await as2(U.doctorA);
      await sp(q, "d", () => fails(q(`select public.record_consent($1, 'Amal', 'self', 'verbal_witnessed', null, 'Note 1')`, [ID.procHip]), /check constraint/)); // witness required
      await q(`select public.record_consent($1, 'George Mensah', 'self', 'written', null, 'Form F-22 scanned in record')`, [ID.procHip]);
      await sp(q, "e", () => fails(q(`select public.record_consent($1, 'George Mensah', 'self', 'written', null, 'Form F-23')`, [ID.procHip]), /procedure_consent_one_active/));
      await q(`select public.start_procedure($1)`, [ID.procHip]);
      expect((await q(`select status from public.procedures where id = $1`, [ID.procHip]))[0]?.status).toBe("in_progress");
    });
  });
  it("withdrawn consent blocks starting again", async () => {
    await scenario(async (as2, q) => {
      await ready(as2, q);
      for (const i of (await q(`select id from public.procedure_checklist`)).map((r) => r.id as string)) await q(`select public.tick_checklist($1)`, [i]);
      await as2(U.doctorA);
      await q(`select public.record_consent($1, 'George Mensah', 'self', 'written', null, 'Form F-22')`, [ID.procHip]);
      await q(`select public.withdraw_consent($1, 'Patient changed his mind')`, [ID.procHip]);
      await sp(q, "a", () => fails(q(`select public.start_procedure($1)`, [ID.procHip]), /no consent recorded/));
    });
  });
  it("an emergency may start with open items only with a documented reason, and it is logged", async () => {
    await scenario(async (as2, q) => {
      await as2(U.doctorA);
      const em = (await q(`select public.request_procedure($1, null, $2, 'Craniotomy', 'emergency') as id`, [ID.amal, U.doctorA]))[0]!.id as string;
      await as2(U.nurseA); await q(`select public.schedule_procedure($1, $2, now(), ${H(2)}, '[]')`, [em, ID.theatre2]);
      await as2(U.doctorA);
      await sp(q, "a", () => fails(q(`select public.start_procedure($1, 'short')`, [em]), /Cannot start/));
      await q(`select public.start_procedure($1, 'Life-threatening bleed, patient unable to consent, checks continuing')`, [em]);
      const log = await q(`select change from public.procedure_changes where procedure_id = $1`, [em]);
      expect(log.some((r) => String(r.change).startsWith("Emergency start with open items"))).toBe(true);
      // an elective procedure cannot use the override
      await as2(U.nurseA); await q(`select public.schedule_procedure($1, $2, ${H(3)}, ${H(5)}, '[]')`, [ID.procHip, ID.theatre1]);
      await as2(U.doctorA);
      await sp(q, "b", () => fails(q(`select public.start_procedure($1, 'Long reason here but it is elective')`, [ID.procHip]), /Cannot start/));
    });
  });
});

describe("notes, recovery and late changes", () => {
  it("full pathway; notes are versioned, amendments need a reason, late reschedule needs a reason and is logged", async () => {
    await scenario(async (as2, q) => {
      await as2(U.nurseA); await q(`select public.schedule_procedure($1, $2, ${H(1)}, ${H(3)}, '[]')`, [ID.procHip, ID.theatre1]);
      await sp(q, "a", () => fails(q(`select public.schedule_procedure($1, $2, ${H(2)}, ${H(4)}, '[]')`, [ID.procHip, ID.theatre1]), /reason for changing/));
      await q(`select public.schedule_procedure($1, $2, ${H(2)}, ${H(4)}, '[]', 'Theatre list overran')`, [ID.procHip, ID.theatre1]);
      expect((await q(`select version from public.procedures where id = $1`, [ID.procHip]))[0]?.version).toBe(3);
      for (const i of (await q(`select id from public.procedure_checklist`)).map((r) => r.id as string)) await q(`select public.tick_checklist($1)`, [i]);
      await as2(U.doctorA);
      await q(`select public.record_consent($1, 'George Mensah', 'self', 'written', null, 'Form F-22')`, [ID.procHip]);
      await q(`select public.start_procedure($1)`, [ID.procHip]);
      await sp(q, "b", () => fails(q(`select public.move_to_recovery($1)`, [ID.procHip]), /write the procedure note/));
      expect((await q(`select public.write_procedure_note($1, 'Uneventful revision, 200 ml loss.') as v`, [ID.procHip]))[0]?.v).toBe(1);
      await q(`select public.move_to_recovery($1)`, [ID.procHip]);
      await as2(U.nurseA); await q(`select public.complete_recovery($1)`, [ID.procHip]);
      await as2(U.doctorA);
      await sp(q, "c", () => fails(q(`select public.write_procedure_note($1, 'Blood loss was actually 350 ml.')`, [ID.procHip]), /check constraint/));
      expect((await q(`select public.write_procedure_note($1, 'Blood loss was actually 350 ml.', 'Corrected after swab count') as v`, [ID.procHip]))[0]?.v).toBe(2);
      expect((await q(`select count(*)::int as n from public.procedure_notes`))[0]?.n).toBe(2);
      await sp(q, "d", () => fails(q(`update public.procedure_notes set body = 'changed'`), /permission denied/));
      const log = (await q(`select change from public.procedure_changes order by id`)).map((r) => String(r.change));
      expect(log.some((c) => c.startsWith("Rescheduled"))).toBe(true);
      expect(log.some((c) => c.startsWith("Procedure note amended"))).toBe(true);
      await as2(U.nurseA);
      await sp(q, "e", () => fails(q(`select public.schedule_procedure($1, $2, ${H(5)}, ${H(6)}, '[]', 'again')`, [ID.procHip, ID.theatre1]), /no longer be rescheduled/));
    });
  });
  it("other clinic sees nothing and cannot act; reception and lab cannot read procedures", async () => {
    await as("adminB", async (q) => {
      expect(await q(`select 1 from public.procedures`)).toHaveLength(0);
      expect((await attempt(q, `select public.cancel_procedure($1, 'Not our procedure')`, [ID.procHip])).error).toMatch(/not found/i);
    });
    for (const u of ["deskA", "labA", "pharmA", "patientA"] as const) expect(await as(u, (q) => q(`select 1 from public.procedures`)), u).toHaveLength(0);
  });
});
