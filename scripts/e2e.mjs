// Browser acceptance test against a running instance (APP_URL) and its database (DATABASE_URL, owner role for token lookup).
import { chromium } from "playwright";
import pg from "pg";
const base = process.env.APP_URL || "http://localhost:3000";
const db = new pg.Client({ connectionString: process.env.MIGRATE_DATABASE_URL }); await db.connect();
const results = []; let failed = 0;
const ok = (name, cond, extra = "") => { results.push([cond ? "PASS" : "FAIL", name, extra]); if (!cond) failed++; console.log(cond ? "PASS" : "FAIL", name, cond ? "" : extra); };
const stamp = Date.now().toString(36);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
async function newCtx(opts = {}) { const ctx = await browser.newContext(opts); ctx.on("page", (p) => { p.on("pageerror", (e) => errors.push(p.url() + " :: " + String(e).slice(0, 160))); p.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errors.push(p.url() + " :: " + m.text().slice(0, 160)); }); }); return ctx; }
const mailTo = async (email, re) => (await db.query("select body from email_outbox where to_email=$1 order by created_at desc limit 1", [email])).rows[0]?.body.match(re)?.[1];
async function signup(page, name, email, company) {
  await page.goto(base + "/signup"); await page.fill('[name=name]', name); await page.fill('[name=email]', email); await page.fill('[name=company]', company); await page.fill('[name=password]', "e2e-password-1"); await page.check('[name=terms]');
  await page.click('button:has-text("Create workspace")'); await page.waitForURL("**/app/onboarding");
}
const A = await newCtx(); const pa = await A.newPage();
// ---- public site ----
for (const p of ["/", "/product", "/solutions", "/pricing", "/addons", "/demo", "/contact", "/help", "/updates", "/legal/terms", "/legal/privacy", "/legal/refunds", "/legal/security", "/login", "/signup", "/forgot"]) { const r = await pa.goto(base + p); ok(`public ${p}`, r.status() === 200); }
await pa.goto(base + "/contact"); await pa.fill('[name=name]', "Tester"); await pa.fill('[name=email]', `lead${stamp}@x.test`); await pa.fill('[name=message]', "Please call me about pricing."); await pa.click('button:has-text("Send message")');
ok("contact form success message", await pa.locator("text=Message sent").waitFor({ timeout: 5000 }).then(() => true, () => false));
await pa.goto(base + "/contact"); await pa.fill('[name=name]', "T"); await pa.fill('[name=message]', "A long enough message."); await pa.fill('[name=email]', "a@b"); await pa.click('button:has-text("Send message")');
ok("contact form validation error", await pa.locator("text=valid email").first().waitFor({ timeout: 5000 }).then(() => true, () => false));
// ---- signup, verify, sample data ----
const emailA = `owner${stamp}@acme.test`;
await signup(pa, "Asha Rao", emailA, "Acme Pumps " + stamp);
ok("signup lands on onboarding checklist", await pa.locator("h1:has-text('Welcome checklist')").waitFor({ timeout: 6000 }).then(() => true, () => false));
const tok = await mailTo(emailA, /token=([\w-]+)/); await pa.goto(base + "/verify?token=" + tok); ok("email verification", await pa.locator("text=Email verified").waitFor({ timeout: 6000 }).then(() => true, () => false));
await pa.goto(base + "/app/onboarding"); pa.once("dialog", (d) => d.accept()); await pa.click('button:has-text("Load sample data")');
ok("sample data loaded + demo flagged", await pa.locator("text=Sample data loaded. It is demo data").waitFor({ timeout: 8000 }).then(() => true, () => false));
// ---- every owner page renders ----
const ownerPages = ["/app", "/app/onboarding", "/app/items", "/app/partners", "/app/setup", "/app/boms", "/app/changes", "/app/sales", "/app/sales/new", "/app/forecasts", "/app/planning", "/app/schedule", "/app/purchasing", "/app/purchasing/new", "/app/subcontract", "/app/inventory", "/app/trace", "/app/production", "/app/shopfloor", "/app/maintenance", "/app/quality", "/app/shipping", "/app/costing", "/app/reports", "/app/settings", "/app/settings/billing", "/app/audit", "/app/support", "/app/profile", "/app/notifications", "/app/search?q=pump", "/app/purchasing/requests", "/app/quality/plans", "/app/inventory/counts", "/app/labels", "/app/labels?type=batches", "/workspaces"];
for (const p of ownerPages) { const r = await pa.goto(base + p); const bad = await pa.locator("text=Something went wrong").count(); ok(`owner page ${p}`, r.status() === 200 && !bad, `status ${r.status()}`); }
// ---- journey: order -> confirm -> MRP -> release ----
await pa.goto(base + "/app/sales/new");
const custVal = await pa.locator('[name=customer] option').nth(1).getAttribute("value"); await pa.selectOption('[name=customer]', custVal);
await pa.selectOption('[name=item1]', { label: "SAMPLE-PUMP — Sample pump" }); await pa.fill('[name=qty1]', "5"); const due = new Date(Date.now() + 25 * 864e5).toISOString().slice(0, 10); await pa.fill('[name=due1]', due);
await pa.click('button:has-text("Save draft order")'); await pa.waitForURL(/\/app\/sales\/[0-9a-f-]{36}/); ok("order created as draft", await pa.locator("text=draft").first().waitFor({ timeout: 6000 }).then(() => true, () => false));
await pa.click('button:has-text("Confirm order")'); ok("order confirmed with honest promise-date note", await pa.locator("text=Promise dates are planning estimates").waitFor({ timeout: 8000 }).then(() => true, () => false));
await pa.goto(base + "/app/planning"); await pa.click('button:has-text("Run MRP")'); await pa.waitForURL(/\/app\/planning\/[0-9a-f-]{36}/);
ok("MRP suggests production of pump with reasons", await pa.locator("text=Why:").first().waitFor({ timeout: 6000 }).then(() => true, () => false) && await pa.locator("text=SO-").first().waitFor({ timeout: 6000 }).then(() => true, () => false));
const sup = await pa.locator('[name=supplier]').first().locator("option").nth(1).getAttribute("value").catch(() => null);
if (sup) { await pa.locator('form:has(button:has-text("Release as draft PO"))').first().locator('[name=supplier]').selectOption(sup); await pa.locator('button:has-text("Release as draft PO")').first().click(); ok("suggestion released to draft PO deliberately", await pa.locator("text=Released as PO-").first().waitFor({ timeout: 8000 }).then(() => true, () => false)); }
// ---- stale-demand guard visible to user: add demand then try release ----
// ---- second user (viewer) via invitation: least privilege ----
const viewer = `viewer${stamp}@acme.test`;
await pa.goto(base + "/app/settings"); await pa.fill('input[name=email]', viewer); await pa.locator('form:has(button:has-text("Send invitation")) [name=role]').selectOption("viewer"); await pa.click('button:has-text("Send invitation")');
ok("invitation sent", await pa.locator("text=Invitation sent").waitFor({ timeout: 8000 }).then(() => true, () => false));
const invTok = await mailTo(viewer, /invite\/([\w-]+)/);
const V = await newCtx(); const pv = await V.newPage(); await pv.goto(base + "/invite/" + invTok); await pv.fill('[name=name]', "Vik Viewer"); await pv.fill('[name=password]', "viewer-pass-123"); await pv.click('button:has-text("Create account")'); await pv.waitForURL("**/app");
ok("invited viewer joins", await pv.locator("h1:has-text('Welcome, Vik')").waitFor({ timeout: 6000 }).then(() => true, () => false));
await pv.goto(base + "/app/settings"); ok("viewer denied settings (server-side)", pv.url().includes("/denied"));
await pv.goto(base + "/app/inventory"); ok("viewer can read stock", await pv.locator("h1:has-text('Stock')").waitFor({ timeout: 6000 }).then(() => true, () => false));
ok("viewer sees no post-stock forms", (await pv.locator('button:has-text("Transfer")').count()) === 0);
await pv.goto(base + "/api/export/job-costs"); ok("viewer export blocked", (await pv.locator("body").innerText()).includes("Not allowed"));
// reuse of invitation link
const P2 = await (await newCtx()).newPage(); await P2.goto(base + "/invite/" + invTok); ok("used invitation shows clear outcome", await P2.locator("text=already been accepted").waitFor({ timeout: 6000 }).then(() => true, () => false));
// ---- customer portal ----
const cust = `cust${stamp}@buyer.test`;
await pa.goto(base + "/app/settings"); await pa.fill('input[name=email]', cust); await pa.locator('form:has(button:has-text("Send invitation")) [name=role]').selectOption("customer");
await pa.locator('form:has(button:has-text("Send invitation")) [name=party]').selectOption({ index: 1 }); await pa.click('button:has-text("Send invitation")'); await pa.waitForTimeout(1000);
const cTok = await mailTo(cust, /invite\/([\w-]+)/); const C = await newCtx(); const pc = await C.newPage(); await pc.goto(base + "/invite/" + cTok); await pc.fill('[name=name]', "Cust User"); await pc.fill('[name=password]', "cust-pass-12345"); await pc.click('button:has-text("Create account")'); await pc.waitForURL("**/portal");
ok("customer lands in portal", await pc.locator("h1:has-text('Your orders')").waitFor({ timeout: 6000 }).then(() => true, () => false));
await pc.goto(base + "/app/items"); ok("customer cannot open internal screens", !pc.url().endsWith("/app/items"));
await pa.goto(base + "/app/search?q=SAMPLE-PUMP"); ok("exact code (scanner) opens the item", /\/app\/items\//.test(pa.url()));
for (const k of ["items", "movements", "sales-orders", "purchase-orders", "work-orders", "job-costs", "audit", "stock"]) { const r = await pa.request.get(base + "/api/export/" + k); ok(`export ${k} csv`, r.status() === 200 && (r.headers()["content-type"] || "").includes("text/csv")); }
await pa.goto(base + "/app/settings"); ok("export & closure panel shown to owner", await pa.locator("text=Export & closure").waitFor({ timeout: 5000 }).then(() => true, () => false));
// ---- cross-company isolation ----
const itemId = (await db.query("select i.id from items i join companies c on c.id=i.company_id where c.name=$1 limit 1", ["Acme Pumps " + stamp])).rows[0].id;
const B = await newCtx(); const pb = await B.newPage(); await signup(pb, "Bob B", `bob${stamp}@other.test`, "Other Works " + stamp);
const r1 = await pb.goto(base + "/app/items/" + itemId); ok("other company cannot open guessed item id (404)", r1.status() === 404);
const r2 = await pb.goto(base + "/api/files/" + itemId); ok("guessed file id returns 404", r2.status() === 404);
const r3 = await pb.goto(base + "/app/production/" + itemId); ok("guessed job id 404", r3.status() === 404);
// ---- sign-out + expired session ----
await pv.context().clearCookies(); await pv.goto(base + "/app/items"); ok("signed-out user redirected to login", pv.url().includes("/login"));
await db.query("update sessions set revoked_at=now() where user_id=(select id from users where email=$1)", [`bob${stamp}@other.test`]); await pb.goto(base + "/app"); ok("revoked session → expired message", pb.url().includes("/login") && await pb.locator("text=session expired").waitFor({ timeout: 6000 }).then(() => true, () => false));
// ---- billing sandbox payment outcomes ----
await pa.goto(base + "/app/settings/billing"); await pa.selectOption('[name=version]', { index: 1 }); await pa.click('button:has-text("Continue to payment")'); await pa.waitForURL(/billing\/pay\//);
await pa.click('button:has-text("Simulate failed payment")'); await pa.waitForURL(/paid=0/); ok("failed payment shows clear message", await pa.locator("text=Payment failed").first().waitFor({ timeout: 6000 }).then(() => true, () => false));
await pa.click('a:has-text("Retry")'); await pa.click('button:has-text("Simulate successful payment")'); await pa.waitForURL(/paid=1/); ok("successful payment activates plan", await pa.locator("text=Payment received").waitFor({ timeout: 6000 }).then(() => true, () => false));
// ---- platform admin ----
const S = await newCtx(); const ps = await S.newPage(); await ps.goto(base + "/login"); await ps.fill('[name=email]', "ops@forgeline.test"); await ps.fill('[name=password]', "platform-owner-pass-1"); await ps.click('button:has-text("Sign in")'); await ps.waitForURL(/workspaces|app|admin/); 
for (const p of ["/admin", "/admin/businesses", "/admin/billing", "/admin/operations", "/admin/support", "/admin/audit", "/admin/staff"]) { const r = await ps.goto(base + p); ok(`admin page ${p}`, r.status() === 200 && !(await ps.locator("text=Something went wrong").count())); }
await ps.goto(base + "/admin/businesses"); ok("admin sees businesses but no tenant records", (await ps.locator("body").innerText()).includes("Acme Pumps") && !(await ps.locator("body").innerText()).includes("SAMPLE-PUMP"));
const ra = await pa.goto(base + "/admin"); ok("tenant owner cannot open platform admin", pa.url().includes("/denied") || ra.status() === 404);
// ---- mobile layout ----
const M = await newCtx({ viewport: { width: 390, height: 800 }, hasTouch: true }); const pm = await M.newPage(); await pm.goto(base + "/login"); await pm.fill('[name=email]', emailA); await pm.fill('[name=password]', "e2e-password-1"); await pm.click('button:has-text("Sign in")'); await pm.waitForURL("**/app");
for (const p of ["/app", "/app/items", "/app/production", "/app/inventory", "/app/shopfloor", "/pricing"]) { await pm.goto(base + p); const over = await pm.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1); ok(`mobile no page-level horizontal scroll ${p}`, !over); }
await pm.goto(base + "/app"); await pm.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + "/mobile-dashboard.png" : "/tmp/claude-0/x/mobile.png" });
await pa.goto(base + "/app/planning"); await pa.screenshot({ path: "/tmp/claude-0/x/desktop-planning.png" });
ok("no browser console/page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
await browser.close(); await db.end();
console.log(`\n${results.length - failed}/${results.length} checks passed`); process.exit(failed ? 1 : 0);
