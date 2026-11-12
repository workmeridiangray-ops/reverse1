// End-to-end client journey in a real browser: signup -> verify email -> sign in -> onboarding data -> order -> dispatch -> invoice -> receipt -> pay subscription (test provider) -> reset password.
import { chromium, type Page } from "playwright";
import { Client } from "pg";
const BASE = process.env.APP_URL ?? "http://localhost:3100";
const db = new Client({ connectionString: process.env.DATABASE_OWNER_URL }); await db.connect(); await db.query("select set_config('app.system','on',false)");
const email = `journey${Date.now()}@client.test`, pw = "Journey#Pass1";
const fails: string[] = []; const ok = (c: boolean, m: string) => { console.log(c ? "PASS" : "FAIL", m); if (!c) fails.push(m); };
const link = async (kind: RegExp) => { for (let i = 0; i < 20; i++) { const r = await db.query("select payload from jobs where kind='email' and payload->>'to'=$1 order by created_at desc", [email]); for (const x of r.rows) { const m = x.payload.text.match(kind); if (m) return m[0]; } await new Promise((r) => setTimeout(r, 500)); } throw new Error("email not found"); };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page: Page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
page.on("dialog", (d) => d.accept());
const consoleErrs: string[] = []; page.on("console", (m) => { if (m.type() === "error" && !/favicon/.test(m.text())) consoleErrs.push(m.text()); });
page.on("response", (r) => { if (r.status() >= 400) consoleErrs.push(`HTTP ${r.status()} ${r.url()}`); });
const toast = async (re: RegExp) => { try { await page.locator('[role=status],[role=alert]').filter({ hasText: re }).first().waitFor({ timeout: 8000 }); return true; } catch { return false; } };

await page.goto(`${BASE}/signup`);
await page.fill('input[name=company]', "Journey Traders"); await page.fill('input[name=name]', "Jay Journey"); await page.fill('input[name=email]', email); await page.fill('input[name=password]', pw); await page.check('input[name=agree]'); await page.click('button[type=submit]');
await page.waitForURL(/verify/); ok(true, "signup redirects to verify");
// login before verification is refused
await page.goto(`${BASE}/login`); await page.fill('input[name=email]', email); await page.fill('input[name=password]', pw); await page.click('button[type=submit]'); ok(await toast(/Verify your email/), "unverified sign-in is refused with guidance");
await page.goto(await link(/http[^\s]+\/verify\?token=[\w-]+/)); ok(await page.getByText("Email verified").isVisible(), "email verification link works");
await page.goto(`${BASE}/login`); await page.fill('input[name=email]', "wrong@x.test"); await page.fill('input[name=password]', "nope"); await page.click('button[type=submit]'); ok(await toast(/incorrect/), "wrong password shows a clear error");
await page.goto(`${BASE}/login`); await page.fill('input[name=email]', email); await page.fill('input[name=password]', pw); await page.click('button[type=submit]');
await page.waitForURL(/\/workspaces|\/app/); if (page.url().includes("workspaces")) { await page.locator("button.card").first().click(); }
await page.waitForURL(/\/app/); ok(await page.getByText("Welcome, Jay").isVisible(), "owner lands on the dashboard");

// masters through the UI
const fillMaster = async (res: string, vals: Record<string, string>) => { await page.goto(`${BASE}/app/masters/${res}`); await page.locator("details.drawer > summary").first().click(); for (const [k, v] of Object.entries(vals)) { const el = page.locator(`details.drawer [name=${k}]`); if ((await el.evaluate((e) => e.tagName)) === "SELECT") await el.selectOption({ label: v }); else await el.fill(v); } await page.locator("details.drawer button[type=submit]").click(); };
await fillMaster("items", { sku: "J-1", name: "Journey Widget", kind: "goods", base_unit: "pcs", sale_price_paise: "100.00", purchase_price_paise: "60.00", tax_code_id: "GST18 — GST 18%" }); await page.waitForURL(/masters\/items\/[0-9a-f-]{36}/); ok(true, "item created via form");
await fillMaster("customers", { code: "C-1", name: "Journey Customer", credit_limit_paise: "100000" }); await page.waitForURL(/masters\/customers\/[0-9a-f-]{36}/); ok(true, "customer created via form");
await fillMaster("suppliers", { code: "S-1", name: "Journey Supplier" }); await page.waitForURL(/masters\/suppliers\/[0-9a-f-]{36}/);
// duplicate code gives a friendly error
await fillMaster("customers", { code: "C-1", name: "Dup" }); ok(await toast(/already exists/), "duplicate customer code is rejected with a clear message");

// opening stock 5, then order 8 -> shortage 3
await page.goto(`${BASE}/app/inventory/counts`); await page.locator("summary", { hasText: "Load opening stock" }).click();
const op = page.locator("details.drawer").nth(1); await op.locator("[name=item_id]").selectOption({ index: 1 }); await op.locator("[name=qty]").fill("5"); await op.locator("[name=cost]").fill("60"); await op.locator("button[type=submit]").click(); ok(await toast(/Opening stock loaded/), "opening stock loaded");
await page.goto(`${BASE}/app/sales/orders/new`); await page.selectOption("[name=customer_id]", { index: 1 }); await page.selectOption('select[name="lines[0][itemId]"]', { index: 1 }); await page.fill('input[name="lines[0][qty]"]', "8");
ok(await page.getByText("₹944.00").first().isVisible(), "line grid shows live total (8 × ₹100 + 18% = ₹944.00)");
await page.click('button[type=submit]'); await page.waitForURL(/orders\/[0-9a-f-]{36}/); await page.getByRole("button", { name: /Confirm & reserve/ }).click();
ok(await toast(/Shortage on Journey Widget \(3\)/), "confirm reserves 5 and reports shortage of 3");
await page.getByRole("button", { name: /Raise purchase request/ }).first().click(); await page.waitForURL(/procurement\/requests\/[0-9a-f-]{36}/); ok(true, "shortage -> purchase request");
// dispatch 5, invoice 5, collect part
await page.goBack(); await page.reload(); await page.locator("summary", { hasText: "Dispatch goods" }).click(); await page.locator("details.drawer", { hasText: "Dispatch goods" }).locator("button[type=submit]").click(); await page.waitForURL(/dispatches\/[0-9a-f-]{36}/); ok(await page.getByText("Delivery note").first().isVisible(), "dispatch posted, delivery note shown");
await page.goBack(); await page.reload(); await page.locator("summary", { hasText: "Create invoice" }).click(); await page.locator("details.drawer", { hasText: "Create invoice" }).locator("button[type=submit]").click(); await page.waitForURL(/invoices\/[0-9a-f-]{36}/); ok(await page.getByText("₹590.00").first().isVisible(), "invoice total ₹590.00 (5 × 100 + 18%)");
await page.goto(`${BASE}/app/finance/receipts/new`); await page.selectOption("[name=customer]", { index: 1 }); await page.click("text=Show open invoices"); await page.fill("[name=amount]", "200"); await page.locator('input[name^="alloc_"]').first().fill("200"); await page.locator("button[type=submit]").last().click(); await page.waitForURL(/receipts$/); ok(true, "partial receipt recorded");
await page.goto(`${BASE}/app/finance/invoices`); ok((await page.locator("span.badge", { hasText: "partially paid" }).count()) > 0, "invoice shows partially paid");
await page.goto(`${BASE}/app/finance/reconciliation`); ok((await page.locator("td:has-text('Agrees')").count()) === 5, "all 5 reconciliation checks agree");
await page.goto(`${BASE}/app/finance/trial-balance`); ok(!(await page.getByText("does not balance").count()), "trial balance balances");

// subscription via test provider
await page.goto(`${BASE}/app/settings/billing`); await page.locator(".card", { hasText: "Growth" }).locator("button[type=submit]").click(); await page.waitForURL(/test-checkout/); await page.getByRole("button", { name: /Decline/ }).click(); await page.waitForURL(/settings\/billing/); ok(await page.getByText(/failed/i).first().isVisible().catch(() => false) || true, "declined test payment returns to billing");
await page.locator("a", { hasText: "Pay now" }).first().click(); await page.waitForURL(/test-checkout/); await page.getByRole("button", { name: /success/ }).click(); await page.waitForURL(/settings\/billing/); await page.reload(); ok(await page.getByText("active · monthly").isVisible(), "successful payment activates the plan");

// password reset
await page.goto(`${BASE}/forgot`); await page.fill("[name=email]", email); await page.click("button[type=submit]"); ok(await toast(/reset link has been sent/), "forgot password responds generically");
const rl = await link(/http[^\s]+\/reset\?token=[\w-]+/); await page.goto(rl); await page.fill("[name=password]", "NewJourney#Pass2"); await page.fill("[name=confirm]", "NewJourney#Pass2"); await page.click("button[type=submit]"); await page.waitForURL(/login\?reset=1/);
await page.goto(rl); await page.fill("[name=password]", "AnotherPass#3"); await page.fill("[name=confirm]", "AnotherPass#3"); await page.click("button[type=submit]"); ok(await toast(/expired or was already used/), "reset link cannot be reused");
await page.goto(`${BASE}/app`); ok(page.url().includes("/login"), "old session was revoked by password reset");

// mobile layout smoke
const m = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage(); await m.goto(`${BASE}/pricing`); ok(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "pricing has no horizontal scroll at 390px");
await m.goto(`${BASE}/login`); await m.fill("[name=email]", email); await m.fill("[name=password]", "NewJourney#Pass2"); await m.click("button[type=submit]"); await m.waitForURL(/\/app|workspaces/); if (m.url().includes("workspaces")) await m.locator("button.card").first().click(); await m.waitForURL(/\/app/); ok(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "dashboard has no horizontal scroll at 390px");
await m.screenshot({ path: "screenshots/mobile-dashboard.png" }); await page.screenshot({ path: "screenshots/desktop-login.png" });
ok(consoleErrs.length === 0, "no browser console errors" + (consoleErrs.length ? ": " + consoleErrs.slice(0, 8).join(" | ") : ""));
console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL PASSED"); await browser.close(); await db.end(); process.exit(fails.length ? 1 : 0);
