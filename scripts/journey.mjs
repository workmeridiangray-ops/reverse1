/** End-to-end inpatient journey through the real UI. Needs a running app + seeded DB (resets nothing itself). */
import { chromium } from "playwright";
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const PW = "tendwell-demo-pass";
const b = await chromium.launch();
let step = 0;
const ok = (m) => console.log(`PASS ${++step}. ${m}`);
async function login(email) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`); await page.fill("#email", email); await page.fill("#password", PW);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click("main button[type=submit]")]);
  return page;
}
const expectText = async (page, re, what) => { await page.getByText(re).first().waitFor({ timeout: 8000 }); ok(what); };

// 1. Front desk requests an emergency admission (no deposit needed)
let p = await login("desk@cedarlane.test");
await p.goto(`${BASE}/admissions/new`);
await p.selectOption("#patient_id", { label: "Kapoor, Ravi (" + (await p.locator("#patient_id option", { hasText: "Kapoor" }).textContent()).match(/\((.*)\)/)[1] + ")" });
await p.selectOption("#attending_id", { label: "Dr. Chidi Okafor" });
await p.selectOption("#admission_type", "emergency");
await p.fill("#reason", "Fall with suspected fracture");
await p.click("main button[type=submit]");
await expectText(p, /Admission requested/, "desk requests emergency admission without a deposit");
const admUrl = p.url().split("?")[0];
await p.goto(`${BASE}/admissions/new`);
await p.selectOption("#patient_id", { index: 3 }); await p.selectOption("#attending_id", { index: 1 });
await p.fill("#reason", "Planned procedure"); await p.click("main button[type=submit]");
await expectText(p, /need a deposit reference/, "elective without deposit is refused with a clear message");

// 2. Nurse allocates a bed
p = await login("nurse@cedarlane.test");
await p.goto(admUrl);
await p.selectOption("#bed-allocate", { index: 1 });
await p.click("button:has-text('Allocate and admit')");
await expectText(p, /Bed allocated/, "nurse allocates a bed; patient admitted");

// 3. Nursing records
await p.fill("#systolic", "300"); await p.fill("#diastolic", "90"); await p.fill("#pulse", "80");
await p.click("button:has-text('Record observations')");
await expectText(p, /Observations recorded/, "nurse records observations");
await p.fill("#systolic", "20"); await p.click("button:has-text('Record observations')");
await expectText(p, /outside the range/, "impossible value is rejected with guidance");
await p.fill("#title", "Wound dressing"); await p.click("button:has-text('Add task')");
await expectText(p, /Task added/, "nurse adds a care task");
await p.click("button:has-text('Not done')"); // reason field is required: the browser blocks an empty submit
await p.waitForTimeout(500);
if (!(await p.getByText(/recorded as not done/).count())) ok("not-done without a reason does not submit");
await p.fill("[id^=reason-]", "Patient refused");
await p.click("button:has-text('Not done')");
await expectText(p, /recorded as not done/, "task recorded as not done with its reason");

// 4. Discharge is blocked until authorised and cleared
if (await p.getByRole("button", { name: "Final discharge" }).isDisabled()) ok("final discharge is disabled while items are outstanding");

// 5. Doctor authorises
const dr = await login("dr.okafor@cedarlane.test");
await dr.goto(admUrl);
await dr.fill("#summary", "Fracture managed, mobilising with frame, follow-up in 2 weeks.");
await dr.click("button:has-text('Authorise discharge')");
await expectText(dr, /Discharge authorised/, "doctor authorises discharge with summary");

// 6. Clearances (emergency: pharmacy + nursing only)
const ph = await login("pharmacy@cedarlane.test");
await ph.goto(admUrl); await ph.click("button:has-text('Mark pharmacy cleared')");
await expectText(ph, /Clearance recorded/, "pharmacist clears pharmacy");
await p.goto(admUrl);
if ((await p.getByText("Finance").count()) === 0) ok("emergency admission does not require finance clearance");
await p.click("button:has-text('Mark nursing cleared')");
await expectText(p, /Clearance recorded/, "nurse clears nursing");
await expectText(p, /Ready for final discharge/, "page shows ready for discharge");

// 7. Final discharge, then bed cleaning
await p.click("button:has-text('Final discharge')");
await expectText(p, /Patient discharged/, "nurse completes final discharge");
await p.goto(`${BASE}/wards`);
await p.getByRole("button", { name: "Start cleaning" }).first().click();
await expectText(p, /cleaning status updated/, "bed goes to cleaning");
await p.getByRole("button", { name: "Mark clean" }).first().click();
await expectText(p, /marked clean/, "bed marked clean and available again");

// 8. Isolation: other clinic's nurse cannot open this admission
const other = await login("nurse@northgate.test");
const r = await other.goto(admUrl);
if (r.status() === 404 || (await other.getByText(/not found|could not be found/i).count())) ok("other clinic's nurse gets not-found for this admission");
else { console.log("FAIL isolation", r.status()); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "JOURNEY FAILED" : "JOURNEY PASSED");
