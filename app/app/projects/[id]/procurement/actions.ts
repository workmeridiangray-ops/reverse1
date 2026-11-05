"use server";
import { z } from "zod";
import { audit, UserError } from "@/lib/server/db";
import { mutation, str } from "@/lib/server/actions";
import { writableProject } from "@/lib/server/queries";
import { parseMajor } from "@/lib/rules/money";
import { parseQty } from "@/lib/rules/qty";
import { violatesSeparation } from "@/lib/rules/permissions";

export const createRequest = mutation("material.request", "createRequest", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  if (p.status === "tender") throw new UserError("Material requests can be raised once the project is awarded.");
  const lines: Array<{ d: string; u: string; q: number; item: string | null }> = [];
  for (let i = 0; i < 5; i++) {
    const d = str(fd, `desc_${i}`), q = str(fd, `qty_${i}`), u = str(fd, `unit_${i}`);
    if (!d && !q) continue;
    if (!d || !u || !q) throw new UserError(`Line ${i + 1}: enter description, unit and quantity.`);
    const qty = parseQty(q, `Line ${i + 1} quantity`);
    if (qty <= 0) throw new UserError(`Line ${i + 1}: quantity must be above zero.`);
    const item = str(fd, `item_${i}`) || null;
    if (item) await db.one("SELECT 1 FROM boq_items WHERE id=$1 AND project_id=$2", [item, p.id]);
    lines.push({ d, u, q: qty, item });
  }
  if (!lines.length) throw new UserError("Add at least one line.");
  const n = (await db.one<{ n: number }>("SELECT COALESCE(max(number),0)::int+1 n FROM material_requests WHERE project_id=$1", [p.id])).n;
  const r = await db.one<{ id: string }>("INSERT INTO material_requests(tenant_id,project_id,number,needed_by,requested_by) VALUES ($1,$2,$3,$4,$5) RETURNING id", [c.tenant.id, p.id, n, str(fd, "needed_by") || null, c.user.id]);
  for (const l of lines) await db.exec("INSERT INTO material_request_lines(tenant_id,project_id,request_id,boq_item_id,description,unit,qty_milli) VALUES ($1,$2,$3,$4,$5,$6,$7)", [c.tenant.id, p.id, r.id, l.item, l.d, l.u, l.q]);
  return `Material request MR-${n} saved as a draft.`;
});

export const submitRequest = mutation("material.request", "submitRequest", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const n = await db.exec("UPDATE material_requests SET status='submitted' WHERE id=$1 AND project_id=$2 AND status='draft'", [z.string().uuid().parse(str(fd, "request_id")), p.id]);
  if (!n) throw new UserError("Only a draft can be submitted.");
  return "Submitted for approval.";
});

export const decideRequest = mutation("material.approve", "decideRequest", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const id = z.string().uuid().parse(str(fd, "request_id"));
  const approve = str(fd, "decision") === "approve"; const reason = str(fd, "reason");
  if (!approve && reason.length < 5) throw new UserError("A reason is required to reject (at least 5 characters).", "reason");
  const r = await db.one<{ status: string; requested_by: string | null }>("SELECT status,requested_by FROM material_requests WHERE id=$1 AND project_id=$2 FOR UPDATE", [id, p.id]);
  if (r.status !== "submitted") throw new UserError(`Request is already ${r.status}.`);
  if (violatesSeparation(c.user.id, r.requested_by)) throw new UserError("You raised this request; a different person must approve it.");
  await db.exec("UPDATE material_requests SET status=$2, decided_by=$3, decision_reason=$4 WHERE id=$1", [id, approve ? "approved" : "rejected", c.user.id, reason || null]);
  await audit(db, c.user.id, c.tenant.id, approve ? "material_request.approved" : "material_request.rejected", "material_request", id, { reason });
  return approve ? "Request approved." : "Request rejected.";
});

export const createPo = mutation("po.manage", "createPo", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const reqId = z.string().uuid("Choose an approved request").parse(str(fd, "request_id"));
  const supplier = z.string().uuid("Choose a supplier").parse(str(fd, "supplier_id"));
  const req = await db.one<{ status: string }>("SELECT status FROM material_requests WHERE id=$1 AND project_id=$2", [reqId, p.id]);
  if (req.status !== "approved") throw new UserError("Only an approved request can be ordered.");
  await db.one("SELECT 1 FROM suppliers WHERE id=$1", [supplier]);
  const lines = await db.q<{ id: string; boq_item_id: string | null; description: string; unit: string; qty_milli: number; ordered: number }>(
    "SELECT l.id,l.boq_item_id,l.description,l.unit,l.qty_milli,COALESCE((SELECT sum(pl.qty_milli) FROM po_lines pl JOIN purchase_orders po ON po.id=pl.po_id WHERE pl.request_line_id=l.id AND po.status <> 'cancelled'),0)::bigint ordered FROM material_request_lines l WHERE l.request_id=$1", [reqId]);
  const picks = lines.map((l) => ({ l, rate: str(fd, `rate_${l.id}`) })).filter((x) => x.rate !== "");
  if (!picks.length) throw new UserError("Enter a rate for at least one line.");
  const n = (await db.one<{ n: number }>("SELECT COALESCE(max(number),0)::int+1 n FROM purchase_orders WHERE project_id=$1", [p.id])).n;
  const po = await db.one<{ id: string }>("INSERT INTO purchase_orders(tenant_id,project_id,number,supplier_id,request_id,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [c.tenant.id, p.id, n, supplier, reqId, c.user.id]);
  for (const { l, rate } of picks) {
    const remaining = l.qty_milli - l.ordered;
    if (remaining <= 0) throw new UserError(`${l.description}: the full requested quantity is already ordered.`);
    await db.exec("INSERT INTO po_lines(tenant_id,project_id,po_id,request_line_id,boq_item_id,description,unit,qty_milli,rate_minor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [c.tenant.id, p.id, po.id, l.id, l.boq_item_id, l.description, l.unit, remaining, parseMajor(rate, "INR")]);
  }
  return `Purchase order PO-${n} created (draft). Review and issue it.`;
});

export const issuePo = mutation("po.manage", "issuePo", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const n = await db.exec("UPDATE purchase_orders SET status='issued' WHERE id=$1 AND project_id=$2 AND status='draft'", [z.string().uuid().parse(str(fd, "po_id")), p.id]);
  if (!n) throw new UserError("Only a draft PO can be issued.");
  await audit(db, c.user.id, c.tenant.id, "po.issued", "purchase_order", str(fd, "po_id"));
  return "Purchase order issued.";
});

export const receiveGoods = mutation("grn.manage", "receiveGoods", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const poId = z.string().uuid().parse(str(fd, "po_id"));
  const po = await db.one<{ status: string }>("SELECT status FROM purchase_orders WHERE id=$1 AND project_id=$2 FOR UPDATE", [poId, p.id]);
  if (!["issued", "part_received"].includes(po.status)) throw new UserError("Goods can only be received against an issued order.");
  const lines = await db.q<{ id: string; description: string; qty_milli: number; accepted: number }>("SELECT l.id,l.description,l.qty_milli,COALESCE((SELECT sum(accepted_qty_milli) FROM grn_lines g WHERE g.po_line_id=l.id),0)::bigint accepted FROM po_lines l WHERE l.po_id=$1", [poId]);
  const entries: Array<{ id: string; acc: number; rej: number; reason: string | null }> = [];
  for (const l of lines) {
    const a = str(fd, `acc_${l.id}`), r = str(fd, `rej_${l.id}`);
    if (!a && !r) continue;
    const acc = a ? parseQty(a, "Accepted quantity") : 0, rej = r ? parseQty(r, "Rejected quantity") : 0;
    if (acc + rej <= 0) continue;
    if (acc > l.qty_milli - l.accepted) throw new UserError(`${l.description}: accepted quantity exceeds the quantity still outstanding on the order.`);
    const reason = str(fd, `reason_${l.id}`);
    if (rej > 0 && reason.length < 3) throw new UserError(`${l.description}: give a reason for the rejected quantity.`);
    entries.push({ id: l.id, acc, rej, reason: reason || null });
  }
  if (!entries.length) throw new UserError("Enter at least one received quantity.");
  const g = await db.one<{ id: string }>("INSERT INTO goods_receipts(tenant_id,project_id,po_id,received_on,note,received_by) VALUES ($1,$2,$3,COALESCE(NULLIF($4,'')::date,current_date),$5,$6) RETURNING id", [c.tenant.id, p.id, poId, str(fd, "received_on"), str(fd, "note") || null, c.user.id]);
  for (const e of entries) await db.exec("INSERT INTO grn_lines(tenant_id,project_id,grn_id,po_line_id,accepted_qty_milli,rejected_qty_milli,reject_reason) VALUES ($1,$2,$3,$4,$5,$6,$7)", [c.tenant.id, p.id, g.id, e.id, e.acc, e.rej, e.reason]);
  const left = await db.one<{ n: number }>("SELECT count(*)::int n FROM po_lines l WHERE l.po_id=$1 AND l.qty_milli > COALESCE((SELECT sum(accepted_qty_milli) FROM grn_lines g WHERE g.po_line_id=l.id),0)", [poId]);
  await db.exec("UPDATE purchase_orders SET status=$2 WHERE id=$1", [poId, left.n === 0 ? "received" : "part_received"]);
  return left.n === 0 ? "Goods receipt saved; the order is fully received." : "Goods receipt saved; the order is partly received.";
});
