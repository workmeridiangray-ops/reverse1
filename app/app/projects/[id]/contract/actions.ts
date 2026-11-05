"use server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { audit, UserError } from "@/lib/server/db";
import { mutation, str } from "@/lib/server/actions";
import { boqWithDeltas, writableProject } from "@/lib/server/queries";
import { parseMajor } from "@/lib/rules/money";
import { parsePercentBp } from "@/lib/rules/qty";
import { contractValue } from "@/lib/rules/billing";

export const saveContract = mutation("contract.edit", "saveContract", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const no = z.string().min(1, "Enter the contract number").max(60).parse(str(fd, "contract_no"));
  const retention = parsePercentBp(str(fd, "retention") || "0", "Retention");
  const cap = parsePercentBp(str(fd, "retention_cap") || "0", "Retention cap");
  const recovery = parsePercentBp(str(fd, "recovery") || "0", "Advance recovery");
  const advance = parseMajor(str(fd, "advance") || "0", "INR");
  const days = Number(str(fd, "payment_days") || "30");
  if (retention > 3000 || cap > 3000) throw new UserError("Retention above 30% is not supported.", "retention");
  if (cap < retention && retention > 0 && cap > 0) throw new UserError("The retention cap cannot be lower than the retention rate.", "retention_cap");
  if (recovery > 10000) throw new UserError("Recovery rate cannot exceed 100%.", "recovery");
  if (!Number.isInteger(days) || days < 0 || days > 365) throw new UserError("Payment terms must be 0–365 days.", "payment_days");
  const existing = await db.maybe<{ status: string }>("SELECT status FROM contracts WHERE project_id=$1 FOR UPDATE", [p.id]);
  if (existing?.status === "approved") throw new UserError("The contract is approved and its terms are frozen.");
  if (existing) await db.exec("UPDATE contracts SET contract_no=$2,retention_bp=$3,retention_cap_bp=$4,advance_minor=$5,advance_recovery_bp=$6,payment_days=$7 WHERE project_id=$1", [p.id, no, retention, cap, advance, recovery, days]);
  else await db.exec("INSERT INTO contracts(tenant_id,project_id,contract_no,retention_bp,retention_cap_bp,advance_minor,advance_recovery_bp,payment_days) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [c.tenant.id, p.id, no, retention, cap, advance, recovery, days]);
  await audit(db, c.user.id, c.tenant.id, "contract.saved", "project", p.id);
  return "Contract terms saved.";
});

export const approveContract = mutation("contract.approve", "approveContract", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const k = await db.maybe<Record<string, number | string>>("SELECT * FROM contracts WHERE project_id=$1 FOR UPDATE", [p.id]);
  if (!k) throw new UserError("Save the contract terms first.");
  if (k.status === "approved") throw new UserError("The contract is already approved.");
  const boq = await boqWithDeltas(db, p.id);
  if (boq.length === 0) throw new UserError("Add or import the BOQ before approving the contract.");
  if (boq.some((b) => b.qty_milli > 0 && b.rate_minor === 0)) throw new UserError("Some BOQ items with quantity have a zero rate. Fix them before approving.");
  const value = contractValue(boq.map((b) => ({ qtyMilli: b.qty_milli, approvedDeltaMilli: 0, rateMinor: b.rate_minor })));
  const digest = createHash("sha256").update(JSON.stringify(boq.map((b) => [b.code, b.qty_milli, b.rate_minor]))).digest("hex");
  const snapshot = { contractNo: k.contract_no, retentionBp: k.retention_bp, retentionCapBp: k.retention_cap_bp, advanceMinor: k.advance_minor, advanceRecoveryBp: k.advance_recovery_bp, paymentDays: k.payment_days, contractValueMinor: value, boqSha256: digest, items: boq.length };
  await db.exec("UPDATE contracts SET status='approved', approved_by=$2, approved_at=now(), snapshot=$3 WHERE project_id=$1", [p.id, c.user.id, JSON.stringify(snapshot)]);
  await audit(db, c.user.id, c.tenant.id, "contract.approved", "project", p.id, snapshot);
  return "Contract approved. Terms and BOQ basis are now frozen.";
});
