/** Purchasing, stores, assets and patient portal through the real UI. Run after `npm run db:reset`. */
import { chromium } from "playwright";
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const PW = "tendwell-demo-pass";
const GEORGE_ADM = "a9000000-0000-4000-8000-000000000001";
const b = await chromium.launch(); let step = 0;
const ok = (m) => console.log(`PASS ${++step}. ${m}`);
async function login(email) {
  const page = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await page.goto(`${BASE}/login`); await page.fill("#email", email); await page.fill("#password", PW);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click("main button[type=submit]")]);
  return page;
}
const see = async (p, re, what) => { await p.getByText(re).first().waitFor({ timeout: 8000 }); ok(what); };
const click = (p, name) => p.getByRole("button", { name }).first().click();

// Purchasing: nurse requests -> admin approves -> admin creates PO -> second admin approves -> goods received -> bill reference
const nurse = await login("nurse@cedarlane.test");
await nurse.goto(`${BASE}/purchasing`);
await nurse.selectOption("#rq-item", { label: "Wound dressing pack (each)" }); await nurse.fill("#rq-qty", "100"); await nurse.fill("#rq-price", "4.50"); await nurse.fill("#rq-reason", "Ward 1 stock is nearly empty");
await click(nurse, "Send request"); await see(nurse, /Request sent for approval/, "nurse requests stock");
const admin = await login("admin@cedarlane.test");
await admin.goto(`${BASE}/purchasing`); await click(admin, "Approve"); await see(admin, /Request approved/, "admin approves the request");
await admin.selectOption("#po-sup", { label: "MediSupply Ltd" }); await admin.locator("input[name=request_ids]").first().check(); await click(admin, "Create draft order");
await see(admin, /second admin must approve/, "admin raises a draft purchase order"); const poUrl = admin.url().split("?")[0];
if ((await admin.getByRole("button", { name: "Approve order" }).count()) === 0) ok("the creator cannot approve their own order");
const admin2 = await login("admin2@cedarlane.test");
await admin2.goto(poUrl); await click(admin2, "Approve order"); await see(admin2, /Order approved/, "second admin approves the order");
await admin2.fill("[id^=rq-]", "60"); await admin2.fill("[id^=dn-]", "DN-9001"); await click(admin2, "Receive"); await see(admin2, /Goods received/, "goods received into the main store (partial)");
await admin2.fill("[id^=rq-]", "41"); await admin2.fill("[id^=dn-]", "DN-9002"); await click(admin2, "Receive"); await see(admin2, /Only 40 more/, "over-receipt is refused");
await admin2.fill("[id^=rq-]", "40"); await admin2.fill("[id^=dn-]", "DN-9002"); await click(admin2, "Receive"); await see(admin2, /Goods received/, "remaining goods received");
await admin2.fill("#sb-ref", "INV-5521"); await click(admin2, "Save"); await see(admin2, /bill reference saved/, "supplier bill reference recorded");

// Stores
await nurse.goto(`${BASE}/stores`);
await nurse.selectOption("#tr-item", { label: "Wound dressing pack" }); await nurse.selectOption("#tr-from", { label: "Main store" }); await nurse.selectOption("#tr-to", { label: "Ward 1 cupboard" }); await nurse.fill("#tr-qty", "20");
await click(nurse, "Transfer"); await see(nurse, /Stock transferred/, "nurse transfers stock to the ward");
await nurse.selectOption("#ct-item", { label: "Wound dressing pack" }); await nurse.selectOption("#ct-loc", { label: "Ward 1 cupboard" }); await nurse.fill("#ct-n", "17");
await click(nurse, "Record count"); await see(nurse, /reason for the difference/, "a differing count needs a reason");
await nurse.selectOption("#ct-item", { label: "Wound dressing pack" }); await nurse.selectOption("#ct-loc", { label: "Ward 1 cupboard" }); await nurse.fill("#ct-n", "17"); await nurse.fill("#ct-reason", "Three used, not recorded"); await click(nurse, "Record count"); await see(nurse, /Count recorded/, "count recorded with variance reason");

// Assets
await nurse.goto(`${BASE}/assets`);
await nurse.selectOption("#rf-asset", { label: "MON-001 · Patient monitor" }); await nurse.fill("#rf-issue", "Alarm will not silence"); await click(nurse, "Report fault");
await see(nurse, /Fault reported/, "nurse reports a fault");
await admin.goto(`${BASE}/assets`); await click(admin, "Start work"); await see(admin, /marked under maintenance/, "admin starts work; asset under maintenance");
await admin.fill("[id^=rs-]", "Replaced speaker"); await click(admin, "Resolve"); await see(admin, /downtime is recorded/, "resolved; back in service with downtime");

// Patient portal
const dr = await login("dr.okafor@cedarlane.test");
await dr.goto(`${BASE}/admissions/${GEORGE_ADM}`);
await dr.fill("#summary", "Recovered well after surgery. Walk daily, review in two weeks.");
await click(dr, "Authorise discharge");
await see(dr, /Discharge authorised/, "doctor authorises Amal-independent discharge (George)");
const ph = await login("pharmacy@cedarlane.test"); await ph.goto(`${BASE}/admissions/${GEORGE_ADM}`); await click(ph, "Mark pharmacy cleared"); await see(ph, /Clearance recorded/, "pharmacist clears pharmacy");
await nurse.goto(`${BASE}/admissions/${GEORGE_ADM}`); await click(nurse, "Mark nursing cleared"); await see(nurse, /Clearance recorded/, "nurse clears nursing");
const desk = await login("desk@cedarlane.test"); await desk.goto(`${BASE}/admissions/${GEORGE_ADM}`); await click(desk, "Mark finance cleared"); await see(desk, /Clearance recorded/, "front desk clears finance");
await click(desk, "Final discharge"); await see(desk, /Patient discharged/, "George discharged after all clearances");
await dr.goto(`${BASE}/admissions/${GEORGE_ADM}`); await see(dr, /Share with patient portal/, "doctor can share the reviewed summary");
await click(dr, "Share with patient portal"); await see(dr, /Summary shared/, "summary shared to the patient portal");
const pt = await login("amal.haddad@patient.test"); await pt.goto(`${BASE}/me`);
await see(pt, /Only information your care team has reviewed and released/, "patient portal explains release and delays");
if ((await pt.getByText("Recovered well after surgery").count()) === 0) ok("another patient's shared summary is not visible to Amal");
else { console.log("FAIL: leak"); process.exitCode = 1; }
await b.close();
console.log(process.exitCode ? "JOURNEY3 FAILED" : "JOURNEY3 PASSED");
