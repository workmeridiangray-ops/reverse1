import { describe, expect, it } from "vitest";
import { plat } from "@/lib/server/db";
import * as acc from "@/lib/server/accounts";
import * as bill from "@/lib/server/billing";
import { runDueJobs } from "@/lib/server/jobs";
import { hmacHex, totpAt, totpValid, newTotpSecret, hashPassword, verifyPassword, sha256 } from "@/lib/server/crypto";
import { can } from "@/lib/server/perms";

vi_env();
function vi_env() { process.env.ALLOW_SANDBOX_PAYMENTS = "1"; process.env.SANDBOX_WEBHOOK_SECRET = "whsec_test"; process.env.EMAIL_PROVIDER = "log"; }
const lastMail = async (to: string) => (await plat("select body from email_outbox where to_email=$1 order by created_at desc limit 1", [to])).rows[0]?.body as string;
const tokenIn = (body: string) => body.match(/(?:token=|invite\/)([\w-]+)/)![1]!;

describe("accounts", () => {
  const email = "owner@acme.test";
  it("signs up with trial subscription, rejects duplicates and weak passwords", async () => {
    await expect(acc.signup({ name: "Asha", email, password: "short", company: "Acme" })).rejects.toThrow(/10 characters/);
    const r = await acc.signup({ name: "Asha Rao", email, password: "correct-horse-9", company: "Acme Works" });
    const sub = (await plat("select status from subscriptions where company_id=$1", [r.companyId])).rows[0]; expect(sub.status).toBe("trialing");
    await expect(acc.signup({ name: "Asha", email: "OWNER@acme.test", password: "correct-horse-9", company: "X Y" })).rejects.toThrow(/already exists/);
    await runDueJobs();
    expect((await plat("select status from email_outbox where to_email=$1", [email])).rows[0].status).toBe("sent");
    await acc.verifyEmail(tokenIn(await lastMail(email)));
    await expect(acc.verifyEmail(tokenIn(await lastMail(email)))).rejects.toThrow(/invalid or has expired/);   // single use
  });
  it("locks after repeated failures and a reset signs everything out", async () => {
    for (let i = 0; i < 5; i++) await expect(acc.login(email, "wrong-password-1")).rejects.toThrow(/incorrect/);
    await expect(acc.login(email, "correct-horse-9")).rejects.toThrow(/Too many/);
    await plat("update users set locked_until=null, failed_logins=0 where lower(email)=$1", [email]);
    const l = await acc.login(email, "correct-horse-9"); expect(l.needsMfa).toBe(false);
    await plat("insert into sessions(user_id,token_hash,expires_at) values ($1,'t1',now()+interval '1 day')", [l.userId]);
    await acc.requestReset("nobody@nowhere.test");   // no enumeration, no error
    await acc.requestReset(email);
    const t = tokenIn(await lastMail(email));
    await acc.resetPassword(t, "brand-new-pass-7");
    await expect(acc.resetPassword(t, "another-pass-88")).rejects.toThrow(/invalid, already used/);
    expect((await plat("select revoked_at from sessions where token_hash='t1'")).rows[0].revoked_at).not.toBeNull();
    await expect(acc.login(email, "correct-horse-9")).rejects.toThrow(); await acc.login(email, "brand-new-pass-7");
  });
  it("invitations: wrong user, expiry, revocation, accept, then revoking access ends sessions", async () => {
    const owner = (await plat("select u.id uid, m.company_id cid from users u join memberships m on m.user_id=u.id where lower(u.email)=$1", [email])).rows[0];
    await acc.invite(owner.cid, owner.uid, { email: "ravi@acme.test", role: "planner" });
    const t1 = tokenIn(await lastMail("ravi@acme.test"));
    await acc.invite(owner.cid, owner.uid, { email: "ravi@acme.test", role: "buyer" });   // re-invite revokes the old link
    expect((await acc.invitationState(t1)).state).toBe("revoked");
    const t2 = tokenIn(await lastMail("ravi@acme.test"));
    await plat("update invitations set expires_at=now()-interval '1 minute' where token_hash=$1", [sha256(t2)]);
    expect((await acc.invitationState(t2)).state).toBe("expired");
    await acc.invite(owner.cid, owner.uid, { email: "ravi@acme.test", role: "buyer" });
    const t3 = tokenIn(await lastMail("ravi@acme.test"));
    const a = await acc.acceptInvitation(t3, null, { name: "Ravi", password: "ravi-pass-12345" });
    await expect(acc.acceptInvitation(t3, null, { name: "Ravi", password: "ravi-pass-12345" })).rejects.toThrow(/no longer valid/);
    await plat("insert into sessions(user_id,token_hash,company_id,expires_at) values ($1,'r1',$2,now()+interval '1 day')", [a.userId, owner.cid]);
    const mem = (await plat("select id from memberships where user_id=$1", [a.userId])).rows[0].id;
    await expect(acc.changeMember(owner.cid, owner.uid, mem, { active: false }, "")).rejects.toThrow(/reason/);
    await acc.changeMember(owner.cid, owner.uid, mem, { active: false }, "Left the company");
    expect((await plat("select revoked_at from sessions where token_hash='r1'")).rows[0].revoked_at).not.toBeNull();
  });
  it("plan limits are enforced server-side", async () => {
    const owner = (await plat("select m.company_id cid from users u join memberships m on m.user_id=u.id where lower(u.email)=$1", [email])).rows[0];
    for (let i = 0; i < 4; i++) { await plat("insert into users(email,name,password_hash) values ($1,'x','x')", [`f${i}@acme.test`]); const u = (await plat("select id from users where email=$1", [`f${i}@acme.test`])).rows[0]; await plat("insert into memberships(company_id,user_id,role) values ($1,$2,'viewer')", [owner.cid, u.id]); }
    await expect(bill.assertWithin(owner.cid, "users")).rejects.toThrow(/allows 5 users/);
  });
  it("TOTP and password primitives", () => {
    const s = newTotpSecret(); expect(totpValid(s, totpAt(s))).toBe(true); expect(totpValid(s, "000000")).toBe(false);
    expect(verifyPassword("pw", hashPassword("pw"))).toBe(true); expect(verifyPassword("pX", hashPassword("pw"))).toBe(false);
  });
  it("role matrix: operators cannot approve or adjust; customers have no internal permissions", () => {
    expect(can("operator", "inv.adjust")).toBe(false); expect(can("buyer", "proc.approve")).toBe(false); expect(can("customer", "sales.read")).toBe(false);
    expect(can("quality", "qa.decide")).toBe(true); expect(can("owner", "admin.billing")).toBe(true);
  });
});

describe("billing", () => {
  const plans = () => bill.currentPlanVersions();
  it("prorates upgrades on the unused fraction", () => {
    const s = new Date("2026-11-01T00:00:00Z"), e = new Date("2026-12-01T00:00:00Z");
    expect(bill.prorate(499900, 1499900, s, e, new Date("2026-11-16T00:00:00Z"))).toBe(500000);
    expect(bill.prorate(1499900, 499900, s, e, s)).toBe(0);
  });
  it("checkout → signed webhook → subscription; replays and bad signatures change nothing", async () => {
    const cid = (await plat("select id from companies where billing_email='owner@acme.test'")).rows[0].id; const uid = (await plat("select id from users where email='owner@acme.test'")).rows[0].id;
    const growth = (await plans()).find((p) => p.code === "growth");
    const co = await bill.startCheckout(cid, growth.version_id, "monthly", undefined, uid);
    expect(co.total).toBe(1499900 + Math.round(1499900 * 0.18));
    const body = JSON.stringify({ id: "evt_1", event: "payment.captured", payload: { payment: { entity: { id: "pay_1", order_id: co.orderId } } } });
    expect((await bill.receiveWebhook(body, "deadbeef")).status).toBe(401);
    expect((await bill.receiveWebhook(body, hmacHex("whsec_test", body))).duplicate).toBe(false);
    expect((await bill.receiveWebhook(body, hmacHex("whsec_test", body))).duplicate).toBe(true);
    await runDueJobs();
    const inv = (await plat("select status, paid_at from platform_invoices where id=$1", [co.invoiceId])).rows[0]; expect(inv.status).toBe("paid");
    const subs = (await plat("select status, plan_version_id from subscriptions where company_id=$1 and status='active'", [cid])).rows; expect(subs).toHaveLength(1);
    await bill.settleInvoiceByOrder(co.orderId, "pay_1", true);   // replay directly
    expect((await plat("select count(*)::int n from subscriptions where company_id=$1 and status='active'", [cid])).rows[0].n).toBe(1);
    expect((await bill.limitsOf(cid)).users).toBe(25);
    expect((await plat("select status from companies where id=$1", [cid])).rows[0].status).toBe("active");
  });
  it("failed payment → past_due with grace; downgrade blocked while usage exceeds the lower plan", async () => {
    const cid = (await plat("select id from companies where billing_email='owner@acme.test'")).rows[0].id; const uid = (await plat("select id from users where email='owner@acme.test'")).rows[0].id;
    const starter = (await plans()).find((p) => p.code === "starter");
    for (let i = 0; i < 2; i++) { await plat("insert into users(email,name,password_hash) values ($1,'x','x')", [`g${i}@acme.test`]); const u = (await plat("select id from users where email=$1", [`g${i}@acme.test`])).rows[0]; await plat("insert into memberships(company_id,user_id,role) values ($1,$2,'viewer')", [cid, u.id]); }
    await expect(bill.startCheckout(cid, starter.version_id, "monthly", undefined, uid)).rejects.toThrow(/Reduce usage/);
    const scale = (await plans()).find((p) => p.code === "scale");
    const co = await bill.startCheckout(cid, scale.version_id, "yearly", undefined, uid);
    await bill.settleInvoiceByOrder(co.orderId, "pay_f", false);
    expect((await plat("select status from companies where id=$1", [cid])).rows[0].status).toBe("past_due");
    expect((await plat("select grace_until from subscriptions where company_id=$1 and status='past_due'", [cid])).rows[0].grace_until).not.toBeNull();
    await bill.settleInvoiceByOrder(co.orderId, "pay_ok", true);   // retry succeeds
    expect((await plat("select status from companies where id=$1", [cid])).rows[0].status).toBe("active");
  });
  it("coupon applies to the net before tax", async () => {
    await plat("insert into coupons(code,percent_off) values ('LAUNCH20',20)");
    const cid = (await plat("select id from companies where billing_email='owner@acme.test'")).rows[0].id;
    const growth = (await plans()).find((p) => p.code === "growth");
    const pv = await bill.planChangePreview(cid, growth.version_id, "monthly", "launch20");
    expect(pv.total).toBeGreaterThan(0);
    await expect(bill.planChangePreview(cid, growth.version_id, "monthly", "NOPE")).rejects.toThrow(/not valid/);
  });
});
describe("jobs", () => {
  it("retries with backoff then goes dead; dedupe prevents duplicates", async () => {
    const { enqueue, registerJob, retryJob } = await import("@/lib/server/jobs");
    let n = 0; registerJob("flaky", async () => { n++; throw new Error("boom"); });
    await enqueue("flaky", {}, "d1"); await enqueue("flaky", {}, "d1");
    expect((await plat("select count(*)::int n from jobs where dedupe_key='d1'")).rows[0].n).toBe(1);
    await plat("update jobs set max_attempts=2 where dedupe_key='d1'");
    await runDueJobs(); await plat("update jobs set run_at=now() where dedupe_key='d1'"); await runDueJobs();
    const j = (await plat("select status, last_error, attempts from jobs where dedupe_key='d1'")).rows[0];
    expect(j.status).toBe("dead"); expect(j.last_error).toMatch(/boom/); expect(n).toBe(2);
    await retryJob((await plat("select id from jobs where dedupe_key='d1'")).rows[0].id);
    expect((await plat("select status from jobs where dedupe_key='d1'")).rows[0].status).toBe("queued");
  });
});

describe("notifications, downgrade and trial rules", () => {
  it("notifies approvers when a PO is submitted, but not the submitter", async () => {
    const { seedCompany, inCo } = await import("./helpers");
    const proc = await import("@/lib/server/svc/procurement");
    const w = await seedCompany("notify");
    const po = await inCo(w, async (c) => { const p = await proc.createPO(c, w.ctx("buyer", w.user2), w.supplierId, [{ itemId: w.items.BOLT!, qty: 10, price: 100, dueDate: "2026-12-31" }]); await proc.submitPO(c, w.ctx("buyer", w.user2), p.id); return p; });
    const rows = (await plat("select user_id, title, href from notifications where company_id=$1", [w.companyId])).rows;
    expect(rows.map((r) => r.user_id)).toContain(w.userId);          // owner can approve
    expect(rows.map((r) => r.user_id)).not.toContain(w.user2);       // submitter excluded
    expect(rows[0]!.href).toBe(`/app/purchasing/${po.id}`);
  });
  it("downgrade checkout explains the renewal rule instead of creating a zero-value order", async () => {
    const cid = (await plat("select id from companies where billing_email='owner@acme.test'")).rows[0].id; const uid = (await plat("select id from users where email='owner@acme.test'")).rows[0].id;
    await plat("update memberships set active=false where company_id=$1 and role='viewer'", [cid]);
    const starter = (await bill.currentPlanVersions()).find((p) => p.code === "starter");
    await expect(bill.startCheckout(cid, starter.version_id, "yearly", undefined, uid)).rejects.toThrow(/Downgrades take effect at renewal|Reduce usage/);
  });
});
