/** Captures marketing screenshots of the demo data (synthetic patients only). Needs the app running and a freshly seeded database. */
import { chromium } from "playwright";
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const OUT = new URL("../docs/screenshots/", import.meta.url).pathname;
const SHOTS = [
  ["home", null, "/"], ["features", null, "/features"],
  ["ward-census", "nurse@cedarlane.test", "/wards"],
  ["admission-discharge", "admin@cedarlane.test", "/admissions/a9000000-0000-4000-8000-000000000001"],
  ["reception-board", "desk@cedarlane.test", "/reception"],
  ["invoice", "desk@cedarlane.test", "/billing/a6000000-0000-4000-8000-000000000001"],
  ["tariffs", "admin@cedarlane.test", "/billing/tariffs"],
  ["lab-queue", "lab@cedarlane.test", "/lab"],
  ["pharmacy-stock", "pharmacy@cedarlane.test", "/pharmacy/stock"],
  ["pharmacy-dispense", "pharmacy@cedarlane.test", "/pharmacy/prescriptions/a5000000-0000-4000-8000-000000000001"],
  ["theatre-procedure", "nurse@cedarlane.test", "/theatre/b0a00000-0000-4000-8000-000000000001"],
  ["stores", "nurse@cedarlane.test", "/stores"],
  ["assets", "admin@cedarlane.test", "/assets"],
  ["patient-portal", "amal.haddad@patient.test", "/me"],
];
const MOBILE = ["home", "ward-census", "patient-portal", "pharmacy-dispense"];
const b = await chromium.launch();
for (const mobile of [false, true]) {
  const ctxs = new Map();
  for (const [name, user, path] of SHOTS) {
    if (mobile && !MOBILE.includes(name)) continue;
    const key = user ?? "anon";
    let page = ctxs.get(key);
    if (!page) {
      const ctx = await b.newContext(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
      page = await ctx.newPage();
      if (user) { await page.goto(`${BASE}/login`); await page.fill("#email", user); await page.fill("#password", "tendwell-demo-pass");
        await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click("main button[type=submit]")]); }
      ctxs.set(key, page);
    }
    await page.goto(`${BASE}${path}`); await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}${name}${mobile ? "-mobile" : ""}.png`, fullPage: !mobile ? true : false });
    console.log("saved", name + (mobile ? "-mobile" : ""));
  }
}
await b.close();
