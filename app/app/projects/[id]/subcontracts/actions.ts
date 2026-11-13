"use server";
import { z } from "zod";
import { audit, type Db, UserError } from "@/lib/server/db";
import { dateStr, mutation, str } from "@/lib/server/actions";
import { todayIso } from "@/components/ui/Format";
import { writableProject } from "@/lib/server/queries";
import { parseMajor } from "@/lib/rules/money";
import { parsePercentBp, parseQty } from "@/lib/rules/qty";
import { subBill, woHeadroom } from "@/lib/rules/subcontract";
import { violatesSeparation } from "@/lib/rules/permissions";

export const createPackage = mutation("sub.manage", "createPackage", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const d = z.object({ name: z.string().trim().min(3, "Name the package").max(160), supplier: z.string().uuid("Choose the subcontractor") }).parse({ name: str(fd, "name"), supplier: str(fd, "supplier_id") });
  const ret = parsePercentBp(str(fd, "retention") || "5", "Retention");
  if (ret > 3000) throw new UserError("Retention above 30% is not supported.", "retention");
  await db.one("SELECT 1 FROM suppliers WHERE id=$1", [d.supplier]);
  const n = (await db.one<{ n: number }>("SELECT COALESCE(max(number),0)::int+1 n FROM sub_packages WHERE project_id=$1", [p.id])).n;
  await db.exec("INSERT INTO sub_packages(tenant_id,project_id,number,name,supplier_id,retention_bp,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)", [c.tenant.id, p.id, n, d.name, d.supplier, ret, c.user.id]);
  return `Package SP-${n} created. Add work-order lines, then award it.`;
});

export const addWoLine = mutation("sub.manage", "addWoLine", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const pkg = await db.one<{ status: string }>("SELECT status FROM sub_packages WHERE id=$1 AND project_id=$2 FOR UPDATE", [z.string().uuid().parse(str(fd, "package_id")), p.id]);
  if (pkg.status !== "draft") throw new UserError("Work-order lines can only be added while the package is a draft.");
  const item = z.string().uuid("Choose a BOQ item").parse(str(fd, "boq_item_id"));
  const qty = parseQty(str(fd, "quantity"), "Quantity"); const rate = parseMajor(str(fd, "rate"), "INR");
  if (qty <= 0) throw new UserError("Quantity must be above zero.", "quantity");
  const b = await db.one<{ code: string; qty_milli: number; delta: number; ordered: number }>(
    `SELECT b.code,b.qty_milli,COALESCE((SELECT sum(qty_delta_milli) FROM variations v WHERE v.boq_item_id=b.id AND v.status='approved'),0)::bigint delta,
            COALESCE((SELECT sum(l.qty_milli) FROM sub_wo_lines l JOIN sub_packages sp ON sp.id=l.package_id WHERE l.boq_item_id=b.id AND sp.status <> 'closed'),0)::bigint ordered
       FROM boq_items b WHERE b.id=$1 AND b.project_id=$2`, [item, p.id]);
  const room = woHeadroom(b.qty_milli + Number(b.delta), b.ordered);
  if (qty > room) throw new UserError(`${b.code}: only ${room / 1000} is left to subcontract of the contract quantity (permitted scope and approved variations).`, "quantity");
  await db.exec("INSERT INTO sub_wo_lines(tenant_id,project_id,package_id,boq_item_id,qty_milli,rate_minor) VALUES ($1,$2,$3,$4,$5,$6)", [c.tenant.id, p.id, str(fd, "package_id"), item, qty, rate]);
  return "Work-order line added.";
});

export const awardPackage = mutation("sub.manage", "awardPackage", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const id = z.string().uuid().parse(str(fd, "package_id"));
  const n = (await db.one<{ n: number }>("SELECT count(*)::int n FROM sub_wo_lines WHERE package_id=$1", [id])).n;
  if (!n) throw new UserError("Add at least one work-order line before awarding.");
  const u = await db.exec("UPDATE sub_packages SET status='awarded' WHERE id=$1 AND project_id=$2 AND status='draft'", [id, p.id]);
  if (!u) throw new UserError("Only a draft package can be awarded.");
  await audit(db, c.user.id, c.tenant.id, "subcontract.awarded", "sub_package", id);
  return "Package awarded; work orders are now live.";
});

export const prepareSubMeasurement = mutation("sub.measure", "prepSubMeas", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const line = await db.one<{ qty_milli: number; status: string }>("SELECT l.qty_milli, sp.status FROM sub_wo_lines l JOIN sub_packages sp ON sp.id=l.package_id WHERE l.id=$1 AND l.project_id=$2", [z.string().uuid().parse(str(fd, "wo_line_id")), p.id]);
  if (line.status !== "awarded") throw new UserError("Measurements can be prepared once the package is awarded.");
  const qty = parseQty(str(fd, "quantity"), "Quantity"); const on = dateStr.parse(str(fd, "measured_on"));
  if (qty <= 0) throw new UserError("Quantity must be above zero.", "quantity");
  if (on > todayIso()) throw new UserError("The date cannot be in the future.", "measured_on");
  const used = (await db.one<{ q: number }>("SELECT COALESCE(sum(qty_milli),0)::bigint q FROM sub_measurements WHERE wo_line_id=$1 AND status <> 'rejected'", [str(fd, "wo_line_id")])).q;
  if (used + qty > line.qty_milli) throw new UserError("Measured quantity would exceed the work-order quantity (tolerance is zero).", "quantity");
  await db.exec("INSERT INTO sub_measurements(tenant_id,project_id,wo_line_id,qty_milli,measured_on,location,prepared_by) VALUES ($1,$2,$3,$4,$5,$6,$7)", [c.tenant.id, p.id, str(fd, "wo_line_id"), qty, on, str(fd, "location") || null, c.user.id]);
  return "Measurement prepared for joint verification.";
});

export const advanceSubMeasurement = mutation(null, "advSubMeas", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const id = z.string().uuid().parse(str(fd, "measurement_id")); const step = str(fd, "step");
  const m = await db.one<{ status: string; prepared_by: string | null; verified_by: string | null }>("SELECT status,prepared_by,verified_by FROM sub_measurements WHERE id=$1 AND project_id=$2 FOR UPDATE", [id, p.id]);
  if (step === "reject") {
    if (!c.can("sub.verify")) throw new UserError("You cannot reject measurements.");
    const reason = z.string().trim().min(5, "Give a reason (at least 5 characters)").parse(str(fd, "reason"));
    if (!["prepared", "verified"].includes(m.status)) throw new UserError(`Measurement is already ${m.status}.`);
    await db.exec("UPDATE sub_measurements SET status='rejected', reject_reason=$2 WHERE id=$1", [id, reason]); return "Measurement rejected.";
  }
  if (step === "verify") {
    if (!c.can("sub.verify")) throw new UserError("You cannot verify measurements.");
    if (m.status !== "prepared") throw new UserError(`Measurement is already ${m.status}.`);
    if (violatesSeparation(c.user.id, m.prepared_by)) throw new UserError("You prepared this measurement; a different person must verify it.");
    await db.exec("UPDATE sub_measurements SET status='verified', verified_by=$2 WHERE id=$1", [id, c.user.id]); return "Jointly verified.";
  }
  if (step === "approve") {
    if (!c.can("sub.approve")) throw new UserError("You cannot approve measurements.");
    if (m.status !== "verified") throw new UserError("Only a verified measurement can be approved.");
    if (violatesSeparation(c.user.id, m.prepared_by) || violatesSeparation(c.user.id, m.verified_by)) throw new UserError("Preparation, verification and approval must be three different people.");
    await db.exec("UPDATE sub_measurements SET status='approved', approved_by=$2 WHERE id=$1", [id, c.user.id]);
    await audit(db, c.user.id, c.tenant.id, "sub_measurement.approved", "sub_measurement", id); return "Measurement approved for billing.";
  }
  throw new UserError("Unknown action.");
});

async function sums(db: Db, packageId: string) {
  return db.q<{ id: string; code: string; rate_minor: number; qty_milli: number; approved: number; billed: number }>(
    `SELECT l.id,b.code,l.rate_minor,l.qty_milli,
       COALESCE((SELECT sum(qty_milli) FROM sub_measurements m WHERE m.wo_line_id=l.id AND m.status='approved'),0)::bigint approved,
       COALESCE((SELECT sum(bl.qty_milli) FROM sub_bill_lines bl JOIN sub_bills sb ON sb.id=bl.bill_id WHERE bl.wo_line_id=l.id AND sb.status IN ('draft','approved')),0)::bigint billed
     FROM sub_wo_lines l JOIN boq_items b ON b.id=l.boq_item_id WHERE l.package_id=$1 ORDER BY b.code`, [packageId]);
}

export const createSubBill = mutation("sub.approve", "createSubBill", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const pid = z.string().uuid().parse(str(fd, "package_id"));
  const pkg = await db.one<{ retention_bp: number; status: string }>("SELECT retention_bp,status FROM sub_packages WHERE id=$1 AND project_id=$2 FOR UPDATE", [pid, p.id]);
  if (pkg.status !== "awarded") throw new UserError("Bills can be prepared for an awarded package.");
  const rec = parseMajor(str(fd, "recovery") || "0", "INR"); const reason = str(fd, "recovery_reason");
  if (rec > 0 && reason.length < 5) throw new UserError("Give a reason for the material recovery.", "recovery_reason");
  const lines = await sums(db, pid);
  const b = subBill(lines.map((l) => ({ id: l.id, code: l.code, rateMinor: l.rate_minor, orderedMilli: l.qty_milli, approvedMilli: l.approved, billedMilli: l.billed })), pkg.retention_bp, rec);
  const no = (await db.one<{ n: number }>("SELECT COALESCE(max(bill_no),0)::int+1 n FROM sub_bills WHERE package_id=$1", [pid])).n;
  const bill = await db.one<{ id: string }>("INSERT INTO sub_bills(tenant_id,project_id,package_id,bill_no,gross_minor,retention_minor,material_recovery_minor,recovery_reason,net_minor,prepared_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id",
    [c.tenant.id, p.id, pid, no, b.grossMinor, b.retentionMinor, rec, rec ? reason : null, b.netMinor, c.user.id]);
  for (const l of b.lines) if (l.qtyMilli > 0) await db.exec("INSERT INTO sub_bill_lines(tenant_id,project_id,bill_id,wo_line_id,qty_milli,amount_minor) VALUES ($1,$2,$3,$4,$5,$6)", [c.tenant.id, p.id, bill.id, l.id, l.qtyMilli, l.amountMinor]);
  await audit(db, c.user.id, c.tenant.id, "sub_bill.created", "sub_bill", bill.id, { gross: b.grossMinor, net: b.netMinor });
  return `Subcontract bill ${no} prepared: gross, retention, recovery and net are shown below.`;
});

export const approveSubBill = mutation("sub.approve", "approveSubBill", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const b = await db.one<{ status: string; prepared_by: string | null }>("SELECT status,prepared_by FROM sub_bills WHERE id=$1 AND project_id=$2 FOR UPDATE", [z.string().uuid().parse(str(fd, "bill_id")), p.id]);
  if (b.status !== "draft") throw new UserError(`Bill is already ${b.status}.`);
  if (violatesSeparation(c.user.id, b.prepared_by)) throw new UserError("You prepared this bill; a different person must approve it.");
  await db.exec("UPDATE sub_bills SET status='approved', approved_by=$2 WHERE id=$1", [str(fd, "bill_id"), c.user.id]);
  await audit(db, c.user.id, c.tenant.id, "sub_bill.approved", "sub_bill", str(fd, "bill_id"));
  return "Subcontract bill approved.";
});
