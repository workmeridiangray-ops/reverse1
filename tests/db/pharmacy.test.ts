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
const sp = async (q: (s: string, p?: unknown[]) => Promise<Row[]>, name: string, fn: () => Promise<void>) => { await q(`savepoint ${name}`); await fn(); await q(`rollback to savepoint ${name}`); };
const RX = "a5000000-0000-4000-8000-000000000001"; // active, 21 x Amoxicillin 500 mg (seed)

describe("dispensing rules", () => {
  it("dispenses from an in-date available batch, reduces stock, writes a ledger row; partial then complete", async () => {
    await scenario(async (as2, q) => {
      await as2(U.pharmA);
      await q(`select public.dispense($1, $2, 10)`, [RX, ID.batchAmxA]);
      expect((await q(`select on_hand_qty from public.stock_batches where id = $1`, [ID.batchAmxA]))[0]?.on_hand_qty).toBe(90);
      expect((await q(`select status from public.prescriptions where id = $1`, [RX]))[0]?.status).toBe("active"); // partial
      await sp(q, "a", () => fails(q(`select public.dispense($1, $2, 12)`, [RX, ID.batchAmxA]), /exceed the prescribed quantity/));
      await q(`select public.dispense($1, $2, 11)`, [RX, ID.batchAmxA]);
      expect((await q(`select status from public.prescriptions where id = $1`, [RX]))[0]?.status).toBe("dispensed");
      await sp(q, "b", () => fails(q(`select public.dispense($1, $2, 1)`, [RX, ID.batchAmxA]), /not active/));
      // ledger balances to on-hand for every batch
      const bad = await q(`select b.batch_no from public.stock_batches b where b.on_hand_qty <> coalesce((select sum(qty) from public.stock_movements m where m.batch_id = b.id), 0)`);
      expect(bad).toEqual([]);
    });
  });
  it("refuses expired, quarantined, over-stock and wrong-medicine batches", async () => {
    await scenario(async (as2, q) => {
      await as2(U.pharmA);
      await sp(q, "a", () => fails(q(`select public.dispense($1, $2, 1)`, [RX, ID.batchAmxExpired]), /expired on/));
      await sp(q, "b", () => fails(q(`select public.dispense($1, $2, 1)`, [RX, ID.batchAmxQuarantined]), /quarantined/));
      await sp(q, "c", () => fails(q(`select public.dispense($1, $2, 1)`, [RX, ID.batchAmx250]), /different medicine/));
      await sp(q, "d", () => fails(q(`select public.dispense($1, $2, 0)`, [RX, ID.batchAmxA]), /check constraint/));
    });
  });
  it("only pharmacists dispense; other clinics cannot", async () => {
    for (const u of ["doctorA", "adminA", "nurseA", "deskA", "labA"] as const) {
      expect((await as(u, (q) => attempt(q, `select public.dispense($1, $2, 1)`, [RX, ID.batchAmxA]))).error, u).toMatch(/permission/);
    }
  });
  it("two pharmacists racing on one prescription cannot over-dispense it", async () => {
    const c1 = await pool.connect(); const c2 = await pool.connect();
    const open = async (c: typeof c1) => { await c.query("begin"); await c.query("set local role authenticated"); await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U.pharmA, role: "authenticated" })]); };
    const started = (await pool.query(`select clock_timestamp() as t`)).rows[0].t as Date;
    try {
      await open(c1); await open(c2);
      await c1.query(`select public.dispense($1, $2, 12)`, [RX, ID.batchAmxA]);
      const second = c2.query(`select public.dispense($1, $2, 12)`, [RX, ID.batchAmxB]).then(() => "ok", (e: Error) => e.message);
      await new Promise((r) => setTimeout(r, 300));
      await c1.query("commit");
      expect(await second).toMatch(/exceed the prescribed quantity \(12 already dispensed of 21\)/);
    } finally {
      await c2.query("rollback").catch(() => undefined); c1.release(); c2.release();
      const t = await pool.connect();
      try { // restore the seed exactly (this test had to commit)
        await t.query("begin"); await t.query("set local role postgres").catch(() => undefined); await t.query("set local session_replication_role = replica");
        await t.query(`delete from public.dispensings where prescription_id = $1`, [RX]);
        await t.query(`delete from public.stock_movements where kind = 'dispense'`);
        await t.query(`update public.stock_batches set on_hand_qty = received_qty where id in ($1, $2)`, [ID.batchAmxA, ID.batchAmxB]);
        await t.query(`update public.prescriptions set status = 'active' where id = $1`, [RX]);
        await t.query(`delete from public.audit_log where occurred_at >= $1`, [started]);
        await t.query("commit");
      } finally { t.release(); }
    }
  });
});

describe("controlled medicines and substitution", () => {
  it("controlled dispensing needs a different, active witness", async () => {
    await scenario(async (as2, q) => {
      await as2(U.doctorA);
      const rx = (await q(`select public.prescribe($1, $2, '10 mg', 'oral', 'every 6 hours', 2, 8) as id`, [ID.amal, ID.medMorphine]))[0]!.id as string;
      await as2(U.pharmA);
      await sp(q, "a", () => fails(q(`select public.dispense($1, $2, 4)`, [rx, ID.batchMorphine]), /witness/));
      await sp(q, "b", () => fails(q(`select public.dispense($1, $2, 4, $3)`, [rx, ID.batchMorphine, U.pharmA]), /witness/));
      await sp(q, "c", () => fails(q(`select public.dispense($1, $2, 4, $3)`, [rx, ID.batchMorphine, U.labA]), /witness/));
      await q(`select public.dispense($1, $2, 4, $3)`, [rx, ID.batchMorphine, U.doctorA]);
      expect((await q(`select witness_id from public.dispensings`))[0]?.witness_id).toBe(U.doctorA);
    });
  });
  it("a substitute is dispensed only after the prescriber approves", async () => {
    await scenario(async (as2, q) => {
      await as2(U.pharmA);
      await q(`select public.request_substitution($1, $2, '500 mg out of stock, equivalent dose')`, [RX, ID.medAmx250]);
      await sp(q, "a", () => fails(q(`select public.dispense($1, $2, 2)`, [RX, ID.batchAmx250]), /different medicine/));
      const sub = (await q(`select id from public.substitutions`))[0]!.id as string;
      await sp(q, "b", () => fails(q(`select public.decide_substitution($1, true)`, [sub]), /permission/));
      await as2(U.doctorA2);
      await sp(q, "c", () => fails(q(`select public.decide_substitution($1, true)`, [sub]), /Only the prescriber/));
      await as2(U.doctorA);
      expect((await q(`select count(*)::int as n from public.notifications`))[0]?.n).toBe(1);
      await q(`select public.decide_substitution($1, true)`, [sub]);
      await as2(U.pharmA);
      await q(`select public.dispense($1, $2, 2)`, [RX, ID.batchAmx250]);
    });
  });
  it("prescribing needs a formulary medicine from this clinic", async () => {
    await as("doctorA", async (q) => {
      expect((await attempt(q, `select public.prescribe($1, 'be000000-0000-4000-8000-000000000001', '1', 'oral', 'daily', 1, 1)`, [ID.amal])).error).toMatch(/not found/i);
    });
    expect((await as("pharmA", (q) => attempt(q, `select public.prescribe($1, $2, '1', 'oral', 'daily', 1, 1)`, [ID.amal, ID.medAmx500]))).error).toMatch(/permission/);
  });
});

describe("returns, quarantine, recall, disposal, receipt", () => {
  it("a return is reviewed by someone else; saleable restocks only if the batch is still good; otherwise disposed", async () => {
    await scenario(async (as2, q) => {
      await as2(U.pharmA);
      const d = (await q(`select public.dispense($1, $2, 10) as id`, [RX, ID.batchAmxA]))[0]!.id as string;
      const r1 = (await q(`select public.request_return($1, 4, 'Patient stopped treatment', true) as id`, [d]))[0]!.id as string;
      await sp(q, "a", () => fails(q(`select public.request_return($1, 7, 'Too many', true)`, [d]), /Only 6 can still be returned/));
      await sp(q, "b", () => fails(q(`select public.decide_return($1, true)`, [r1]), /someone other than/));
      await as2(U.adminA);
      expect((await q(`select public.decide_return($1, true) as o`, [r1]))[0]?.o).toBe("restocked");
      expect((await q(`select on_hand_qty from public.stock_batches where id = $1`, [ID.batchAmxA]))[0]?.on_hand_qty).toBe(94);
      await as2(U.pharmA);
      const r2 = (await q(`select public.request_return($1, 2, 'Wrong strength', false) as id`, [d]))[0]!.id as string;
      await as2(U.adminA);
      expect((await q(`select public.decide_return($1, true) as o`, [r2]))[0]?.o).toBe("disposed");
      expect((await q(`select on_hand_qty from public.stock_batches where id = $1`, [ID.batchAmxA]))[0]?.on_hand_qty).toBe(94); // not restocked
      const bad = await q(`select 1 from public.stock_batches b where b.on_hand_qty <> coalesce((select sum(qty) from public.stock_movements m where m.batch_id = b.id), 0)`);
      expect(bad).toEqual([]);
    });
  });
  it("a quarantined or recalled batch is never restocked from a return", async () => {
    await scenario(async (as2, q) => {
      await as2(U.pharmA);
      const d = (await q(`select public.dispense($1, $2, 5) as id`, [RX, ID.batchAmxA]))[0]!.id as string;
      const r = (await q(`select public.request_return($1, 5, 'Unused', true) as id`, [d]))[0]!.id as string;
      await q(`select public.set_batch_status($1, 'recalled', 'Manufacturer recall notice 12')`, [ID.batchAmxA]);
      await as2(U.adminA);
      expect((await q(`select public.decide_return($1, true) as o`, [r]))[0]?.o).toBe("disposed");
    });
  });
  it("recall blocks dispensing and notifies prescribers of affected patients; recalled status is final", async () => {
    await scenario(async (as2, q) => {
      await as2(U.pharmA);
      await q(`select public.dispense($1, $2, 5)`, [RX, ID.batchAmxA]);
      expect((await q(`select public.set_batch_status($1, 'recalled', 'Manufacturer recall notice 12') as n`, [ID.batchAmxA]))[0]?.n).toBe(1);
      await sp(q, "a", () => fails(q(`select public.dispense($1, $2, 1)`, [RX, ID.batchAmxA]), /recalled/));
      await sp(q, "b", () => fails(q(`select public.set_batch_status($1, 'available', null)`, [ID.batchAmxA]), /cannot change status/));
      await as2(U.doctorA);
      expect((await q(`select kind from public.notifications`))[0]?.kind).toBe("recall");
    });
  });
  it("quarantine needs a reason and can be released; disposal is only for expired/quarantined/recalled stock", async () => {
    await scenario(async (as2, q) => {
      await as2(U.pharmA);
      await sp(q, "a", () => fails(q(`select public.set_batch_status($1, 'quarantined', 'x')`, [ID.batchAmxB]), /Give a reason/));
      await q(`select public.set_batch_status($1, 'quarantined', 'Packaging damaged on arrival')`, [ID.batchAmxB]);
      await q(`select public.set_batch_status($1, 'available', null)`, [ID.batchAmxB]);
      await sp(q, "b", () => fails(q(`select public.dispose_batch($1, 'Not needed anymore')`, [ID.batchAmxB]), /Only expired/));
      await q(`select public.dispose_batch($1, 'Expired stock destroyed per policy')`, [ID.batchAmxExpired]);
      expect((await q(`select status, on_hand_qty from public.stock_batches where id = $1`, [ID.batchAmxExpired]))[0]).toMatchObject({ status: "disposed", on_hand_qty: 0 });
      const bad = await q(`select 1 from public.stock_batches b where b.on_hand_qty <> coalesce((select sum(qty) from public.stock_movements m where m.batch_id = b.id), 0)`);
      expect(bad).toEqual([]);
    });
  });
  it("receiving stock rejects expired batches and duplicate batch numbers; ledger is immutable", async () => {
    await scenario(async (as2, q) => {
      await as2(U.pharmA);
      await sp(q, "a", () => fails(q(`select public.receive_stock($1, 'NEW-1', current_date - 1, 10, 'PO-1')`, [ID.medAmx500]), /already expired/));
      await q(`select public.receive_stock($1, 'NEW-1', current_date + 100, 10, 'PO-1')`, [ID.medAmx500]);
      await sp(q, "b", () => fails(q(`select public.receive_stock($1, 'NEW-1', current_date + 100, 10, 'PO-1')`, [ID.medAmx500]), /duplicate key/));
      await sp(q, "c", () => fails(q(`update public.stock_movements set qty = 1`), /permission denied/));
    });
    expect((await as("doctorA", (q) => attempt(q, `select public.receive_stock($1, 'X', current_date + 5, 1, null)`, [ID.medAmx500]))).error).toMatch(/permission/);
  });
  it("other clinic sees none of it and cannot act on it", async () => {
    await as("adminB", async (q) => {
      expect(await q(`select 1 from public.stock_batches`)).toHaveLength(0);
      expect((await attempt(q, `select public.dispose_batch($1, 'Not mine to dispose')`, [ID.batchAmxExpired])).error).toMatch(/not found/i);
    });
  });
});
