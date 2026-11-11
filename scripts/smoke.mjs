/**
 * Browser smoke + accessibility check against a running dev server and the
 * seeded local database:  npm run dev  &&  node scripts/smoke.mjs
 *
 * For every role it signs in, visits that role's screens, and fails on:
 *   - any WCAG 2.1 A/AA violation reported by axe-core
 *   - any page error / console error
 *   - landing somewhere other than the expected route (role routing)
 */
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const PASSWORD = "tendwell-demo-pass";
const A = "a2000000-0000-4000-8000-000000000001";

const PLAN = [
  ["desk@cedarlane.test", ["/reception", "/patients", `/patients/${A}`, `/patients/${A}/edit`, "/patients/new", "/appointments", "/appointments/new",
    "/appointments/a3000000-0000-4000-8000-000000000008", "/billing", "/billing/new", "/billing/a6000000-0000-4000-8000-000000000001"]],
  ["dr.okafor@cedarlane.test", ["/doctor", "/admissions", "/admissions/a9000000-0000-4000-8000-000000000001", "/doctor/notes/a4000000-0000-4000-8000-000000000001", "/doctor/notes/a4000000-0000-4000-8000-000000000002", "/appointments"]],
  ["admin@cedarlane.test", ["/admin", "/admin/audit", "/admin/wards", "/wards", "/admissions", "/admissions/a9000000-0000-4000-8000-000000000001"]],
  ["nurse@cedarlane.test", ["/wards", "/admissions", "/admissions/a9000000-0000-4000-8000-000000000001", "/admissions/a9000000-0000-4000-8000-000000000002"]],
  ["lab@cedarlane.test", ["/lab"]],
  ["pharmacy@cedarlane.test", ["/pharmacy"]],
  ["amal.haddad@patient.test", ["/me"]],
];
// Role routing: these must bounce to the role's home.
const FORBIDDEN = [
  ["amal.haddad@patient.test", "/reception", "/me"],
  ["dr.okafor@cedarlane.test", "/billing", "/doctor"],
  ["lab@cedarlane.test", "/patients", "/lab"],
  ["desk@cedarlane.test", "/admin", "/reception"],
  ["nurse@cedarlane.test", "/billing", "/wards"],
  ["lab@cedarlane.test", "/wards", "/lab"],
];

let failures = 0;
const browser = await chromium.launch();
async function signedIn(email) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("404") && errors.push(m.text()));
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click("main button[type=submit]")]);
  return { ctx, page, errors };
}

for (const [email, paths] of PLAN) {
  const { ctx, page, errors } = await signedIn(email);
  for (const path of paths) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    const landed = new URL(page.url()).pathname;
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).disableRules(["region"]).analyze();
    const bad = axe.violations;
    const ok = landed === path && bad.length === 0 && errors.length === 0;
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${email.padEnd(28)} ${path}${landed !== path ? `  -> landed on ${landed}` : ""}`);
    for (const v of bad) console.log(`        axe ${v.impact}: ${v.id} - ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0]?.target}`);
    for (const e of errors.splice(0)) console.log(`        error: ${e.slice(0, 200)}`);
  }
  await ctx.close();
}
for (const [email, path, home] of FORBIDDEN) {
  const { ctx, page } = await signedIn(email);
  await page.goto(`${BASE}${path}`);
  const landed = new URL(page.url()).pathname;
  const ok = landed === home;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${email.padEnd(28)} ${path} redirected to ${landed}`);
  await ctx.close();
}
// Signed out: everything goes to login.
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/patients`);
  const ok = new URL(page.url()).pathname === "/login";
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  signed out                   /patients redirected to login`);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  if (axe.violations.length) { failures++; console.log("FAIL  login page axe", axe.violations.map((v) => v.id)); }
  await ctx.close();
}
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll smoke and accessibility checks passed");
process.exit(failures ? 1 : 0);
