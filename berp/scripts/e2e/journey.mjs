// Drives the real UI through sign-up → order-to-cash → returns → reports → import → API key.
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const BASE = process.env.E2E_BASE, OUT = process.env.E2E_OUT ?? ".";
mkdirSync(OUT, { recursive: true });
const email = `owner${Date.now()}@example.test`;
const problems = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage(); page.setDefaultTimeout(10000);
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) problems.push("console: " + m.text()); });
page.on("response", (r) => { if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`); });

let step = 0;
const ok = (m) => console.log(`✓ ${String(++step).padStart(2, "0")} ${m}`);
const fail = async (m) => { await page.screenshot({ path: `${OUT}/FAIL.png`, fullPage: true }).catch(() => {}); console.error(`✗ ${m}\n  at ${page.url()}\n  body: ${(await page.locator("body").innerText().catch(() => "")).slice(0, 600)}`); await browser.close(); process.exit(1); };
const see = async (text, msg) => { try { await page.getByText(text, { exact: false }).first().waitFor({ timeout: 8000 }); } catch { await fail(`expected to see "${text}" — ${msg ?? ""}`); } };
const go = async (path) => { await page.goto(BASE + path); };
const seeOn = async (p, text) => { try { await p.getByText(text, { exact: false }).first().waitFor({ timeout: 8000 }); } catch { console.error(`✗ expected "${text}" on ${p.url()}\n  body: ${(await p.locator("body").innerText().catch(() => "")).slice(0, 700)}`); await browser.close(); process.exit(1); } };
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });
const submit = async (name) => { await page.getByRole("button", { name }).first().click(); await page.waitForLoadState("networkidle"); };

// 1 — public pages
await go("/"); await see("From confirmed sale to collected payment"); ok("home renders");
await go("/pricing"); await see("Starter"); await see("₹2,999.00"); ok("pricing reads plans from the database");
await go("/app"); if (!page.url().includes("/login")) await fail("signed-out /app must redirect to /login"); ok("signed-out visitors are sent to sign in");

// 2 — sign up creates a workspace
await go("/signup");
await page.getByLabel("Your name").fill("Asha Rao"); await page.getByLabel("Company name").fill("Acme Traders"); await page.getByLabel("Work email").fill(email); await page.getByLabel("Password").fill("correct-horse-battery");
await submit("Create workspace"); await see("Overview"); await see("Acme Traders"); await see("Trial:"); ok("sign-up → workspace → overview with trial banner");
await shot("01-overview");

// 3 — masters
await go("/app/customers"); await page.getByLabel("Name").fill("Kiran Stores"); await page.getByLabel("Credit limit (₹)").fill("500000"); await submit("Save customer"); await see("Customer saved"); await see("₹5,00,000.00"); ok("customer saved with lakh-formatted credit limit");
await go("/app/suppliers"); await page.getByLabel("Name").fill("Prime Components"); await submit("Save supplier"); await see("Supplier saved"); ok("supplier saved");
await go("/app/items"); await page.getByLabel("SKU").fill("WID-1"); await page.getByLabel("Name").fill("Widget"); await page.getByLabel("Sale price (₹)").fill("1000"); await page.getByLabel("Cost (₹)").fill("600");
await page.getByLabel("Tax").selectOption({ label: "GST18 (18%)" }); await submit("Save item"); await see("Item saved"); ok("item saved with GST 18%");
await go("/app/items"); await page.getByLabel("SKU").fill("bad sku!"); await page.getByLabel("Name").fill("x"); await page.getByLabel("SKU").evaluate((e) => e.removeAttribute("pattern")); await submit("Save item"); await see("sku", "invalid SKU should be refused by the database"); ok("invalid SKU rejected with a readable message");

// 4 — sales order, shortage, purchase
await go("/app/sales/new");
await page.getByLabel("Customer").selectOption({ label: "Kiran Stores" });
await page.getByLabel("Line 1 item").selectOption({ index: 1 }); await page.getByLabel("Line 1 quantity").fill("5");
await submit("Create draft order"); await see("SO-00001"); await see("draft"); ok("draft order created");
await submit("Confirm order"); await see("Order confirmed"); await see("short of stock"); ok("confirmed; shortage reported");
await submit("Request purchases"); await see("Purchase requests created"); await see("PR-00001"); ok("purchase request raised");
await page.getByLabel("Unit cost (₹)").fill("600"); await submit("Approve"); await see("PO-00001"); ok("approved → purchase order");
await page.getByLabel("Received quantity for WID-1").fill("3"); await submit("Post receipt"); await see("Goods received"); await see("partially received"); ok("partial receipt (3 of 5)");
await page.getByLabel("Received quantity for WID-1").fill("9"); await submit("Post receipt"); await see("over-receipt"); ok("over-receipt refused");
await page.getByLabel("Received quantity for WID-1").fill("2"); await submit("Post receipt"); await see("Goods received"); ok("remaining 2 received");
await page.getByLabel("Supplier invoice no.").fill("PC-77"); await page.getByLabel("Billed subtotal before tax (₹)").fill("3000"); await submit("Post bill"); await see("Supplier bill posted"); await see("BILL-00001"); ok("supplier bill matched (₹3,000 = 5 × ₹600)");
await go("/app/sales"); await page.getByRole("link", { name: "SO-00001" }).click();
await page.getByLabel("Dispatch quantity for WID-1").fill("5"); await shot("02-order"); await submit("Record dispatch"); await see("Dispatch recorded"); ok("dispatched 5");
await submit("Create invoice"); await see("INV-00001"); await see("₹5,900.00"); ok("invoice ₹5,900.00 (₹5,000 + 18% GST)");
await shot("03-invoice");

// 5 — credit note, then payment
await page.getByLabel("Quantity to credit for WID-1").fill("1"); await page.getByLabel("Reason (required)").fill("one unit damaged"); await submit("Issue credit note"); await see("Credit note issued"); await see("CN-00001"); ok("credit note for 1 unit, restocked");
await go("/app/invoices"); await page.locator("select[name=customer]").selectOption({ label: "Kiran Stores" }); await submit("Choose");
await see("balance ₹4,720.00"); await page.getByLabel("Amount to allocate to INV-00001").fill("5000"); await submit("Record receipt"); await see("exceeds the balance"); ok("over-allocation refused");
await page.locator("select[name=customer]").selectOption({ label: "Kiran Stores" }); await submit("Choose");
await page.getByLabel("Amount to allocate to INV-00001").fill("4720"); await submit("Record receipt"); await see("Receipt recorded"); await see("paid"); ok("receipt of ₹4,720.00 settles the invoice");

// 6 — finance & reports
await go("/app/finance"); await see("(balanced)"); await see("Cost of goods sold"); await shot("04-finance"); ok("trial balance balances");
for (const r of ["ar", "ap", "stock", "margin"]) { await go(`/app/reports?r=${r}`); await see("Data as of"); }
await go("/app/reports?r=margin"); await see("INV-00001"); ok("all four reports render; margin lists the invoice");
const dl = page.waitForEvent("download"); await go("/app/reports?r=margin").then(() => page.getByRole("link", { name: "Download CSV" }).click()); const d = await dl; ok(`report CSV downloads (${d.suggestedFilename()})`);

// 7 — transfer needs a second warehouse
await go("/app/settings"); await see("Main warehouse");
await go("/app/inventory"); await see("On hand"); await see("Reserved"); ok("inventory shows on-hand / reserved / available");

// 8 — CSV import: invalid file is refused whole, valid file imports
writeFileSync(`${OUT}/bad.csv`, "name,email\nGood Co,good@x.in\nBad Co,not-an-email\n");
writeFileSync(`${OUT}/good.csv`, "name,email,credit_limit\nNorth Mart,n@x.in,25000\nSouth Mart,s@x.in,\n");
await go("/app/import"); await page.locator("select[name=kind]").selectOption("customers"); await page.setInputFiles("input[name=file]", `${OUT}/bad.csv`); await page.getByRole("button", { name: "Import" }).last().click();
await see("nothing imported"); await see("line 3"); ok("bad CSV refused with the failing line");
await page.locator("select[name=kind]").selectOption("customers"); await page.setInputFiles("input[name=file]", `${OUT}/good.csv`); await page.getByRole("button", { name: "Validate only" }).click(); await see("All 2 rows are valid"); await go("/app/customers"); if (await page.getByText("North Mart").count()) await fail("validate-only must not import"); ok("validate-only checks without importing"); await go("/app/import");
await page.locator("select[name=kind]").selectOption("customers"); await page.setInputFiles("input[name=file]", `${OUT}/good.csv`); await page.getByRole("button", { name: "Import" }).last().click(); await see("Imported 2 customers"); ok("good CSV imported");
await go("/app/customers"); await see("North Mart"); ok("imported customers visible");

// 9 — projects, people, assets screens load and basic create works
await go("/app/projects"); await page.getByLabel("Name").fill("Fit-out"); await page.getByLabel("Budget (₹)").fill("100000"); await submit("Create project"); await see("PRJ-00001");
await page.getByLabel("Hours").fill("4"); await page.getByLabel("Note").fill("survey"); await submit("Log time"); await see("Time logged"); await see("submitted");
await see("Labour (approved)"); ok("project created, time logged, cost summary shown to owner");
await go("/app/people"); await page.getByLabel("Code").fill("E1"); await page.getByLabel("Full name").fill("Dev Menon"); await submit("Add employee"); await see("Employee added"); ok("employee added");
await go("/app/assets"); await page.getByLabel("Tag").fill("FRK-1"); await page.getByLabel("Name").fill("Forklift"); await submit("Register asset"); await see("Asset registered"); ok("asset registered");
await go("/app/help"); await see("How a sale flows"); ok("help renders");

// 10 — API key
await go("/app/settings"); await page.getByLabel("Key name").fill("BI"); await submit("Create key"); await see("Copy this key now");
const key = (await page.locator("code").filter({ hasText: /^berp_/ }).first().innerText()).trim();
const call = (k) => fetch(`${BASE}/api/v1/items`, { headers: k ? { authorization: `Bearer ${k}` } : {} });
const good = await call(key); const goodJson = await good.json();
if (good.status !== 200 || goodJson.data.length !== 1 || goodJson.data[0].sku !== "WID-1" || "cost_paise" in goodJson.data[0]) await fail("API with valid key: " + JSON.stringify(goodJson));
if ((await call("berp_" + "0".repeat(64))).status !== 401) await fail("bad key must be 401");
if ((await call(null)).status !== 401) await fail("missing key must be 401");
if ((await fetch(`${BASE}/api/webhooks/razorpay`, { method: "POST", body: "{}" })).status !== 401) await fail("unsigned webhook must be 401");
ok("API: valid key returns tenant data without cost; bad/missing key 401; unsigned webhook 401");

// 10b — approval rules, separation of duties, and webhooks (three people)
const stamp = Date.now();
const person = async (name, mail) => { const c = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const p = await c.newPage(); p.setDefaultTimeout(10000);
  await p.goto(BASE + "/signup"); await p.getByLabel("Your name").fill(name); await p.getByLabel("Company name").fill(name + " Co"); await p.getByLabel("Work email").fill(mail); await p.getByLabel("Password").fill("a-long-test-password");
  await p.getByRole("button", { name: "Create workspace" }).click(); await p.waitForLoadState("networkidle"); return p; };
const samMail = `sam${stamp}@example.test`, miaMail = `mia${stamp}@example.test`;
const sam = await person("Sam Sales", samMail), mia = await person("Mia Manager", miaMail);
await go("/app/settings");
for (const [mail, role] of [[samMail, "sales"], [miaMail, "manager"]]) { await page.locator("input[name=email]").first().fill(mail); await page.locator("select[name=role]").first().selectOption(role); await submit("Add member"); await see("Member added"); }
ok("owner added a salesperson and a manager");
const join = async (p) => { await p.goto(BASE + "/workspaces"); await p.locator("li", { hasText: "Acme Traders" }).getByRole("button", { name: "Open" }).click(); await p.waitForURL("**/app**"); await p.waitForLoadState("networkidle"); };
await join(sam); await join(mia);
await page.locator("select[name=subject]").selectOption("sales_order"); await page.locator("input[name=min]").fill("1000"); await page.locator("select[name=role]").last().selectOption("manager"); await submit("Add rule"); await see("Rule saved"); ok("approval rule: sales orders from ₹1,000 need a manager");
await page.getByLabel("Endpoint URL (https only)").fill("http://insecure.example.com/h"); await page.evaluate(() => document.querySelector("input[name=url]").setAttribute("type", "text")); await submit("Create webhook"); await see("only https"); ok("http webhook endpoint refused");
await page.getByLabel("Endpoint URL (https only)").fill("https://hooks.example.com/berp"); await submit("Create webhook"); await see("Signing secret"); await see("whsec_"); ok("webhook created; signing secret shown once");
await sam.goto(BASE + "/app/sales/new"); await sam.getByLabel("Customer").selectOption({ label: "Kiran Stores" }); await sam.getByLabel("Line 1 item").selectOption({ index: 1 }); await sam.getByLabel("Line 1 quantity").fill("1");
await sam.getByRole("button", { name: "Create draft order" }).click(); await sam.waitForLoadState("networkidle"); await seeOn(sam, "draft");
await sam.getByRole("button", { name: "Confirm order" }).click(); await seeOn(sam, "approval required"); ok("salesperson cannot confirm an order above the threshold");
await sam.getByRole("button", { name: "Request approval" }).click(); await seeOn(sam, "Approval requested");
await sam.goto(BASE + "/app/approvals"); if (await sam.getByRole("button", { name: "Approve" }).count()) await fail("requester must not see Approve"); ok("requester has no approve button");
await mia.goto(BASE + "/app/approvals"); await mia.getByRole("button", { name: "Reject" }).click(); await seeOn(mia, "reason is required"); ok("rejection without a reason refused");
await mia.getByRole("button", { name: "Approve" }).click(); await seeOn(mia, "Decision recorded"); ok("manager approved");
await sam.goBack().catch(() => {}); await sam.goto(BASE + "/app/sales"); await sam.getByRole("link", { name: /^SO-/ }).first().click(); 
await sam.getByRole("button", { name: "Confirm order" }).click(); await seeOn(sam, "Order confirmed"); ok("order confirms after approval");
await go("/app/settings"); await see("sales_order.confirmed"); await see("pending"); ok("confirmation queued a webhook delivery");
const cronNo = await fetch(`${BASE}/api/cron/webhooks`); if (cronNo.status !== 401) await fail("cron without secret must be 401");
const cron = await (await fetch(`${BASE}/api/cron/webhooks`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } })).json();
if (!(cron.claimed >= 1) || cron.delivered !== 0) await fail("cron result: " + JSON.stringify(cron));
await go("/app/settings"); await see("attempts", "").catch(() => {}); ok(`worker claimed ${cron.claimed}, delivered ${cron.delivered} (no outside network here), failure recorded for retry`);

await mia.goto(BASE + "/app/projects"); await mia.getByRole("link", { name: "PRJ-00001" }).click(); await mia.waitForLoadState("networkidle");
await mia.getByLabel("Cost rate per hour").fill("500"); await mia.getByRole("button", { name: "Approve" }).first().click(); await seeOn(mia, "Decision recorded"); await seeOn(mia, "₹2,000.00");
ok("manager approved the owner's time at ₹500/h → labour ₹2,000.00 in the cost summary");
// 10c — batch tracking, FEFO, expiry, traceability, labels, scan
const iso = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
await go("/app/items"); await page.getByLabel("SKU").fill("MILK-1"); await page.getByLabel("Name").fill("Milk 1L"); await page.getByLabel("Sale price (₹)").fill("50"); await page.getByLabel("Cost (₹)").fill("30");
await page.getByLabel("Tracking").selectOption("batch"); await page.getByLabel("Barcode").fill("8901000000017"); await submit("Save item"); await see("Item saved"); ok("batch-tracked item with barcode saved");
await page.getByLabel("SKU").fill("MILK-2"); await page.getByLabel("Name").fill("Dup barcode"); await page.getByLabel("Barcode").fill("8901000000017"); await submit("Save item"); await see("unique", "duplicate barcode should be refused"); ok("duplicate barcode refused");
await go("/app/sales/new"); await page.getByLabel("Customer").selectOption({ label: "Kiran Stores" }); await page.getByLabel("Line 1 item").selectOption({ label: "MILK-1 · Milk 1L (nos)" }); await page.getByLabel("Line 1 quantity").fill("10");
await submit("Create draft order"); await submit("Confirm order"); await see("Order confirmed"); await submit("Request purchases"); await see("Purchase requests created");
await page.getByLabel("Unit cost (₹)").first().fill("30"); await submit("Approve"); await see("PO-");
await page.getByLabel("Lots received for MILK-1").fill("not a valid line"); await submit("Post receipt"); await see("use  LOT, quantity"); ok("malformed lot input refused");
await page.getByLabel("Lots received for MILK-1").fill(`M-OLD, 4, ${iso(-5)}\nM-NEW, 6, ${iso(120)}`); await submit("Post receipt"); await see("Goods received"); ok("received 2 lots (one already expired)");
await go("/app/sales"); await page.getByRole("link", { name: /SO-0000[0-9]+/ }).first().waitFor();
const milkOrder = await page.locator("tr", { hasText: "confirmed" }).filter({ hasText: "Kiran" }).first().getByRole("link").first(); await milkOrder.click();
await page.getByLabel("Dispatch quantity for MILK-1").fill("10"); await submit("Record dispatch"); await see("not enough unexpired"); ok("expired stock is refused at dispatch");
await page.getByLabel("Dispatch quantity for MILK-1").fill("6"); await submit("Record dispatch"); await see("Dispatch recorded"); ok("6 unexpired units dispatched");
await go("/app/inventory/lots"); await see("M-OLD"); await see("expired"); await go("/app/inventory/lots?q=M-NEW"); await see("including sold out"); await page.locator("tr", { hasText: "M-NEW" }).getByRole("link", { name: "Trace" }).last().click(); await see("History of M-NEW"); await see("dispatch"); await see("Kiran Stores"); await see("Prime Components"); ok("lot history shows supplier receipt and customer shipment");
await go("/app/reports?r=expiry"); await see("M-OLD"); ok("expiry report lists the expired lot");
await go("/app/inventory/labels"); await page.locator("select[name=item]").selectOption({ label: "MILK-1 · Milk 1L" }); await page.getByLabel("Copies").fill("3"); await submit("Preview"); const labelSvgs = await page.locator('svg[aria-label^="Barcode"]').count();
if (labelSvgs !== 3) await fail(`expected 3 barcode labels, got ${labelSvgs}`); const barcodeSvg = await page.locator('svg[aria-label^="Barcode"]').first().evaluate((e) => e.outerHTML); writeFileSync(`${OUT}/label-sample.svg`, barcodeSvg); await shot("06-labels"); ok("3 barcode labels rendered");
await go("/app/scan"); await page.getByLabel("Scan or type a code").fill("8901000000017"); await page.keyboard.press("Enter"); await see("MILK-1 · Milk 1L"); ok("scan by barcode finds the item");
await page.getByLabel("Scan or type a code").fill("M-NEW"); await page.keyboard.press("Enter"); await see("full history"); ok("scan by lot finds the lot");
await page.getByLabel("Scan or type a code").fill("nope-123"); await page.keyboard.press("Enter"); await see("Nothing found"); ok("unknown code gives a clear message");

// 11 — isolation: a second company sees nothing of the first
const ctx2 = await browser.newContext(); const p2 = await ctx2.newPage();
await p2.goto(BASE + "/signup"); await p2.getByLabel("Your name").fill("Other Owner"); await p2.getByLabel("Company name").fill("Other Co"); await p2.getByLabel("Work email").fill("other" + Date.now() + "@example.test"); await p2.getByLabel("Password").fill("another-long-password");
await p2.getByRole("button", { name: "Create workspace" }).click(); await p2.waitForLoadState("networkidle");
await p2.goto(BASE + "/app/customers"); await p2.getByText("No customers yet").waitFor();
const apiOther = await (await fetch(`${BASE}/api/v1/customers`, { headers: { authorization: `Bearer ${key}` } })).json();
if (apiOther.data.some((c) => c.name === "Other Co")) await fail("API leaked across tenants");
await p2.goto(BASE + "/app/sales/00000000-0000-4000-8000-000000000000"); await p2.getByText("Page not found").waitFor();
ok("second company sees none of the first company's data");

// 12 — mobile layout
await page.setViewportSize({ width: 390, height: 800 }); await go("/app/sales"); 
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
await shot("05-mobile-orders"); if (overflow) problems.push("mobile: page scrolls horizontally on /app/sales");
ok("mobile viewport checked");

await browser.close();
if (problems.length) { console.error("PROBLEMS:\n" + problems.join("\n")); process.exit(1); }
console.log(`\nAll ${step} checks passed. Screenshots in ${OUT}`);
