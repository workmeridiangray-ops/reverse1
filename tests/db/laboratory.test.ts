import { afterAll, describe, expect, it } from "vitest";
import { as, attempt, ID, pool, type Q, U } from "./helpers";

afterAll(() => pool.end());

/** One transaction, switching identity per step (like separate people at separate screens). */
async function scenario(fn: (as2: (u: string) => Promise<void>, q: (sql: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) => Promise<void>) {
  const c = await pool.connect();
  const as2 = async (uid: string) => {
    await c.query("reset role"); await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
  };
  try { await c.query("begin"); await fn(as2, (sql, p) => c.query(sql, p) as never); } finally { await c.query("rollback").catch(() => undefined); c.release(); }
}
const fails = async (c: Promise<unknown>, re: RegExp) => expect(c).rejects.toThrow(re);

describe("ordering and collection", () => {
  it("only doctors order; patient must be in this clinic; admission must be current", async () => {
    await as("doctorA", async (q) => {
      expect((await attempt(q, `select public.place_order($1, null, 'Urea', 'lab', 'routine', null)`, [ID.jon])).error).toMatch(/Patient not found/);
      expect((await attempt(q, `select public.place_order($1, $2, 'Urea', 'lab', 'routine', null)`, [ID.ptOwen, ID.admOwen])).error).toMatch(/not current/);
      expect((await attempt(q, `select public.place_order($1, null, 'Urea', 'lab', 'soon', null)`, [ID.amal])).ok).toBe(false);
      expect((await attempt(q, `select public.place_order($1, $2, 'Urea', 'lab', 'urgent', 'query renal')`, [ID.george, ID.admGeorge])).ok).toBe(true);
    });
    for (const u of ["nurseA", "labA", "deskA", "patientA"] as const) {
      expect((await as(u, (q) => attempt(q, `select public.place_order($1, null, 'x', 'lab', 'routine', null)`, [ID.amal]))).error, u).toMatch(/permission/);
    }
  });
  it("collection assigns unique accession numbers; cannot collect twice", async () => {
    await as("labA", async (q) => {
      const [{ a }] = await q<{ a: string }>(`select public.collect_specimen($1) as a`, [ID.ordXray]) as [{ a: string }];
      expect(a).toMatch(/^IMG-\d{6}$/);
      expect((await attempt(q, `select public.collect_specimen($1)`, [ID.ordXray])).error).toMatch(/already collected/);
    });
  });
});

describe("result lifecycle", () => {
  it("enter -> independent review -> publish; doctors see nothing until published", async () => {
    await scenario(async (as2, q) => {
      await as2(U.labA);
      await q(`select public.enter_result($1, '13.5', 'g/dL', '12-16', 'normal', null)`, [ID.ordFbc]);
      expect((await q(`select 1 from public.lab_results`)).rows).toHaveLength(1);
      await as2(U.doctorA);
      expect((await q(`select 1 from public.lab_results`)).rows).toHaveLength(0);
      await as2(U.labA);
      await q("savepoint s"); await fails(q(`select public.publish_result($1)`, [ID.ordFbc]), /someone other than/); await q("rollback to savepoint s");
      await as2(U.adminA);
      await q(`select public.publish_result($1)`, [ID.ordFbc]);
      await as2(U.doctorA);
      expect((await q(`select value from public.lab_results`)).rows).toHaveLength(1);
      const n = (await q(`select kind, link from public.notifications`)).rows;
      expect(n).toHaveLength(1);
      expect(n[0]?.kind).toBe("result");
      // the other doctor does not get the ordering doctor's notification
      await as2(U.doctorA2);
      expect((await q(`select 1 from public.notifications`)).rows).toHaveLength(0);
    });
  });
  it("cannot enter a result before collection or while one awaits review", async () => {
    await as("labA", async (q) => {
      expect((await attempt(q, `select public.enter_result($1, '1', null, null, 'normal', null)`, [ID.ordXray])).error).toMatch(/Collect the specimen first/);
    });
    await scenario(async (as2, q) => {
      await as2(U.labA);
      await q(`select public.enter_result($1, '1', null, null, 'normal', null)`, [ID.ordFbc]);
      await q("savepoint s"); await fails(q(`select public.enter_result($1, '2', null, null, 'normal', null)`, [ID.ordFbc]), /already waiting/); await q("rollback to savepoint s");
    });
  });
  it("amendment: new version needs a reason and review; old version is kept as superseded; doctor is notified", async () => {
    await scenario(async (as2, q) => {
      await as2(U.labA); await q(`select public.enter_result($1, '13.5', 'g/dL', null, 'normal', null)`, [ID.ordFbc]);
      await as2(U.adminA); await q(`select public.publish_result($1)`, [ID.ordFbc]);
      await as2(U.labA);
      await q("savepoint s"); await fails(q(`select public.enter_result($1, '9.0', 'g/dL', null, 'abnormal', null)`, [ID.ordFbc]), /reason for the amendment/); await q("rollback to savepoint s");
      await q(`select public.enter_result($1, '9.0', 'g/dL', null, 'abnormal', null, 'Transcription error corrected')`, [ID.ordFbc]);
      await as2(U.adminA); await q(`select public.publish_result($1)`, [ID.ordFbc]);
      await as2(U.doctorA);
      const rows = (await q(`select version, state, value from public.lab_results order by version`)).rows;
      expect(rows.map((r) => [r.version, r.state, r.value])).toEqual([[1, "superseded", "13.5"], [2, "published", "9.0"]]);
      expect((await q(`select kind from public.notifications order by created_at`)).rows.map((r) => r.kind)).toEqual(["result", "amended_result"]);
    });
  });
  it("published results cannot be edited or deleted by anyone through the API", async () => {
    await as("adminA", async (q) => {
      expect((await attempt(q, `update public.lab_results set value = 'x'`)).error).toMatch(/permission denied/);
      expect((await attempt(q, `delete from public.lab_results`)).error).toMatch(/permission denied/);
    });
  });
  it("cancelling needs a reason and is only for orders without results; only the ordering doctor", async () => {
    await as("doctorA2", async (q) => { expect((await attempt(q, `select public.cancel_order($1, 'Not needed anymore')`, [ID.ordXray])).error).toMatch(/ordering doctor/); });
    await as("doctorA", async (q) => {
      expect((await attempt(q, `select public.cancel_order($1, 'no')`, [ID.ordXray])).error).toMatch(/reason/);
      expect((await attempt(q, `select public.cancel_order($1, 'Duplicate request')`, [ID.ordXray])).ok).toBe(true);
    });
  });
});

describe("critical results", () => {
  it("publishing notifies as critical; acknowledgement is recorded; unacknowledged ones escalate after the window", async () => {
    await scenario(async (as2, q) => {
      await as2(U.labA); await q(`select public.enter_result($1, 'K 6.9', 'mmol/L', '3.5-5.0', 'critical', 'Repeat confirmed')`, [ID.ordFbc]);
      await as2(U.adminA); await q(`select public.publish_result($1)`, [ID.ordFbc]);
      await as2(U.doctorA);
      expect((await q(`select kind from public.notifications`)).rows[0]?.kind).toBe("critical_result");
      expect((await q(`select 1 from public.overdue_critical_results`)).rows).toHaveLength(0); // fresh
      await q("reset role");
      await q(`update public.lab_results set published_at = now() - interval '2 hours' where order_id = $1`, [ID.ordFbc]);
      await as2(U.doctorA);
      expect((await q(`select 1 from public.overdue_critical_results`)).rows).toHaveLength(1);
      await as2(U.nurseA);
      await q("savepoint s"); await fails(q(`select public.acknowledge_critical($1)`, [ID.ordFbc]), /permission/); await q("rollback to savepoint s");
      await as2(U.doctorA);
      await q(`select public.acknowledge_critical($1)`, [ID.ordFbc]);
      expect((await q(`select 1 from public.overdue_critical_results`)).rows).toHaveLength(0);
      await q("savepoint s2"); await fails(q(`select public.acknowledge_critical($1)`, [ID.ordFbc]), /Already acknowledged/); await q("rollback to savepoint s2");
    });
  });
});

describe("isolation and patient access", () => {
  it("other clinic cannot see or act on orders; patients see only their own published results", async () => {
    await as("doctorB", async (q: Q) => {
      expect(await q(`select 1 from public.lab_orders`)).toHaveLength(0);
      expect((await attempt(q, `select public.cancel_order($1, 'Not mine to cancel')`, [ID.ordFbc])).error).toMatch(/not found/i);
    });
    await scenario(async (as2, q) => {
      await as2(U.labA); await q(`select public.enter_result($1, 'Clear', null, null, 'normal', null)`, [ID.ordFbc]);
      await q("reset role");
      await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.patientA })]);
      await q("set local role authenticated");
      expect((await q(`select 1 from public.lab_results`)).rows).toHaveLength(0); // draft, and not their patient anyway
    });
    // Amal's own published result is visible to Amal, and only hers.
    await scenario(async (as2, q) => {
      await as2(U.labA); await q(`select public.collect_specimen($1)`, [ID.ordXray]);
      await q(`select public.enter_result($1, 'No acute abnormality', null, null, 'normal', null)`, [ID.ordXray]);
      await as2(U.adminA); await q(`select public.publish_result($1)`, [ID.ordXray]);
      await as2(U.patientA);
      expect((await q(`select value from public.lab_results`)).rows.map((r) => r.value)).toEqual(["No acute abnormality"]);
      await as2(U.patientB);
      expect((await q(`select 1 from public.lab_results`)).rows).toHaveLength(0);
    });
  });
});
