// Platform staff (2FA enforced), customer portal isolation, invitation outcomes.
import { chromium } from "playwright";
import { Client } from "pg";
import { createHash, randomBytes, scryptSync } from "node:crypto";
import { newSecret, totpAt } from "../lib/auth/totp";
const BASE = process.env.APP_URL ?? "http://localhost:3100";
const db = new Client({ connectionString: process.env.DATABASE_OWNER_URL }); await db.connect(); await db.query("select set_config('app.system','on',false)");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const hashPw = (pw: string) => { const salt = randomBytes(16); return `scrypt$16384$8$1$${salt.toString("base64")}$${scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("base64")}`; };
const fails: string[] = []; const ok = (c: boolean, m: string) => { console.log(c ? "PASS" : "FAIL", m); if (!c) fails.push(m); };
const PW = "Staff#Pass12345", stamp = Date.now();
// platform owner
const secret = newSecret(); const pe = `plat${stamp}@ops.test`;
await db.query("insert into users(email,name,password_hash,email_verified_at,platform_role,totp_secret,totp_enabled) values ($1,'Plat Owner',$2,now(),'owner',$3,true)", [pe, hashPw(PW), secret]);
// customer portal user via invitation
const tenant = (await db.query("select id from tenants where slug='demo-traders'")).rows[0].id; await db.query("select set_config('app.tenant_id',$1,false)", [tenant]);
const cust = (await db.query("select id from customers where code='ACME' and tenant_id=$1", [tenant])).rows[0].id; const other = (await db.query("select id from customers where code='BETA' and tenant_id=$1", [tenant])).rows[0].id;
const role = (await db.query("select id from roles where tenant_id=$1 and key='customer'", [tenant])).rows[0].id;
const mkInv = async (email: string, status = "pending", exp = "7 days") => { const t = randomBytes(16).toString("hex"); await db.query("insert into invitations(tenant_id,email,role_id,customer_id,token_hash,status,expires_at) values ($1,$2,$3,$4,$5,$6, now() + $7::interval)", [tenant, email, role, cust, sha(t), status, exp]); return t; };
const ce = `portal${stamp}@acme.test`, tok = await mkInv(ce), revoked = await mkInv(`r${stamp}@x.test`, "revoked"), expired = await mkInv(`e${stamp}@x.test`, "pending", "-1 day");
// an order for each customer so isolation is observable
const soid = async (c: string, n: string) => { const wh = (await db.query("select id,branch_id from warehouses where tenant_id=$1", [tenant])).rows[0]; await db.query("insert into sales_orders(tenant_id,number,customer_id,branch_id,warehouse_id,status,total_paise) values ($1,$2,$3,$4,$5,'confirmed',1000) on conflict do nothing", [tenant, n, c, wh.branch_id, wh.id]); };
await soid(cust, `PORTAL-A-${stamp}`); await soid(other, `PORTAL-B-${stamp}`);
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await (await b.newContext()).newPage();
// invitation outcomes
await page.goto(`${BASE}/invite/${revoked}`); ok(await page.getByText(/withdrawn/).isVisible(), "revoked invitation explains it was withdrawn");
await page.goto(`${BASE}/invite/${expired}`); ok(await page.getByText(/expired/i).first().isVisible(), "expired invitation explains expiry");
await page.goto(`${BASE}/invite/not-a-real-token`); ok(await page.getByText(/not valid/).isVisible(), "unknown invitation token is rejected");
// accept as portal customer
await page.goto(`${BASE}/invite/${tok}`); await page.fill("[name=name]", "Acme Buyer"); await page.fill("[name=password]", PW); await page.click("button[type=submit]");
await page.getByRole("link", { name: "Continue" }).click(); await page.waitForURL(/workspaces|portal|app/); if (page.url().includes("workspaces")) await page.locator("button.card").first().click(); await page.waitForURL(/portal/);
ok(await page.getByText(`PORTAL-A-${stamp}`).isVisible(), "portal customer sees their own order");
ok(!(await page.getByText(`PORTAL-B-${stamp}`).count()), "portal customer does NOT see another customer's order");
await page.goto(`${BASE}/app/finance/invoices`); await page.waitForURL(/portal/); ok(true, "portal customer is kept out of /app");
const exp = await page.request.get(`${BASE}/app/export/customers`); ok(exp.status() === 403, "portal customer cannot export (403)");
await page.goto(`${BASE}/invite/${tok}`); ok(await page.getByText(/Invitation accepted/).isVisible(), "invitation cannot be reused");
// platform owner with mandatory 2FA
const p2 = await (await b.newContext()).newPage();
await p2.goto(`${BASE}/login`); await p2.fill("[name=email]", pe); await p2.fill("[name=password]", PW); await p2.click("button[type=submit]"); await p2.waitForURL(/login\/2fa/);
await p2.goto(`${BASE}/platform`); await p2.waitForURL(/login\/2fa/); ok(true, "platform console is blocked until the 2FA code is entered");
await p2.fill("[name=code]", "000000"); await p2.click("button[type=submit]"); ok(await p2.locator("[role=alert]").filter({ hasText: /not valid/ }).first().waitFor({ timeout: 8000 }).then(() => true, () => false), "wrong 2FA code rejected");
await p2.fill("[name=code]", totpAt(secret, Date.now())); await p2.click("button[type=submit]"); await p2.waitForURL(/workspaces/);
const errs: string[] = []; p2.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
for (const path of ["/platform", "/platform/businesses", "/platform/plans", "/platform/payments", "/platform/jobs", "/platform/requests", "/platform/coupons", "/platform/announcements", "/platform/staff", "/platform/audit"]) { const r = await p2.goto(BASE + path, { waitUntil: "networkidle" }); const body = await p2.locator("body").innerText(); ok((r?.status() ?? 0) < 400 && !/Something went wrong/.test(body), `platform ${path} loads`); }
const demoId = (await db.query("select id from tenants where slug='demo-traders'")).rows[0].id; await p2.goto(`${BASE}/platform/businesses/${demoId}`); const txt = await p2.locator("body").innerText();
ok(txt.includes("Demo Traders") && !txt.includes("Acme Stationers"), "platform sees company metadata but no customer records");
// ordinary tenant user cannot reach /platform
const p3 = await (await b.newContext()).newPage(); await p3.goto(`${BASE}/login`); await p3.fill("[name=email]", "owner@demo.test"); await p3.fill("[name=password]", "DemoPass#2026"); await p3.click("button[type=submit]"); await p3.waitForURL(/workspaces|app/);
await p3.goto(`${BASE}/platform`); await p3.waitForURL(/denied/); ok(true, "company owner is denied /platform");
ok(errs.length === 0, "no console errors on platform pages" + (errs.length ? ": " + errs[0] : ""));
console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL PASSED"); await b.close(); await db.end(); process.exit(fails.length ? 1 : 0);
