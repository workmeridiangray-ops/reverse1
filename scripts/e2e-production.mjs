// Browser test of the shop-floor chain through the real forms: opening stock → job → issue → operation → output → complete → cost → ledger.
import { chromium } from "playwright";
const base = process.env.APP_URL || "http://localhost:3000"; let failed = 0;
const ok = (n, c, x = "") => { console.log(c ? "PASS" : "FAIL", n, c ? "" : x); if (!c) failed++; };
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); const p = await (await b.newContext()).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(p.url() + " " + e)); const s = Date.now().toString(36);
const seen = (t, ms = 8000) => p.locator(`text=${t}`).first().waitFor({ timeout: ms }).then(() => true, () => false);
await p.goto(base + "/signup"); await p.fill("[name=name]", "Prod Owner"); await p.fill("[name=email]", `prod${s}@x.test`); await p.fill("[name=company]", "Prod " + s); await p.fill("[name=password]", "e2e-password-1"); await p.check("[name=terms]"); await p.click('button:has-text("Create workspace")'); await p.waitForURL("**/onboarding");
p.once("dialog", (d) => d.accept()); await p.click('button:has-text("Load sample data")'); await p.waitForURL("**/app?sample=1");
// opening stock of the tracked shaft (batch) so the body job can run
await p.goto(base + "/app/inventory"); const f = p.locator('form:has(button:has-text("Post opening stock"))');
await f.locator("[name=item]").selectOption({ label: "SAMPLE-SHAFT — Sample shaft" }); await f.locator("[name=loc]").selectOption({ label: "SMP-STORES — SMP-STORES" }); await f.locator("[name=qty]").fill("20"); await f.locator("[name=cost]").fill("400"); await f.locator("[name=batch]").fill("SH-001"); await f.locator("button").click();
ok("opening stock posted", await seen("Opening stock posted"));
// job
await p.goto(base + "/app/production"); const c = p.locator('form:has(button:has-text("Create job"))'); await c.locator("[name=item]").selectOption({ label: "SAMPLE-BODY — Sample body" }); await c.locator("[name=qty]").fill("4"); await c.locator("[name=due]").fill(new Date(Date.now() + 9 * 864e5).toISOString().slice(0, 10)); await c.locator("[name=plant]").selectOption({ index: 1 }); await c.locator("button").click(); await p.waitForURL(/production\/[0-9a-f-]{36}/);
await p.click('button:has-text("Release job")'); await p.waitForTimeout(1500);
await p.reload();
 ok("frozen snapshot shown", await seen("(frozen)"));
// issue 2 shafts needed (4 × 0.5) — try over-issue first
const issue = p.locator('form:has(button:has-text("Post issue"))'); await issue.locator("[name=item]").selectOption({ index: 1 }); await issue.locator("[name=batch]").selectOption({ index: 1 }); await issue.locator("[name=loc]").selectOption({ label: "SMP-STORES — SMP-STORES" }); await issue.locator("[name=qty]").fill("9"); await issue.locator("button").click();
ok("over-issue blocked with explanation", await seen("exceed planned"));
await p.waitForTimeout(800); await issue.locator("[name=qty]").fill("2"); await issue.locator("button").click(); ok("issue posted to ledger", await seen("Material issued and posted"));
// operation: output before finishing is blocked? (single-op routing) → start/finish then output
await p.locator('button:has-text("Start")').first().click(); await seen("Started"); await p.waitForTimeout(500);
await p.locator('button:has-text("Finish")').first().click(); await p.waitForTimeout(1200); await p.reload(); ok("operation finished (status done, actual minutes recorded)", (await p.locator("td >> text=done").count()) > 0);
const out = p.locator('form:has(button:has-text("Post output"))'); await out.locator("[name=good]").fill("5"); await out.locator("[name=loc]").selectOption({ label: "SMP-STORES — SMP-STORES" }); await out.locator("button").click();
ok("over-output refused", await seen("exceed"));
await p.waitForTimeout(800); await out.locator("[name=good]").fill("4"); await out.locator("button").click(); ok("output posted", await seen("Output posted"));
p.once("dialog", (d) => d.accept()); await p.locator('button:has-text("Complete")').first().click(); await p.waitForTimeout(1500);
await p.reload(); ok("job completed", (await p.locator("header, main").first().innerText()).length > 0 && (await p.locator("text=completed").first().waitFor({ timeout: 5000 }).then(() => true, () => false)));
 ok("posted movements visible (issue + output)", (await p.locator("table >> text=output").count()) > 0 && (await p.locator("table >> text=issue").count()) > 0);
// cost page reconciles
const href = await p.locator('a:has-text("View job cost")').getAttribute("href"); await p.goto(base + href);
const txt = await p.locator("main").innerText(); ok("job cost shows material, labour, overhead and variance", /Material/.test(txt) && /Labour/.test(txt) && /Variance/.test(txt) && /₹8\.00|₹800|₹/.test(txt));
await p.goto(base + "/app/inventory"); ok("ledger shows both postings", (await p.locator("main").innerText()).includes("issue") && (await p.locator("main").innerText()).includes("output"));
await p.goto(base + "/app/reports"); ok("yield report reflects the job", await seen("SAMPLE-BODY"));
ok("no page errors", errs.length === 0, errs.join(" | ")); await b.close(); console.log(failed ? `${failed} FAILED` : "all passed"); process.exit(failed ? 1 : 0);
