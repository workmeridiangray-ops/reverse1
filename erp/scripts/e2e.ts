// Browser verification against a running app (APP_URL). Usage: APP_URL=http://localhost:3100 npx tsx scripts/e2e.ts
import { chromium, type Page } from "playwright";
const BASE = process.env.APP_URL ?? "http://localhost:3100"; const PW = "DemoPass#2026";
const problems: string[] = []; let checked = 0;

async function login(page: Page, email: string, password = PW) {
  await page.goto(`${BASE}/login`); await page.fill('input[name=email]', email); await page.fill('input[name=password]', password); await page.click('button[type=submit]');
  await page.waitForURL(/\/(app|workspaces|portal|login\/2fa|platform)/, { timeout: 15000 });
  if (page.url().includes("/workspaces")) { await page.waitForTimeout(500); const b = page.locator("button.card").first(); if (await b.count()) { await b.click(); await page.waitForURL(/\/(app|portal)/, { timeout: 15000 }); } }
}
async function visit(page: Page, who: string, path: string, expectDenied = false) {
  const errs: string[] = []; const h = (m: any) => { if (m.type() === "error" && !/favicon|Failed to load resource.*(401|403|404)/.test(m.text())) errs.push(m.text()); }; page.on("console", h);
  const r = await page.goto(BASE + path, { waitUntil: "networkidle" }); checked++;
  const body = await page.locator("body").innerText();
  const st = r?.status() ?? 0;
  if (!expectDenied && (st >= 400 || /Something went wrong|Application error/.test(body))) problems.push(`${who} ${path} -> ${st} ${body.slice(0, 80).replace(/\n/g, " ")}`);
  if (expectDenied && !(page.url().includes("/denied") || st === 403 || st === 404)) problems.push(`${who} ${path} should be denied but got ${st} ${page.url()}`);
  for (const e of errs) problems.push(`${who} ${path} console: ${e.slice(0, 120)}`);
  page.off("console", h);
}
async function crawlNav(page: Page, who: string) {
  await page.goto(BASE + "/app", { waitUntil: "networkidle" });
  const hrefs = await page.$$eval("nav.nav a", (as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!).filter(Boolean));
  for (const h of [...new Set(hrefs)]) await visit(page, who, h);
  return hrefs.length;
}
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctxFor = async () => (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
// roles: expect nav crawl to be clean and forbidden areas denied
const roles: [string, string[]][] = [["owner@demo.test", []], ["manager@demo.test", ["/app/settings/billing", "/app/settings/roles"]], ["sales@demo.test", ["/app/settings/audit", "/app/settings/team", "/app/inventory/transfers/x"]], ["warehouse@demo.test", ["/app/finance/invoices", "/app/sales/orders/new"]], ["accounts@demo.test", ["/app/sales/orders/new", "/app/settings/team"]], ["purchase@demo.test", ["/app/finance/invoices", "/app/inventory/counts/x"]]];
for (const [email, denied] of roles) {
  const p = await ctxFor(); await login(p, email); const n = await crawlNav(p, email);
  for (const d of denied.filter((d) => !d.endsWith("/x"))) await visit(p, email, d, true);
  console.log(`${email}: crawled ${n} nav links`); await p.context().close();
}
// public pages
const pub = await ctxFor(); for (const path of ["/", "/features", "/solutions", "/pricing", "/add-ons", "/demo", "/contact", "/help", "/updates", "/legal/terms", "/legal/privacy", "/legal/refunds", "/legal/security", "/signup", "/login", "/forgot"]) await visit(pub, "public", path);
// unauthenticated access to app redirects to login
await pub.goto(BASE + "/app/sales/orders"); await pub.waitForURL(/login/, { timeout: 5000 }).catch(() => {}); if (!pub.url().includes("/login")) problems.push("unauthenticated /app did not redirect to login");
const x = await pub.request.get(BASE + "/app/export/customers"); if (x.status() !== 401) problems.push("anonymous export not 401: " + x.status());
await pub.context().close();
console.log(`checked ${checked} pages`); console.log(problems.length ? "PROBLEMS:\n" + problems.join("\n") : "NO PROBLEMS");
await browser.close(); process.exit(problems.length ? 1 : 0);
