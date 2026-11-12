import { describe, it, expect, afterAll } from "vitest";
import { makeCompany } from "./helpers";
import { withSystem, pool } from "@/lib/db";
import { planChangeInvoice, applyPaymentEvent, subscriptionOf, assertEntitled, usage, billingSweep } from "@/lib/billing";
import { verifyWebhook, signTestPayload } from "@/lib/billing/provider";
afterAll(() => pool.end());

describe("subscription billing", () => {
  it("pays a plan, activates it, ignores duplicate events, and handles failure with grace", async () => {
    const co = await makeCompany("Bill Co");
    const r = await withSystem((db) => planChangeInvoice(db, co.tenantId, "growth", "monthly"));
    if (r.scheduled) throw new Error("expected invoice");
    expect(r.invoice.total_paise).toBe(Math.round(599900 * 1.18));
    const ev = { id: "e1", type: "payment.succeeded" as const, invoiceId: r.invoice.id, paymentId: "pay_1", amount: r.invoice.total_paise, raw: {} };
    expect(await withSystem((db) => applyPaymentEvent(db, "test", ev))).toBe("applied");
    expect(await withSystem((db) => applyPaymentEvent(db, "test", { ...ev, id: "e2" }))).toBe("duplicate");
    const sub = await withSystem((db) => subscriptionOf(db, co.tenantId));
    expect(sub.status).toBe("active"); expect(sub.plan_key).toBe("growth");
    // wrong amount is rejected
    const r2 = await withSystem((db) => planChangeInvoice(db, co.tenantId, "scale", "monthly"));
    if (r2.scheduled) throw new Error("expected prorated invoice");
    expect(r2.invoice.purpose).toBe("upgrade");
    expect(r2.invoice.total_paise).toBeLessThan(Math.round((1499900 - 599900) * 1.18) + 2);
    await expect(withSystem((db) => applyPaymentEvent(db, "test", { id: "e3", type: "payment.succeeded", invoiceId: r2.invoice.id, paymentId: "pay_2", amount: 1, raw: {} }))).rejects.toThrow(/does not match/);
    // downgrade schedules for period end (nothing to pay)
    const dg = await withSystem((db) => planChangeInvoice(db, co.tenantId, "starter", "monthly"));
    expect(dg.scheduled).toBe(true);
    // failed renewal puts account in grace
    await withSystem((db) => db.query("update subscriptions set current_period_end = now() + interval '1 day' where tenant_id=$1 and status='active'", [co.tenantId]));
    await billingSweep();
    const ren = (await withSystem((db) => db.query("select * from platform_invoices where tenant_id=$1 and purpose='renewal'", [co.tenantId]))).rows[0];
    expect(ren).toBeTruthy(); expect(ren.description).toMatch(/Starter/);   // pending downgrade applied to renewal
    await withSystem((db) => applyPaymentEvent(db, "test", { id: "e4", type: "payment.failed", invoiceId: ren.id, paymentId: "pay_3", reason: "declined", raw: {} }));
    const s2 = await withSystem((db) => subscriptionOf(db, co.tenantId));
    expect(s2.status).toBe("past_due"); expect(new Date(s2.grace_until).getTime()).toBeGreaterThan(Date.now());
  });
  it("blocks downgrades that do not fit and enforces user limits", async () => {
    const co = await makeCompany("Limit Co");
    await withSystem(async (db) => { for (let i = 0; i < 6; i++) { const u = (await db.query("insert into users(email,name,password_hash) values ($1,'u','x') returning id", [`l${i}${Date.now()}@t.example`])).rows[0].id; const role = (await db.query("select id from roles where tenant_id=$1 and key='staff'", [co.tenantId])).rows[0].id; await db.query("insert into memberships(tenant_id,user_id,role_id) values ($1,$2,$3)", [co.tenantId, u, role]); } });
    expect((await withSystem((db) => usage(db, co.tenantId))).users).toBe(7);
    await expect(withSystem((db) => planChangeInvoice(db, co.tenantId, "starter", "monthly"))).rejects.toThrow(/over the 5-user limit/);
    await withSystem(async (db) => { await db.query("update subscriptions set plan_version_id=(select pv.id from plan_versions pv join plans p on p.id=pv.plan_id where p.key='starter') where tenant_id=$1", [co.tenantId]); });
    await expect(withSystem((db) => assertEntitled(db, co.tenantId, "users"))).rejects.toThrow(/allows 5 users/);
  });
  it("verifies webhook signatures", () => {
    const body = JSON.stringify({ a: 1 });
    expect(verifyWebhook(body, signTestPayload(body))).toBe(true);
    expect(verifyWebhook(body + " ", signTestPayload(body))).toBe(false);
    expect(verifyWebhook(body, null)).toBe(false);
  });
});
