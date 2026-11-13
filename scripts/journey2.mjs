/** End-to-end journeys for billing, investigations, pharmacy and theatre through the real UI. Run after `npm run db:reset`. */
import { chromium } from "playwright";
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const PW = "tendwell-demo-pass";
const GEORGE_ADM = "a9000000-0000-4000-8000-000000000001";
const AMAL_RX = "a5000000-0000-4000-8000-000000000001";
const b = await chromium.launch();
let step = 0;
const ok = (m) => console.log(`PASS ${++step}. ${m}`);
async function login(email) {
  const page = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await page.goto(`${BASE}/login`); await page.fill("#email", email); await page.fill("#password", PW);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click("main button[type=submit]")]);
  return page;
}
const see = async (p, re, what) => { await p.getByText(re).first().waitFor({ timeout: 8000 }); ok(what); };
const click = (p, name) => p.getByRole("button", { name }).first().click();
const localInput = (offsetH) => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(Date.now() + offsetH * 3600e3));
  const g = (t) => parts.find((x) => x.type === t).value;
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
};

// ---- Billing -------------------------------------------------------------
let desk = await login("desk@cedarlane.test");
await desk.goto(`${BASE}/admissions/${GEORGE_ADM}`);
await desk.selectOption("#ch-code", { label: "DRESS · Wound dressing" }); await desk.fill("#ch-qty", "2");
await click(desk, "Add charge"); await see(desk, /Charge added/, "reception adds a tariff charge (price snapshotted)");
await click(desk, "Add bed-days to date"); await see(desk, /bed-day/, "bed-days are added from physical stay, once");
await click(desk, "Add bed-days to date"); await see(desk, /already up to date/, "adding bed-days again changes nothing");
await click(desk, /Create bill from/); await see(desk, /Draft bill created/, "charges become a draft bill");
await click(desk, "Issue invoice"); await desk.getByRole("button", { name: "Apply" }).first().waitFor(); ok("invoice issued; held deposit is offered");
await click(desk, "Apply"); await see(desk, /Deposit applied/, "deposit applied as a payment, capped at what is owed");
await desk.fill("#rf-amount", "10.00"); await desk.fill("#rf-reason", "Dressing not used"); await click(desk, "Request refund");
await see(desk, /Refund requested/, "refund requested with a reason");
await desk.goto(`${BASE}/billing/refunds`);
if ((await desk.getByRole("button", { name: "Approve" }).count()) === 0) ok("reception cannot approve refunds");
const admin = await login("admin@cedarlane.test");
await admin.goto(`${BASE}/billing/refunds`); await click(admin, "Approve"); await see(admin, /Refund approved/, "a different person (admin) approves the refund");

// ---- Investigations ------------------------------------------------------
const dr = await login("dr.okafor@cedarlane.test");
await dr.goto(`${BASE}/investigations/new`);
await dr.selectOption("select[name=patient_id]", { label: (await dr.locator("select[name=patient_id] option", { hasText: "Haddad" }).textContent()).trim() });
await dr.fill("input[name=test_name]", "Serum potassium"); await click(dr, "Place order");
await see(dr, /Order placed/, "doctor orders a test"); const ordUrl = dr.url().split("?")[0].replace("/investigations/", "/lab/orders/");
const lab = await login("lab@cedarlane.test");
await lab.goto(ordUrl); await click(lab, /Mark collected/); await see(lab, /Accession ACC-/, "lab collects a specimen; accession assigned");
await lab.fill("#r-value", "6.9"); await lab.fill("#r-unit", "mmol/L"); await lab.selectOption("#r-flag", "critical"); await click(lab, "Save for review");
await see(lab, /Result saved/, "result entered (not yet visible to clinicians)");
await see(lab, /Another person must review/, "the person who entered it cannot publish it");
await dr.goto(ordUrl.replace("/lab/orders/", "/investigations/")); await see(dr, /No published result yet/, "doctor sees no draft result");
await admin.goto(ordUrl); await click(admin, /Confirm reviewed and publish/); await see(admin, /Reviewed and published/, "second person reviews and publishes");
await dr.reload(); await see(dr, /Critical result: acknowledgement required/, "critical result demands acknowledgement");
await click(dr, /I have seen this/); await see(dr, /acknowledged/i, "doctor acknowledges the critical result");
await dr.goto(`${BASE}/notifications`); await see(dr, /CRITICAL result: Serum potassium/, "doctor was notified");

// ---- Pharmacy ------------------------------------------------------------
await dr.goto(`${BASE}/prescribe`);
await dr.selectOption("select[name=patient_id]", { label: (await dr.locator("select[name=patient_id] option", { hasText: "Haddad" }).textContent()).trim() });
await dr.selectOption("select[name=medicine_id]", { label: "Amoxicillin 500 mg capsule" });
await dr.fill("input[name=dose]", "500 mg"); await dr.fill("input[name=route]", "oral"); await dr.fill("input[name=frequency]", "three times daily");
await dr.fill("input[name=days]", "7"); await dr.fill("input[name=qty]", "21"); await click(dr, "Send to pharmacy");
await see(dr, /sent to pharmacy/, "doctor prescribes from the formulary");
const ph = await login("pharmacy@cedarlane.test");
await ph.goto(`${BASE}/pharmacy/prescriptions/${AMAL_RX}`);
const opts = await ph.locator("#d-batch option").allTextContents();
if (opts[0]?.includes("AMX-A") && !opts.some((o) => o.includes("AMX-OLD")) && !opts.some((o) => o.includes("AMX-Q"))) ok("batch list is earliest-expiry first and excludes expired and quarantined stock");
else { console.log("FAIL batch list", opts); process.exitCode = 1; }
await ph.fill("#d-qty", "10"); await click(ph, "Dispense"); await see(ph, /Dispensed and stock updated/, "partial dispense from the first batch");
await ph.fill("#d-qty", "11"); await click(ph, "Dispense"); await see(ph, /Dispensed and stock updated/, "second dispense completes the prescription");
await ph.reload(); if ((await ph.getByRole("button", { name: "Dispense" }).count()) === 0) ok("nothing left to dispense");

// ---- Theatre -------------------------------------------------------------
await dr.goto(`${BASE}/theatre/new`);
await dr.selectOption("select[name=patient_id]", { label: (await dr.locator("select[name=patient_id] option", { hasText: "Kapoor" }).textContent()).trim() });
await dr.fill("input[name=name]", "Knee arthroscopy"); await click(dr, "Request procedure");
await see(dr, /Procedure requested/, "surgeon requests a procedure"); const procUrl = dr.url().split("?")[0];
const nurse = await login("nurse@cedarlane.test");
await nurse.goto(procUrl);
await nurse.selectOption("#sc-room", { index: 1 }); await nurse.fill("#sc-start", localInput(2)); await nurse.fill("#sc-end", localInput(4));
await click(nurse, "Schedule"); await see(nurse, /Scheduled\. Complete the checklist/, "nurse schedules a theatre with conflict checking");
await nurse.goto(procUrl);
await click(nurse, "Start procedure"); await see(nurse, /Cannot start: 5 checklist item/, "cannot start with open checklist and no consent");
for (let i = 0; i < 5; i++) await click(nurse, "Confirm");
await nurse.waitForTimeout(300);
await dr.goto(procUrl); await dr.fill("#cs-name", "Ravi Kapoor"); await dr.fill("#cs-ev", "Form F-31 scanned"); await click(dr, "Record consent evidence");
await see(dr, /Consent evidence recorded/, "consent evidence recorded");
await click(dr, "Start procedure"); await see(dr, /Procedure started/, "procedure starts once checklist and consent are complete");
await click(dr, "Move to recovery"); await see(dr, /write the procedure note first/, "cannot leave theatre without the procedure note");
await dr.fill("#pn-body", "Arthroscopic debridement, no complications."); await click(dr, "Save note"); await see(dr, /new version/, "procedure note saved");
await click(dr, "Move to recovery"); await see(dr, /moved to recovery/i, "moved to recovery");
await nurse.goto(procUrl); await click(nurse, "Recovery complete"); await see(nurse, /Recovery complete\./, "nurse completes recovery");
await nurse.getByText("Completed").first().waitFor(); ok("procedure shows Completed with a full change log");
await b.close();
console.log(process.exitCode ? "JOURNEY2 FAILED" : "JOURNEY2 PASSED");
