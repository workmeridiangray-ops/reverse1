"use server";
import { z } from "zod";
import { audit, UserError } from "@/lib/server/db";
import { dateStr, mutation, str } from "@/lib/server/actions";
import { todayIso } from "@/components/ui/Format";
import { writableProject } from "@/lib/server/queries";
import { parseQty } from "@/lib/rules/qty";
import { violatesSeparation } from "@/lib/rules/permissions";

export const recordMeasurement = mutation("measure.record", "recordMeasurement", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  if (p.status === "tender") throw new UserError("Measurements can be recorded once the project is awarded.");
  const d = z.object({ item: z.string().uuid("Choose a BOQ item"), on: dateStr, location: z.string().max(120).optional(), note: z.string().max(500).optional() })
    .parse({ item: str(fd, "boq_item_id"), on: str(fd, "measured_on"), location: str(fd, "location") || undefined, note: str(fd, "note") || undefined });
  const qty = parseQty(str(fd, "quantity"), "Quantity");
  if (qty <= 0) throw new UserError("Quantity must be greater than zero.", "quantity");
  if (d.on > todayIso()) throw new UserError("The measurement date cannot be in the future.", "measured_on");
  const item = await db.maybe<{ code: string; qty_milli: number; delta: number }>(
    `SELECT b.code, b.qty_milli, COALESCE((SELECT sum(qty_delta_milli) FROM variations v WHERE v.boq_item_id=b.id AND v.status='approved'),0)::bigint delta FROM boq_items b WHERE b.id=$1 AND b.project_id=$2`, [d.item, p.id]);
  if (!item) throw new UserError("That BOQ item is not part of this project.", "boq_item_id");
  const used = await db.one<{ q: number }>("SELECT COALESCE(sum(qty_milli),0)::bigint q FROM measurements WHERE boq_item_id=$1 AND status <> 'rejected'", [d.item]);
  if (used.q + qty > item.qty_milli + Number(item.delta)) throw new UserError(`Recorded quantity for ${item.code} would exceed the contract quantity. Raise a variation for the extra work first.`, "quantity");
  await db.exec("INSERT INTO measurements(tenant_id,project_id,boq_item_id,qty_milli,location,measured_on,note,recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [c.tenant.id, p.id, d.item, qty, d.location ?? null, d.on, d.note ?? null, c.user.id]);
  return "Measurement recorded and sent for verification.";
});

export const verifyMeasurement = mutation("measure.verify", "verifyMeasurement", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const id = z.string().uuid().parse(str(fd, "measurement_id"));
  const m = await db.one<{ status: string; recorded_by: string | null; boq_item_id: string }>("SELECT status,recorded_by,boq_item_id FROM measurements WHERE id=$1 AND project_id=$2 FOR UPDATE", [id, p.id]);
  if (m.status !== "recorded") throw new UserError(`This measurement is already ${m.status}.`);
  if (violatesSeparation(c.user.id, m.recorded_by)) throw new UserError("You recorded this measurement; a different person must verify it.");
  const hold = await db.maybe<{ number: number }>("SELECT number FROM inspections WHERE boq_item_id=$1 AND hold_point AND status <> 'passed' ORDER BY number LIMIT 1", [m.boq_item_id]);
  if (hold) throw new UserError(`Hold point: inspection #${hold.number} for this item has not passed. Verification is blocked until it does.`);
  await db.exec("UPDATE measurements SET status='verified', verified_by=$2, verified_at=now() WHERE id=$1", [id, c.user.id]);
  await audit(db, c.user.id, c.tenant.id, "measurement.verified", "measurement", id);
  return "Measurement verified.";
});

export const rejectMeasurement = mutation("measure.verify", "rejectMeasurement", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const id = z.string().uuid().parse(str(fd, "measurement_id"));
  const reason = z.string().trim().min(5, "Give a reason (at least 5 characters)").max(500).parse(str(fd, "reason"));
  const n = await db.exec("UPDATE measurements SET status='rejected', reject_reason=$2, verified_by=$3, verified_at=now() WHERE id=$1 AND project_id=$4 AND status='recorded'", [id, reason, c.user.id, p.id]);
  if (!n) throw new UserError("This measurement was already processed by someone else.");
  await audit(db, c.user.id, c.tenant.id, "measurement.rejected", "measurement", id, { reason });
  return "Measurement rejected; the recorder can see your reason.";
});
