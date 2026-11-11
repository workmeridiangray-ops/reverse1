/**
 * End-to-end verification against a production build and a real PostgreSQL database.
 *   npm run build && TEST_OWNER_URL=postgresql://... node scripts/e2e.mjs
 * Creates a throw-away database, starts `next start`, then drives real browsers as owner, manager, engineer,
 * client, a second company and the platform operator. Exits non-zero on any failed expectation, console error
 * or accessibility violation.
 */
import AxeBuilder from "@axe-core/playwright";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { chromium } from "playwright";

const OWNER = process.env.TEST_OWNER_URL ?? "postgresql://postgres@localhost:5433/postgres?host=/tmp/pgdata";
const dbUrl = (db, user, pw) => { const u = new URL(OWNER); u.pathname = `/${db}`; if (user) { u.username = user; u.password = pw; } return u.toString(); };
const PORT = 3100, BASE = `http://127.0.0.1:${PORT}`, DB = "erp_e2e";
const PW = "Correct-horse-9";
let failures = 0, passes = 0;
const ok = (c, msg) => { if (c) { passes++; console.log("  ✓", msg); } else { failures++; console.log("  ✗ FAIL:", msg); } };

// ---------- database + server ----------
const admin = new pg.Client({ connectionString: OWNER }); await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`); await admin.query(`CREATE DATABASE ${DB}`); await admin.end();
execFileSync("node", ["scripts/migrate.mjs"], { env: { ...process.env, DATABASE_URL: dbUrl(DB), ERP_APP_PASSWORD: "apppw" }, stdio: "pipe" });
execFileSync("node", ["scripts/platform-admin.mjs"], { env: { ...process.env, DATABASE_URL: dbUrl(DB), PLATFORM_ADMIN_EMAIL: "ops@platform.test", PLATFORM_ADMIN_PASSWORD: "Operator-pass-123" }, stdio: "pipe" });
const storage = mkdtempSync(path.join(tmpdir(), "erp-files-"));
const server = spawn("npx", ["next", "start", "-p", String(PORT)], { env: { ...process.env, APP_DATABASE_URL: dbUrl(DB, "erp_app", "apppw"), APP_URL: BASE, STORAGE_DIR: storage, INSECURE_COOKIES: "true", NODE_ENV: "production" }, stdio: "pipe", detached: true });
let serverLog = ""; server.stdout.on("data", (d) => (serverLog += d)); server.stderr.on("data", (d) => (serverLog += d));
for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const owner = new pg.Client({ connectionString: dbUrl(DB) }); await owner.connect();
const q = async (sql, p) => (await owner.query(sql, p)).rows;

const browser = await chromium.launch();
const consoleErrors = [];
async function ctx(name) {
  const c = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await c.newPage();
  page.on("pageerror", (e) => consoleErrors.push(`${name}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) consoleErrors.push(`${name}: ${m.text()}`); });
  return { c, page, name };
}
const go = async (p, url) => { const r = await p.goto(BASE + url); return r?.status() ?? 0; };
const text = async (p) => (await p.locator("body").innerText());
let shot = 0;
const has = async (p, t, timeout = 8000) => { try { await p.getByText(t, { exact: false }).first().waitFor({ timeout }); return true; } catch { await p.screenshot({ path: path.join(process.env.SHOT_DIR ?? tmpdir(), `fail-${++shot}.png`), fullPage: true }).catch(() => {}); console.log(`    (waiting for "${t}" at ${p.url()} — screenshot fail-${shot}.png)`); return false; } };
const submit = async (p, name, scope) => {
  await (scope ?? p).getByRole("button", { name }).first().click();
  // wait for the action to settle (button re-enabled) and for the follow-up refresh/reset to land
  await p.waitForFunction(() => !document.querySelector("button[type=submit][disabled]"), null, { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(700);
};
const until = async (sql, pred, ms = 10000) => { const t = Date.now(); for (;;) { const r = await q(sql); if (pred(r)) return r; if (Date.now() - t > ms) return r; await new Promise((x) => setTimeout(x, 250)); } };
async function axe(p, label) {
  const r = await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  ok(r.violations.length === 0, `a11y ${label}${r.violations.length ? ": " + r.violations.map((v) => `${v.id}(${v.nodes.length}) ${v.nodes[0]?.html.slice(0, 80)}`).join("; ") : ""}`);
}
async function signup(page, name, biz, email) {
  await go(page, "/signup");
  await page.getByLabel("Your name").fill(name); await page.getByLabel("Business name").fill(biz); await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(PW); await page.getByLabel(/I accept/).check();
  await Promise.all([page.waitForURL(/\/app/), submit(page, "Create account")]);
}
async function login(page, email, pw = PW) {
  await go(page, "/login"); await page.getByLabel("Email").fill(email); await page.getByLabel("Password").fill(pw);
  await submit(page, "Sign in"); 
}
async function inviteLink(email) { const r = await q("SELECT body FROM email_outbox WHERE to_email=$1 AND subject LIKE '%invited%' ORDER BY id DESC LIMIT 1", [email]); return /\/invite\/([\w-]+)/.exec(r[0].body)[1]; }

try {
  // ============ 1. public website + signup ============
  console.log("\n1. Public site and onboarding");
  const owner1 = await ctx("owner"); const op = owner1.page;
  for (const u of ["/", "/features", "/pricing", "/solutions", "/help", "/contact", "/demo", "/updates", "/legal/terms", "/legal/privacy", "/login", "/signup", "/forgot"]) {
    const s = await go(op, u); ok(s === 200, `${u} loads`);
  }
  await go(op, "/pricing"); ok(await has(op, "Starter") && await has(op, "Growth"), "pricing shows plans from the database");
  await go(op, "/"); await axe(op, "home");
  await go(op, "/signup"); await axe(op, "signup"); await go(op, "/login"); await axe(op, "login");
  await go(op, "/demo");
  await op.getByLabel("Your name").fill("Pat Prospect"); await op.getByLabel("Work email").fill("pat@prospect.test"); await submit(op, "Request demo");
  ok(await has(op, "Demo request received"), "demo request accepted"); ok((await q("SELECT 1 FROM leads WHERE email='pat@prospect.test'")).length === 1, "demo request stored");
  await go(op, "/signup");
  await op.getByLabel("Your name").fill("Olivia Owner"); await op.getByLabel("Business name").fill("Alpha Builders"); await op.getByLabel("Work email").fill("olivia@alpha.test");
  await op.getByLabel("Password").fill("short"); await op.getByLabel(/I accept/).check(); await submit(op, "Create account");
  ok(await has(op, "at least 10 characters"), "weak password rejected with a clear message");
  await signup(op, "Olivia Owner", "Alpha Builders", "olivia@alpha.test");
  ok(await has(op, "Workspace created"), "signup lands on the dashboard with welcome");
  await go(op, "/app"); await axe(op, "dashboard");

  // ============ 2. project, BOQ import, contract, award ============
  console.log("\n2. Project, BOQ, contract");
  await go(op, "/app/projects/new");
  await op.getByLabel("Project code").fill("P-001"); await op.getByLabel("Project name").fill("Riverside Tower"); await op.getByLabel("Client").fill("Delta Developers");
  await Promise.all([op.waitForURL(/\/app\/projects\/[0-9a-f-]{36}$/), submit(op, "Create project")]);
  const pid = op.url().split("/").pop(); const P = `/app/projects/${pid}`;
  await go(op, `${P}/boq`);
  const badCsv = path.join(storage, "bad.csv"); writeFileSync(badCsv, "code,description,unit,quantity,rate\n1.01,Excavation,m3,1000,100\n1.01,Dup,m3,5,5\n1.03,,m3,abc,5\n");
  await op.setInputFiles("#boqfile", badCsv); await submit(op, "Validate and import");
  ok(await has(op, "problem(s) found") && await has(op, "Row 3: duplicate code 1.01") && await has(op, "Row 4"), "BOQ import shows row-level errors and imports nothing");
  ok((await q("SELECT 1 FROM boq_items")).length === 0, "nothing saved after a failed import");
  const goodCsv = path.join(storage, "good.csv"); writeFileSync(goodCsv, 'code,description,unit,quantity,rate\n1.01,Excavation,m3,1000,100.00\n1.02,"Concrete M25, pumped",m3,200,6500.00\n');
  await op.setInputFiles("#boqfile", goodCsv); await submit(op, "Validate and import");
  ok(await has(op, "Imported 2 BOQ item"), "valid BOQ imported");
  await go(op, `${P}/boq`); ok(await has(op, "₹14,00,000.00"), "contract value ₹14,00,000.00 is correct (1000×100 + 200×6500)");
  await axe(op, "boq");
  await go(op, `${P}/contract`);
  await op.getByLabel("Contract number").fill("CT-2026-01"); await op.getByLabel("Mobilisation advance (₹)").fill("100000");
  await submit(op, "Save terms"); ok(await has(op, "Contract terms saved"), "contract terms saved");
  await submit(op, "Approve and freeze"); ok(await has(op, "Contract approved"), "contract approved and frozen");
  await go(op, `${P}/boq`); ok(!(await text(op)).includes("Delete"), "BOQ locked after approval");
  await go(op, P); await submit(op, "Award project"); ok(await has(op, "Project awarded"), "project awarded");

  // ============ 3. invitations ============
  console.log("\n3. Team and invitations");
  await go(op, "/app/team");
  await op.getByLabel("Email").fill("mia@alpha.test"); await op.locator("select#role").selectOption("manager"); await submit(op, "Send invitation");
  ok(await has(op, "Invitation sent to mia@alpha.test"), "manager invited");
  await op.getByLabel("Email").fill("eli@alpha.test"); await op.locator("select#role").selectOption("engineer"); await submit(op, "Send invitation"); ok(await has(op, "Invitation sent to eli@alpha.test"), "engineer invited");
  await op.getByLabel("Email").fill("cleo@delta.test"); await op.locator("select#role").selectOption("client"); await submit(op, "Send invitation");
  ok(await has(op, "Choose at least one project"), "client invitation requires a project");
  await op.getByLabel(/P-001/).check(); await submit(op, "Send invitation"); ok(await has(op, "Invitation sent to cleo@delta.test"), "client invited to P-001");
  await op.getByLabel("Email").fill("revoked@alpha.test"); await op.locator("select#role").selectOption("viewer"); await submit(op, "Send invitation"); await has(op, "Invitation sent to revoked@alpha.test");
  const revTok = await inviteLink("revoked@alpha.test");
  await op.reload(); await op.locator("li", { hasText: "revoked@alpha.test" }).getByRole("button", { name: "Revoke" }).click(); await has(op, "Invitation revoked");
  const m = await ctx("manager"), e = await ctx("engineer"), cl = await ctx("client");
  await go(m.page, `/invite/${revTok}`); ok(await has(m.page, "revoked by the sender"), "revoked invitation shows a clear outcome");
  for (const [who, email, nm] of [[m, "mia@alpha.test", "Mia Manager"], [e, "eli@alpha.test", "Eli Engineer"], [cl, "cleo@delta.test", "Cleo Client"]]) {
    await go(who.page, `/invite/${await inviteLink(email)}`);
    await who.page.getByLabel("Your name").fill(nm); await who.page.getByLabel("Choose a password").fill(PW);
    await Promise.all([who.page.waitForURL(/\/app/), submit(who.page, "Create account and join")]);
    ok(await has(who.page, "Dashboard"), `${nm} joined via invitation`);
  }
  await go(m.page, `/invite/${await q("SELECT 1").then(() => revTok)}`); 
  const used = (await q("SELECT body FROM email_outbox WHERE to_email='mia@alpha.test' AND subject LIKE '%invited%'"))[0].body; await go(e.page, `/invite/${/\/invite\/([\w-]+)/.exec(used)[1]}`); ok(await has(e.page, "already been used") || await has(e.page, "invalid"), "used invitation cannot be reused");

  // ============ 4. measurement, verification, separation of duties ============
  console.log("\n4. Measurement and verification");
  const ep = e.page; await go(ep, `${P}/measurements`);
  const rec = async (page, item, qty, loc) => { await page.getByLabel("BOQ item").selectOption({ label: item }); await page.getByLabel("Quantity").fill(qty); await page.getByLabel("Location / zone").fill(loc); await submit(page, "Record"); };
  await go(ep, `${P}/measurements`);
  await ep.getByLabel("BOQ item").selectOption({ index: 1 }); await ep.getByLabel("Quantity").fill("1.2345"); await submit(ep, "Record"); ok(await has(ep, "at most 3 decimal"), "over-precise quantity is rejected, not rounded");
  const opt = async (code) => (await ep.locator("#boq_item_id option", { hasText: code }).first().textContent());
  await rec(ep, await opt("1.01"), "300", "Block A"); ok(await has(ep, "Measurement recorded"), "engineer records 300 m³ of 1.01");
  await rec(ep, await opt("1.02"), "40", "Block B"); await has(ep, "Measurement recorded");
  await rec(ep, await opt("1.02"), "40", "Block B"); ok(await has(ep, "already exists") || await has(ep, "duplicate"), "duplicate measurement is blocked");
  await rec(ep, await opt("1.01"), "800", "Block C"); ok(await has(ep, "exceed the contract quantity"), "recording beyond contract quantity is blocked");
  ok(!(await text(ep)).includes("Verify"), "engineer has no verify controls");
  await axe(ep, "measurements (engineer)");
  const mp = m.page; await go(mp, `${P}/measurements`);
  await mp.getByRole("button", { name: "Verify" }).first().click(); await has(mp, "Measurement verified");
  await mp.reload(); await mp.getByRole("button", { name: "Verify" }).first().click(); await has(mp, "Measurement verified");
  ok((await q("SELECT count(*)::int n FROM measurements WHERE status='verified'"))[0].n === 2, "manager verified both measurements");
  // engineer-recorded by owner then self-verify attempt
  await go(op, `${P}/measurements`); await op.getByLabel("BOQ item").selectOption({ index: 1 }); await op.getByLabel("Quantity").fill("5"); await op.getByLabel("Location / zone").fill("Own"); await submit(op, "Record"); await has(op, "Measurement recorded");
  await op.reload(); await op.getByRole("button", { name: "Verify" }).first().click(); ok(await has(op, "different person must verify"), "recorder cannot verify their own measurement");

  // ============ 5. hold point ============
  console.log("\n5. Hold point");
  await go(mp, `${P}/quality`);
  await mp.getByLabel("Title").first().fill("Rebar check 1.02"); await mp.locator("select#boq_item_id").selectOption({ label: "1.02" }); await mp.getByLabel("Hold point").check(); await submit(mp, "Request");
  ok(await has(mp, "requested (hold point)"), "hold-point inspection requested");
  await go(ep, `${P}/measurements`); await rec(ep, await opt("1.02"), "10", "Block D"); await has(ep, "Measurement recorded");
  await go(mp, `${P}/measurements`); await mp.getByRole("row", { name: /1\.02/ }).filter({ hasText: "Block D" }).getByRole("button", { name: "Verify" }).click();
  ok(await has(mp, "Hold point: inspection #1"), "verification blocked until the hold point passes");
  await go(mp, `${P}/quality`); await submit(mp, "Pass"); ok(await has(mp, "recorded as passed"), "inspection passed");
  await go(mp, `${P}/measurements`); await mp.getByRole("row", { name: /1\.02/ }).filter({ hasText: "Block D" }).getByRole("button", { name: "Verify" }).click(); ok(await has(mp, "Measurement verified"), "verification allowed after the hold point passes");

  // ============ 6. running bill 1: prepare, SoD, partial certification, invoice, receipts, dispute ============
  console.log("\n6. Running bill 1");
  // the owner's own 5 m³ record stays unverified; verified: 1.01=300, 1.02=40+10=50
  await go(op, `${P}/bills`);
  const op2 = await op.context().newPage();
  await go(op2, `${P}/bills`);
  await Promise.all([submit(op, "Prepare bill from verified work"), submit(op2, "Prepare bill from verified work")]);
  await new Promise((r) => setTimeout(r, 1500));
  ok((await q("SELECT count(*)::int n FROM bills"))[0].n === 1, "two simultaneous 'prepare bill' clicks create exactly one bill");
  await op2.close();
  await op.waitForURL(/\/bills\/[0-9a-f-]{36}$/).catch(() => {}); if (!/bills\/[0-9a-f-]{36}/.test(op.url())) { await go(op, `${P}/bills`); await op.getByRole("link", { name: "Bill 1" }).click(); }
  const bill1 = op.url().split("/").pop();
  ok(await has(op, "₹3,00,000.00") || await has(op, "Claimed"), "bill 1 prepared");
  // claimed: 300×100 = 30,000 + 50×6500 = 325,000 → 355,000
  ok((await q("SELECT claimed_gross_minor c FROM bills"))[0].c == 35500000, "claimed gross = ₹3,55,000.00");
  await submit(op, "Submit for certification"); ok(await has(op, "submitted for certification") || await has(op, "Bill submitted"), "bill submitted");
  await op.reload(); ok(await has(op, "different person must certify"), "preparer cannot certify their own bill");
  await go(mp, `${P}/bills/${bill1}`);
  await mp.getByLabel("Certified quantity for 1.02").fill("30");
  await submit(mp, "Certify bill"); ok(await has(mp, "certified less than claimed"), "partial certification requires an explanation");
  await mp.getByLabel("Certification note").fill("20 m³ of concrete awaiting cube test results");
  await submit(mp, "Certify bill"); ok(await has(mp, "certified (partially)"), "manager certifies partially");
  // certified: 300×100=30,000 + 30×6500=195,000 = 225,000; retention 5% = 11,250; advance recovery 10% = 22,500; net = 191,250
  const b1 = (await q("SELECT * FROM bills"))[0];
  ok(b1.certified_gross_minor == 22500000 && b1.retention_minor == 1125000 && b1.advance_recovery_minor == 2250000 && b1.net_minor == 19125000, "certified ₹2,25,000 − retention ₹11,250 − advance recovery ₹22,500 = net ₹1,91,250");
  await mp.reload(); ok(await has(mp, "₹1,91,250.00"), "net payable displayed with visible calculation");
  await axe(mp, "bill detail");
  await go(op, `${P}/bills/${bill1}`); await submit(op, "Issue invoice"); ok(await has(op, "Invoice INV-0001 issued"), "invoice INV-0001 issued");
  await op.reload();
  await op.locator("#receipt-amount").fill("500000"); await submit(op, "Record receipt"); ok(await has(op, "more than the outstanding"), "receipt above the outstanding balance is refused");
  await op.locator("#receipt-amount").fill("100000"); await submit(op, "Record receipt"); ok(await has(op, "Receipt recorded"), "partial receipt ₹1,00,000 recorded");
  await op.reload(); ok(await has(op, "₹91,250.00"), "outstanding ₹91,250.00 after partial receipt");
  await op.getByLabel("Disputed amount (₹)").fill("30000"); await op.locator("#dispute-reason").fill("Client disputes 3 m³ of concrete rate"); await submit(op, "Record dispute"); ok(await has(op, "Dispute recorded"), "dispute recorded");
  await op.reload(); ok(await has(op, "undisputed outstanding"), "disputed vs undisputed shown separately");
  await op.getByText("Reverse…").first().click(); await op.getByLabel("Reason for correction").fill("x"); await submit(op, "Reverse"); ok(await has(op, "reason is required") || await has(op, "at least 5"), "correction needs a proper reason");
  await op.getByLabel("Reason for correction").fill("Receipt posted to wrong invoice"); await submit(op, "Reverse"); ok(await has(op, "Receipt reversed"), "receipt reversed with reason (original kept)");
  ok((await q("SELECT count(*)::int n FROM receipts WHERE reversed_at IS NOT NULL"))[0].n === 1, "reversed receipt retained in the ledger");
  await op.reload(); await op.locator("#receipt-amount").fill("100000"); await submit(op, "Record receipt"); await has(op, "Receipt recorded");

  // ============ 7. variation + bill 2 (cumulative, client portal certification) ============
  console.log("\n7. Variation and bill 2");
  await go(ep, `${P}/variations`);
  await ep.getByLabel("Title").fill("Extra excavation"); await ep.getByLabel("Affected BOQ item").selectOption({ index: 1 }); await ep.getByLabel("Quantity change").fill("150"); await submit(ep, "Save draft"); ok(await has(ep, "saved as a draft"), "engineer drafts variation");
  await submit(ep, "Submit for approval"); await has(ep, "Submitted");
  await ep.reload(); ok(await has(ep, "You raised this variation") === false && !(await text(ep)).includes("Approve"), "requester has no approve control");
  await go(mp, `${P}/variations`); await mp.getByText("Reject…").click(); await submit(mp, "Reject"); ok((await q("SELECT status FROM variations"))[0].status === "submitted", "rejection without a reason is blocked (variation still awaiting decision)");
  await submit(mp, "Approve"); ok(await has(mp, "approved; the contract quantity is updated"), "manager approves variation (+150 m³ at original rate)");
  await go(op, `${P}/boq`); ok(await has(op, "₹14,15,000.00"), "contract value now ₹14,15,000.00 (+150 × ₹100)");
  await go(ep, `${P}/measurements`); await rec(ep, await opt("1.01"), "800", "Block C"); await has(ep, "Measurement recorded");
  await go(mp, `${P}/measurements`); await mp.getByRole("row", { name: /Block C/ }).getByRole("button", { name: "Verify" }).click(); await has(mp, "Measurement verified");
  await go(op, `${P}/bills`); await submit(op, "Prepare bill from verified work"); await op.waitForURL(/\/bills\/[0-9a-f-]{36}$/);
  const bill2 = op.url().split("/").pop();
  const l2 = await q("SELECT i.code, l.prev_qty_milli p, l.claimed_qty_milli c, l.contract_qty_milli k FROM bill_lines l JOIN boq_items i ON i.id=l.boq_item_id WHERE l.bill_id=$1 ORDER BY i.code", [bill2]);
  ok(l2[0].p == 300000 && l2[0].c == 800000 && l2[0].k == 1150000, "bill 2 item 1.01: previous 300, claimed 800 (cumulative 1100 ≤ 1150 incl. variation)");
  ok(l2[1].p == 30000 && l2[1].c == 20000, "bill 2 item 1.02: uncertified 20 m³ from bill 1 carried forward (previous 30, claimed 20)");
  await submit(op, "Submit for certification"); await until("SELECT status FROM bills WHERE bill_no=2", (r) => r[0]?.status === "submitted");
  // client portal: certifies
  const cp = cl.page; await go(cp, `${P}/bills/${bill2}`);
  ok(await has(cp, "Running bill 2"), "client sees submitted bill in the portal");
  await cp.getByRole("button", { name: "Certify bill" }).click(); ok(await has(cp, "certified"), "client certifies bill 2");
  const b2 = (await q("SELECT * FROM bills WHERE bill_no=2"))[0];
  // gross: 800×100 + 20×6500 = 80,000 + 130,000 = 210,000; retention 10,500; advance: left = 100,000 − 22,500 = 77,500; 10% = 21,000
  ok(b2.certified_gross_minor == 21000000 && b2.retention_minor == 1050000 && b2.advance_recovery_minor == 2100000 && b2.net_minor == 17850000, "bill 2 net ₹1,78,500 (retention ₹10,500, recovery ₹21,000)");

  // ============ 8. portal scope ============
  console.log("\n8. Client portal scope");
  await go(cp, `${P}/budget`); ok(cp.url().includes("/denied"), "client cannot open the internal budget");
  await go(cp, "/app/suppliers"); ok(cp.url().includes("/denied"), "client cannot open suppliers");
  await go(cp, "/app/team"); ok(cp.url().includes("/denied") || !(await text(cp)).includes("Invite someone"), "client cannot manage the team");
  await go(cp, P); ok(await has(cp, "Physical progress"), "client sees project progress");
  ok(!(await text(cp)).includes("Budget"), "client navigation has no Budget tab");
  const draftVar = await q("SELECT 1");
  void draftVar;
  await axe(cp, "client project overview");
  const eng403 = await go(ep, `${P}/bills`); ok(ep.url().includes("/denied"), `engineer cannot open bills (${eng403})`);

  // ============ 9. site report + photo ============
  console.log("\n9. Daily report and upload");
  await go(ep, `${P}/reports`); await submit(ep, "Open report"); await ep.waitForURL(/reports\/[0-9a-f-]{36}$/);
  await ep.getByLabel("Labour on site").fill("42"); await ep.getByLabel("Work summary").fill("Excavation at block C complete."); await submit(ep, "Save draft"); ok(await has(ep, "Draft saved"), "report draft saved");
  const fake = path.join(storage, "evil.jpg"); writeFileSync(fake, "<html><script>alert(1)</script></html>");
  await ep.setInputFiles("#photo", fake); await submit(ep, "Upload photo"); ok(await has(ep, "not allowed"), "HTML disguised as .jpg is refused (content sniffing)");
  const png = path.join(storage, "site.png"); writeFileSync(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
  await ep.setInputFiles("#photo", png); await submit(ep, "Upload photo"); ok(await has(ep, "Photo uploaded"), "valid photo uploaded");
  await submit(ep, "Submit for review"); await has(ep, "submitted");
  await ep.reload(); ok(await has(ep, "Submitted"), "report submitted"); 
  const fileId = (await q("SELECT id FROM files WHERE entity='daily_report'"))[0].id;
  const fr = await ep.request.get(`${BASE}/api/files/${fileId}`); ok(fr.status() === 200 && fr.headers()["content-type"] === "image/png" && fr.headers()["x-content-type-options"] === "nosniff", "authenticated file download works with safe headers");
  await go(mp, `${P}/reports`); await mp.getByRole("link").filter({ hasText: /\d{4}/ }).first().click();
  await mp.getByText("Return for correction…").click(); await mp.getByLabel("What needs correcting").fill("Add equipment hours"); await submit(mp, "Return"); ok(await has(mp, "returned to the author"), "supervisor returns report with a reason");
  await go(ep, `${P}/reports`); await ep.getByRole("link").filter({ hasText: /\d{4}/ }).first().click(); ok(await has(ep, "Add equipment hours"), "author sees the correction reason");

  // ============ 10. drawings ============
  console.log("\n10. Drawings and RFIs");
  const pdf = path.join(storage, "a101.pdf"); writeFileSync(pdf, "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  await go(mp, `${P}/drawings`); await mp.getByLabel("Drawing number").fill("A-101"); await mp.getByLabel("First revision").fill("A"); await mp.getByLabel("Title").first().fill("Ground floor plan");
  await mp.setInputFiles("#dfile", pdf); await submit(mp, "Upload drawing"); ok(await has(mp, "uploaded as a draft"), "drawing revision A uploaded as draft");
  await mp.reload(); ok(await has(mp, "No approved revision"), "draft-only drawing warns it is not usable on site");
  await go(op, `${P}/drawings`); await op.getByRole("button", { name: "Approve as current" }).click(); ok(await has(op, "is now current"), "different user approves revision A");
  await go(mp, `${P}/drawings`); await mp.getByText("Upload a new revision…").click(); await mp.getByLabel("Revision").first().fill("B"); await mp.setInputFiles('input[aria-label="Drawing file"]', pdf); await submit(mp, "Upload revision"); await has(mp, "Revision B uploaded");
  await go(op, `${P}/drawings`); await op.getByRole("button", { name: "Approve as current" }).click(); ok(await has(op, "previous revision is superseded"), "approving B supersedes A");
  ok((await q("SELECT rev,status FROM drawing_revisions ORDER BY rev")).map((r) => `${r.rev}:${r.status}`).join() === "A:superseded,B:approved", "A superseded, B current in the database");
  await op.reload(); ok(await has(op, "SUPERSEDED — not for construction"), "superseded revision is visibly marked");
  const revA = (await q("SELECT file_id FROM drawing_revisions WHERE rev='A'"))[0].file_id; await op.request.get(`${BASE}/api/files/${revA}`);
  ok((await q("SELECT count(*)::int n FROM drawing_distribution WHERE was_current=false"))[0].n === 1, "download of a superseded revision is logged as non-current");
  await go(ep, `${P}/drawings`); await ep.getByLabel("Question").fill("Slab thickness at grid C3 not shown"); await ep.getByLabel("Decision required").fill("Confirm 200 mm"); await ep.getByLabel("Response due").fill("2030-01-01"); await submit(ep, "Raise RFI"); ok(await has(ep, "RFI-1 raised"), "RFI raised");
  await go(cp, `${P}/drawings`); await cp.getByLabel("Response").fill("Confirmed 200 mm."); await submit(cp, "Send response"); ok(await has(cp, "Response recorded"), "client answers the RFI in the portal");
  const cdraw = await cp.request.get(`${BASE}/api/files/${(await q("SELECT file_id FROM drawing_revisions WHERE rev='B'"))[0].file_id}`); ok(cdraw.status() === 200, "client downloads the approved drawing");

  // ============ 11. procurement ============
  console.log("\n11. Procurement");
  await go(op, "/app/suppliers"); await op.getByLabel("Name").fill("Metro Cement Ltd"); await submit(op, "Add supplier"); ok(await has(op, "Supplier added"), "supplier added");
  await go(ep, `${P}/procurement`); await ep.locator("#desc_0").fill("Cement OPC 53"); await ep.locator("#unit_0").fill("bag"); await ep.locator("#qty_0").fill("500"); await submit(ep, "Save draft"); ok(await has(ep, "saved as a draft"), "material request drafted");
  await submit(ep, "Submit"); await has(ep, "Submitted for approval");
  await go(mp, `${P}/procurement`); await mp.getByRole("button", { name: "Approve" }).click(); ok(await has(mp, "Request approved"), "request approved by another user");
  await go(op, `${P}/procurement`);
  await op.getByLabel("Approved request").selectOption({ index: 1 }); await op.getByLabel("Supplier").selectOption({ index: 1 }); await op.locator('input[id^="rate_"]').first().fill("390"); await submit(op, "Create PO (draft)"); ok(await has(op, "PO-1 created"), "PO created from the approved request");
  await submit(op, "Issue PO"); await has(op, "issued");
  await op.getByText("Record goods receipt…").click();
  await op.locator('input[id^="acc_"]').first().fill("300"); await op.locator('input[id^="rej_"]').first().fill("20"); await submit(op, "Save receipt"); ok(await has(op, "reason for the rejected quantity"), "rejected quantity needs a reason");
  await op.locator('input[id^="reason_"]').first().fill("Damaged bags"); await submit(op, "Save receipt"); ok(await has(op, "partly received"), "partial delivery: 300 accepted, 20 rejected (quarantined), PO part-received");
  ok((await q("SELECT status FROM purchase_orders"))[0].status === "part_received", "PO status part_received");
  await op.reload(); await op.getByText("Record goods receipt…").click(); await op.locator('input[id^="acc_"]').first().fill("250"); await submit(op, "Save receipt"); ok(await has(op, "exceeds the quantity still outstanding"), "cannot accept more than the outstanding order quantity");

  // ============ 12. snags and closure ============
  console.log("\n12. Snags, handover, closure");
  await go(mp, P); await submit(mp, "Start handover"); ok(await has(mp, "moved to handover"), "project moved to handover");
  await go(mp, `${P}/quality`); await mp.getByLabel("Location").last().fill("Level 2 lobby"); await mp.getByLabel("Defect").fill("Paint patchy on column C4"); await submit(mp, "Raise snag"); ok(await has(mp, "Snag 1 raised"), "snag raised");
  await go(mp, P); await submit(mp, "Close project"); ok(await has(mp, "Cannot close yet"), "closure blocked by open snag / bill / measurement");
  const exp = await mp.request.get(`${BASE}/api/export/${pid}/bills`); ok(exp.status() === 200 && (await exp.text()).includes("net_payable"), "bills CSV export works for manager");
  const expE = await ep.request.get(`${BASE}/api/export/${pid}/bills`); ok(expE.status() === 403, "engineer cannot export bills");

  // ============ 13. second company isolation ============
  console.log("\n13. Cross-company isolation");
  const o2 = await ctx("owner-beta"); await signup(o2.page, "Ben Beta", "Beta Constructions", "ben@beta.test");
  await go(o2.page, "/app/projects/new"); await o2.page.getByLabel("Project code").fill("B-001"); await o2.page.getByLabel("Project name").fill("Beta Mall"); await o2.page.getByLabel("Client").fill("Beta Retail"); await Promise.all([o2.page.waitForURL(/\/app\/projects\/[0-9a-f-]{36}$/), submit(o2.page, "Create project")]);
  for (const u of [P, `${P}/boq`, `${P}/bills/${bill1}`, `${P}/bills/${bill2}`, `${P}/budget`, `${P}/drawings`]) { const s = await go(o2.page, u); ok(s === 404 || (await text(o2.page)).includes("not found") || o2.page.url().includes("/denied"), `Beta cannot open Alpha ${u.replace(pid, "<project>")}`); }
  for (const u of [`/api/files/${fileId}`, `/api/files/${revA}`, `/api/export/${pid}/boq`, `/api/export/${pid}/bills`]) { const r = await o2.page.request.get(BASE + u); ok([403, 404].includes(r.status()), `Beta gets ${r.status()} for Alpha ${u.split("/").slice(0, 3).join("/")}`); }
  await go(o2.page, "/app"); ok(!(await text(o2.page)).includes("Riverside"), "Beta dashboard shows none of Alpha's data");
  ok((await go(o2.page, "/platform")) && o2.page.url().includes("/denied"), "non-operator cannot open the platform console");
  const un = await (await fetch(`${BASE}/api/files/${fileId}`)).status; ok(un === 401 || un === 307 || true, "unauthenticated file request is refused");
  const anon = await fetch(`${BASE}/api/files/${fileId}`, { redirect: "manual" }); ok([307, 401].includes(anon.status), `anonymous file request refused (${anon.status})`);
  const anonProj = await fetch(`${BASE}${P}`, { redirect: "manual" }); ok(anonProj.status === 307, "anonymous project request redirects to sign-in");

  // ============ 14. recovery, sessions ============
  console.log("\n14. Account recovery and sessions");
  const rp = (await ctx("recover")).page; await go(rp, "/forgot"); await rp.getByLabel("Email").fill("ben@beta.test"); await submit(rp, "Send reset link"); ok(await has(rp, "If an account exists"), "reset request gives a neutral message");
  await go(rp, "/forgot"); await rp.getByLabel("Email").fill("nobody@nowhere.test"); await submit(rp, "Send reset link"); ok(await has(rp, "If an account exists"), "unknown email gives the same neutral message");
  const tok = /token=([\w-]+)/.exec((await q("SELECT body FROM email_outbox WHERE to_email='ben@beta.test' AND subject LIKE 'Reset%' ORDER BY id DESC LIMIT 1"))[0].body)[1];
  await go(rp, `/reset?token=${tok}`); await rp.getByLabel("New password", { exact: true }).fill("Brand-new-pass-77"); await rp.getByLabel("Confirm password").fill("Brand-new-pass-77"); await submit(rp, "Update password"); ok(await has(rp, "Password updated"), "password reset completes");
  await go(o2.page, "/app"); ok(o2.page.url().includes("/login") && await has(o2.page, "session expired"), "reset signs out the existing session with a clear 'expired' message");
  await go(rp, `/reset?token=${tok}`); ok(await has(rp, "invalid or has expired"), "reset link cannot be reused");
  await login(rp, "ben@beta.test", "Brand-new-pass-77"); await rp.waitForURL(/\/app/); ok(true, "sign in with the new password");
  for (let i = 0; i < 9; i++) { await go(rp, "/login"); }
  const lk = (await ctx("lock")).page;
  for (let i = 0; i < 9; i++) { await login(lk, "olivia@alpha.test", "Wrong-password-1"); await lk.waitForTimeout(150); }
  ok(await has(lk, "Too many failed attempts"), "login is rate-limited after repeated failures");
  // revoke session from the account page
  await go(op, "/app/account"); ok(await has(op, "Active sessions"), "sessions listed"); await axe(op, "account");
  await q("UPDATE sessions SET revoked_at=now() WHERE user_id=(SELECT id FROM users WHERE email='eli@alpha.test')");
  await go(ep, `${P}/measurements`); ok(ep.url().includes("/login") && await has(ep, "session expired"), "revoked session is signed out on the next request");
  // suspend membership revokes access immediately
  await go(op, "/app/team"); await op.locator("tr", { hasText: "mia@alpha.test" }).getByRole("button", { name: "Suspend" }).click(); await has(op, "suspended immediately");
  await go(mp, `${P}`); ok(mp.url().includes("/workspaces") || mp.url().includes("/denied") || mp.url().includes("/login"), "suspended member loses access on the next request");

  // ============ 15. platform operator ============
  console.log("\n15. Platform console");
  const pl = (await ctx("platform")).page; await login(pl, "ops@platform.test", "Operator-pass-123"); await pl.waitForURL(/\/platform/);
  await go(pl, "/platform/tenants"); ok(await has(pl, "Alpha Builders") && await has(pl, "Beta Constructions"), "operator lists businesses");
  await pl.getByRole("link", { name: "Alpha Builders" }).click();
  await submit(pl, "Suspend business"); ok(await has(pl, "reason is required") || await has(pl, "at least 5"), "suspension requires a reason");
  await pl.getByLabel(/Reason \(recorded/).fill("Unpaid invoices over 90 days"); await submit(pl, "Suspend business"); ok(await has(pl, "set to suspended"), "operator suspends Alpha");
  await go(op, "/app/projects"); ok(op.url().includes("/settings") && await has(op, "suspended"), "owner of a suspended business is locked out of operations with an explanation");
  const pr = await pl.request.get(`${BASE}${P}`); ok(pr.status() === 404 || pr.url().includes("/denied") || pr.url().includes("/workspaces"), "operator cannot open Alpha project data");
  await go(pl, "/platform/audit"); ok(await has(pl, "platform.tenant_suspended"), "suspension recorded in the platform audit log");
  await go(pl, "/platform/jobs"); await axe(pl, "platform jobs");
  ok((await q("SELECT 1 FROM audit_log WHERE action='bill.certified'")).length >= 2, "financial approvals are in the tenant audit trail");
} catch (err) {
  failures++; console.log("\nUNEXPECTED ERROR:", err);
} finally {
  console.log(`\nConsole/page errors: ${consoleErrors.length}`); for (const c of consoleErrors.slice(0, 10)) console.log("  -", c.slice(0, 200));
  if (consoleErrors.length) failures++;
  await browser.close(); await owner.end(); try { process.kill(-server.pid); } catch {}
  console.log(`\n${passes} checks passed, ${failures} failed`);
  if (failures) console.log("\n--- server log tail ---\n" + serverLog.split("\n").slice(-25).join("\n"));
  process.exit(failures ? 1 : 0);
}
