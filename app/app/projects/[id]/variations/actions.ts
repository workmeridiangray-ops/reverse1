"use server";
import { z } from "zod";
import { audit, UserError } from "@/lib/server/db";
import { mutation, str } from "@/lib/server/actions";
import { writableProject } from "@/lib/server/queries";
import { amountFor, parseSignedQty } from "@/lib/rules/qty";
import { violatesSeparation } from "@/lib/rules/permissions";

export const createVariation = mutation("variation.request", "createVariation", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  if (p.status !== "active" && p.status !== "handover") throw new UserError("Variations can be raised on an active project.");
  const d = z.object({ title: z.string().trim().min(3, "Give the variation a title").max(160), item: z.string().uuid("Choose the affected BOQ item"), description: z.string().max(1000).optional() })
    .parse({ title: str(fd, "title"), item: str(fd, "boq_item_id"), description: str(fd, "description") || undefined });
  const delta = parseSignedQty(str(fd, "qty_delta"), "Quantity change");
  if (delta === 0) throw new UserError("The quantity change cannot be zero.", "qty_delta");
  const days = Number(str(fd, "time_days") || "0");
  if (!Number.isInteger(days) || Math.abs(days) > 3650) throw new UserError("Time impact must be a whole number of days.", "time_days");
  const item = await db.maybe<{ rate_minor: number }>("SELECT rate_minor FROM boq_items WHERE id=$1 AND project_id=$2", [d.item, p.id]);
  if (!item) throw new UserError("That BOQ item is not part of this project.", "boq_item_id");
  const n = (await db.one<{ n: number }>("SELECT COALESCE(max(number),0)::int+1 n FROM variations WHERE project_id=$1", [p.id])).n;
  const cost = amountFor(delta, item.rate_minor); // original contract rate is preserved
  await db.exec("INSERT INTO variations(tenant_id,project_id,number,title,description,boq_item_id,qty_delta_milli,cost_minor,time_days,requested_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    [c.tenant.id, p.id, n, d.title, d.description ?? null, d.item, delta, cost, days, c.user.id]);
  return `Variation ${n} saved as a draft.`;
});

export const submitVariation = mutation("variation.request", "submitVariation", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const n = await db.exec("UPDATE variations SET status='submitted' WHERE id=$1 AND project_id=$2 AND status='draft'", [z.string().uuid().parse(str(fd, "variation_id")), p.id]);
  if (!n) throw new UserError("Only a draft variation can be submitted.");
  await audit(db, c.user.id, c.tenant.id, "variation.submitted", "variation", str(fd, "variation_id"));
  return "Variation submitted for approval.";
});

export const decideVariation = mutation(null, "decideVariation", async (c, db, fd) => {
  if (!c.can("variation.approve") && !c.can("variation.decide")) throw new UserError("You are not allowed to decide variations.");
  const p = await writableProject(db, str(fd, "project_id"));
  const id = z.string().uuid().parse(str(fd, "variation_id"));
  const approve = str(fd, "decision") === "approve";
  const reason = str(fd, "reason");
  if (!approve && reason.length < 5) throw new UserError("A reason is required to reject a variation (at least 5 characters).", "reason");
  const v = await db.one<{ status: string; requested_by: string | null; boq_item_id: string; qty_delta_milli: number; number: number }>("SELECT status,requested_by,boq_item_id,qty_delta_milli,number FROM variations WHERE id=$1 AND project_id=$2 FOR UPDATE", [id, p.id]);
  if (v.status !== "submitted") throw new UserError(`This variation is already ${v.status}.`);
  if (violatesSeparation(c.user.id, v.requested_by)) throw new UserError("You raised this variation; a different person must decide it.");
  if (approve && v.qty_delta_milli < 0) {
    const item = await db.one<{ qty_milli: number }>("SELECT qty_milli FROM boq_items WHERE id=$1 FOR UPDATE", [v.boq_item_id]);
    const delta = (await db.one<{ d: number }>("SELECT COALESCE(sum(qty_delta_milli),0)::bigint d FROM variations WHERE boq_item_id=$1 AND status='approved'", [v.boq_item_id])).d;
    const floor = (await db.one<{ q: number }>("SELECT GREATEST(COALESCE((SELECT sum(qty_milli) FROM measurements WHERE boq_item_id=$1 AND status <> 'rejected'),0), COALESCE((SELECT sum(l.claimed_qty_milli+l.prev_qty_milli) FROM bill_lines l JOIN bills b ON b.id=l.bill_id WHERE l.boq_item_id=$1 AND b.status IN ('draft','submitted','certified','invoiced')),0))::bigint q", [v.boq_item_id])).q;
    if (item.qty_milli + delta + v.qty_delta_milli < floor) throw new UserError("This omission would reduce the quantity below what is already measured or billed.");
  }
  await db.exec("UPDATE variations SET status=$2, decision_reason=$3, decided_by=$4, decided_at=now() WHERE id=$1", [id, approve ? "approved" : "rejected", approve ? (reason || null) : reason, c.user.id]);
  await audit(db, c.user.id, c.tenant.id, approve ? "variation.approved" : "variation.rejected", "variation", id, { reason });
  return approve ? `Variation ${v.number} approved; the contract quantity is updated at the original rate.` : `Variation ${v.number} rejected.`;
});
