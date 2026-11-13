import { afterAll, describe, expect, it } from "vitest";
import { as, attempt, failure, ID, pool, type Q, U } from "./helpers";

afterAll(() => pool.end());
const A = "aaaaaaaa-0000-4000-8000-000000000000";

describe("tariffs", () => {
  it("only admin manages tariffs; active tariff items are frozen", async () => {
    const r = await as("adminA", (q) => attempt(q, `update public.tariff_items set unit_price_minor = 1 where version_id = $1`, [ID.tariffA]));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Only a draft/);
    expect(await failure(as("deskA", (q) => q(`select public.create_tariff_draft('x', current_date)`)))).toMatch(/permission/);
  });
  it("a new version copies prices, can change them, and activating retires the old one without touching charges", async () => {
    await as("adminA", async (q) => {
      const { id } = (await q<{ id: string }>(`select public.create_tariff_draft('Standard 2027', current_date, $1) as id`, [ID.tariffA]))[0]!;
      await q(`update public.tariff_items set unit_price_minor = 13000 where version_id = $1 and code = 'BED-GEN'`, [id]);
      await q(`select public.activate_tariff($1)`, [id]);
      const v = await q<{ status: string }>(`select status from public.tariff_versions where id = $1`, [ID.tariffA]);
      expect(v[0]?.status).toBe("retired");
      const c = await q<{ unit_price_minor: number }>(`select unit_price_minor from public.charges where item_code = 'DRESS'`);
      expect(c[0]?.unit_price_minor).toBe(1500); // snapshot unchanged
    });
  });
  it("an empty draft cannot be activated; direct status changes are refused", async () => {
    await as("adminA", async (q) => {
      const { id } = (await q<{ id: string }>(`select public.create_tariff_draft('Empty', current_date) as id`))[0]!;
      expect((await attempt(q, `select public.activate_tariff($1)`, [id])).error).toMatch(/at least one price/);
      expect((await attempt(q, `update public.tariff_versions set status = 'active' where id = $1`, [id])).ok).toBe(false);
    });
  });
});

describe("charges, bed-days and bills", () => {
  it("a charge snapshots the price; a nurse can capture but cannot read charges", async () => {
    await as("nurseA", async (q) => {
      await q(`select public.capture_charge($1, $2, 'dress', 1)`, [ID.george, ID.admGeorge]);
      expect(await q(`select 1 from public.charges`)).toHaveLength(0);
    });
  });
  it("refuses unknown codes, discharged/not-admitted admissions, other clinics", async () => {
    await as("deskA", async (q) => {
      expect((await attempt(q, `select public.capture_charge($1, $2, 'NOPE', 1)`, [ID.george, ID.admGeorge])).error).toMatch(/Unknown tariff code/);
      expect((await attempt(q, `select public.capture_charge($1, $2, 'DRESS', 1)`, [ID.ptOwen, ID.admOwen])).error).toMatch(/currently admitted/);
      expect((await attempt(q, `select public.capture_charge($1, null, 'DRESS', 0)`, [ID.george])).ok).toBe(false);
      expect((await attempt(q, `select public.capture_charge($1, null, 'DRESS', 1)`, [ID.jon])).error).toMatch(/Patient not found/);
    });
  });
  it("bed-day charges are idempotent and match billed bed-days", async () => {
    await as("deskA", async (q) => {
      const [d] = await q<{ d: number }>(`select public.billed_bed_days($1) as d`, [ID.admGeorge]);
      const [a] = await q<{ n: number }>(`select public.capture_bed_days($1) as n`, [ID.admGeorge]);
      expect(a?.n).toBe(d?.d);
      const [b] = await q<{ n: number }>(`select public.capture_bed_days($1) as n`, [ID.admGeorge]);
      expect(b?.n).toBe(0);
    });
  });
  it("generating a bill makes a draft invoice whose total equals the charges, and marks them billed", async () => {
    await as("deskA", async (q) => {
      await q(`select public.capture_charge($1, $2, 'CONS', 2)`, [ID.george, ID.admGeorge]);
      const { expected } = (await q<{ expected: number }>(`select sum(unit_price_minor * quantity)::bigint as expected from public.charges where status = 'captured' and admission_id = $1`, [ID.admGeorge]))[0]!;
      const { id } = (await q<{ id: string }>(`select public.generate_bill($1, $2) as id`, [ID.george, ID.admGeorge]))[0]!;
      const [t] = await q<{ total_minor: number; state: string }>(`select total_minor, state from public.invoice_balances where invoice_id = $1`, [id]);
      expect(t?.total_minor).toBe(expected);
      expect(t?.state).toBe("draft");
      expect((await q(`select 1 from public.charges where invoice_id = $1 and status = 'billed'`, [id])).length).toBeGreaterThan(0);
      expect((await attempt(q, `select public.generate_bill($1, $2)`, [ID.george, ID.admGeorge])).error).toMatch(/no unbilled charges/);
    });
  });
  it("voiding the draft invoice returns charges to unbilled; billed charges cannot be cancelled", async () => {
    await as("deskA", async (q) => {
      const { id } = (await q<{ id: string }>(`select public.generate_bill($1, $2) as id`, [ID.george, ID.admGeorge]))[0]!;
      const [ch] = await q<{ id: string }>(`select id from public.charges where invoice_id = $1 limit 1`, [id]);
      expect((await attempt(q, `select public.cancel_charge($1, 'wrong item')`, [ch!.id])).error).toMatch(/not been billed/);
      await q(`update public.invoices set state = 'void', void_reason = 'Raised in error' where id = $1`, [id]);
      expect((await q(`select 1 from public.charges where status = 'captured' and invoice_id is null and admission_id = $1`, [ID.admGeorge])).length).toBeGreaterThan(0);
      await q(`select public.cancel_charge($1, 'duplicate entry')`, [ch!.id]);
      expect((await attempt(q, `select public.cancel_charge($1, 'x')`, [ch!.id])).ok).toBe(false);
    });
  });
  it("clients cannot write charges directly; other clinic sees none", async () => {
    expect(await as("adminA", (q) => q(`update public.charges set unit_price_minor = 1 returning id`))).toHaveLength(0);
    expect((await as("adminA", (q) => attempt(q, `insert into public.charges (clinic_id, patient_id, tariff_version_id, item_code, category, description, unit_price_minor, quantity) values ('${A}', '${ID.george}', '${ID.tariffA}', 'X', 'service', 'X', 1, 1)`))).ok).toBe(false);
    expect(await as("adminB", (q) => q(`select 1 from public.charges`))).toHaveLength(0);
  });
});

async function issuedInvoice(q: Q, amount: number) {
  const { id } = (await q<{ id: string }>(
    `insert into public.invoices (clinic_id, patient_id) values ($1, $2) returning id`, [A, ID.george]))[0]!;
  await q(`insert into public.invoice_lines (clinic_id, invoice_id, description, quantity, unit_price_minor) values ($1, $2, 'Test', 1, $3)`, [A, id, amount]);
  await q(`update public.invoices set state = 'issued' where id = $1`, [id]);
  return id;
}

describe("deposits", () => {
  it("applying a deposit pays no more than the invoice owes; the rest stays held", async () => {
    await as("deskA", async (q) => {
      const inv = await issuedInvoice(q, 20000);
      const [a] = await q<{ n: number }>(`select public.apply_deposit($1, $2) as n`, [ID.depGeorge, inv]);
      expect(a?.n).toBe(20000);
      const [d] = await q<{ applied_minor: number }>(`select applied_minor from public.deposits where id = $1`, [ID.depGeorge]);
      expect(d?.applied_minor).toBe(20000);
      const [b] = await q<{ patient_due_now_minor: number; payment_status: string }>(`select patient_due_now_minor, payment_status from public.invoice_balances where invoice_id = $1`, [inv]);
      expect(b?.patient_due_now_minor).toBe(0);
      expect(b?.payment_status).toBe("paid");
      expect((await attempt(q, `select public.apply_deposit($1, $2)`, [ID.depGeorge, inv])).error).toMatch(/Nothing to apply/);
    });
  });
  it("cannot apply to a draft invoice or another patient's invoice", async () => {
    await as("deskA", async (q) => {
      const { id } = (await q<{ id: string }>(`insert into public.invoices (clinic_id, patient_id) values ($1, $2) returning id`, [A, ID.george]))[0]!;
      expect((await attempt(q, `select public.apply_deposit($1, $2)`, [ID.depGeorge, id])).error).toMatch(/Issue the invoice/);
      const { id: other } = (await q<{ id: string }>(`insert into public.invoices (clinic_id, patient_id) values ($1, $2) returning id`, [A, ID.amal]))[0]!;
      expect((await attempt(q, `select public.apply_deposit($1, $2)`, [ID.depGeorge, other])).error).toMatch(/different patient/);
    });
  });
  it("nurses and doctors cannot record deposits", async () => {
    for (const u of ["nurseA", "doctorA"] as const) {
      expect(await failure(as(u, (q) => q(`select public.record_deposit($1, null, 100, 'cash', 'X')`, [ID.george]))), u).toMatch(/permission/);
    }
  });
});

describe("refunds", () => {
  it("need a reason, cannot exceed what was collected, and need a second person to approve", async () => {
    await as("deskA", async (q) => {
      const inv = await issuedInvoice(q, 10000);
      await q(`insert into public.payments (clinic_id, invoice_id, amount_minor, method) values ($1, $2, 10000, 'cash')`, [A, inv]);
      expect((await attempt(q, `select public.request_refund($1, null, 500, 'no')`, [inv])).error).toMatch(/reason/);
      expect((await attempt(q, `select public.request_refund($1, null, 10001, 'Overcharged')`, [inv])).error).toMatch(/more than can be refunded/);
      const { id } = (await q<{ id: string }>(`select public.request_refund($1, null, 4000, 'Overcharged by error') as id`, [inv]))[0]!;
      // pending requests count against what is available
      expect((await attempt(q, `select public.request_refund($1, null, 6001, 'Second request')`, [inv])).ok).toBe(false);
      expect((await attempt(q, `select public.decide_refund($1, true)`, [id])).error).toMatch(/permission/); // reception cannot approve
    });
  });
  it("admin approves a request raised by someone else; requester cannot approve their own", async () => {
    // Cross-user flow in one transaction by switching identity.
    const c = await pool.connect();
    const as2 = async (uid: string) => {
      await c.query("reset role"); await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
    };
    try {
      await c.query("begin");
      await as2(U.deskA);
      const inv = (await c.query(`insert into public.invoices (clinic_id, patient_id) values ($1, $2) returning id`, [A, ID.george])).rows[0].id;
      await c.query(`insert into public.invoice_lines (clinic_id, invoice_id, description, quantity, unit_price_minor) values ($1, $2, 'T', 1, 9000)`, [A, inv]);
      await c.query(`update public.invoices set state = 'issued' where id = $1`, [inv]);
      await c.query(`insert into public.payments (clinic_id, invoice_id, amount_minor, method) values ($1, $2, 9000, 'cash')`, [A, inv]);
      const rid = (await c.query(`select public.request_refund($1, null, 3000, 'Service not delivered') as id`, [inv])).rows[0].id;
      await as2(U.adminA);
      // admin requesting and approving own refund is refused
      const own = (await c.query(`select public.request_refund($1, null, 1000, 'Admin raised refund') as id`, [inv])).rows[0].id;
      await c.query("savepoint s");
      await expect(c.query(`select public.decide_refund($1, true)`, [own])).rejects.toThrow(/someone other than/);
      await c.query("rollback to savepoint s");
      await c.query("savepoint s1");
      await expect(c.query(`select public.decide_refund($1, false, 'Not justified by records')`, [own])).rejects.toThrow(/someone other than/);
      await c.query("rollback to savepoint s1");
      await c.query(`select public.decide_refund($1, true)`, [rid]);
      const net = (await c.query(`select app.invoice_net_collected($1) as n`, [inv])).rows[0].n;
      expect(Number(net)).toBe(6000);
      await c.query("savepoint s2");
      await expect(c.query(`select public.decide_refund($1, true)`, [rid])).rejects.toThrow(/already been decided/);
      await c.query("rollback to savepoint s2");
      await c.query("savepoint s3");
      await expect(c.query(`select public.request_refund($1, null, 6001, 'Too much now')`, [inv])).rejects.toThrow(/more than can be refunded/);
      await c.query("rollback to savepoint s3");
    } finally { await c.query("rollback").catch(() => undefined); c.release(); }
  });
  it("deposit refunds reduce the held balance and rejection needs a reason", async () => {
    const c = await pool.connect();
    const as2 = async (uid: string) => {
      await c.query("reset role"); await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
    };
    try {
      await c.query("begin");
      await as2(U.deskA);
      const rid = (await c.query(`select public.request_refund(null, $1, 20000, 'Admission cancelled') as id`, [ID.depGeorge])).rows[0].id;
      await as2(U.adminA);
      await c.query("savepoint s");
      await expect(c.query(`select public.decide_refund($1, false, 'no')`, [rid])).rejects.toThrow(/reason for rejecting/);
      await c.query("rollback to savepoint s");
      await c.query(`select public.decide_refund($1, true)`, [rid]);
      const d = (await c.query(`select refunded_minor from public.deposits where id = $1`, [ID.depGeorge])).rows[0];
      expect(Number(d.refunded_minor)).toBe(20000);
    } finally { await c.query("rollback").catch(() => undefined); c.release(); }
  });
  it("another clinic cannot touch our invoices or deposits", async () => {
    await as("adminB", async (q) => {
      expect((await attempt(q, `select public.request_refund(null, $1, 100, 'Not mine really')`, [ID.depGeorge])).error).toMatch(/not found/i);
      expect((await attempt(q, `select public.apply_deposit($1, $1)`, [ID.depGeorge])).error).toMatch(/not found/i);
    });
  });
});
