import "server-only";
import type { Db } from "../db";
import { UserError } from "../db";
import { audit } from "../audit";
import { type Ctx, actor } from "./ctx";
import * as inv from "./inventory";
import * as prod from "./production";
import { can } from "../perms";

export async function recordResult(c: Db, x: Ctx, inspId: string, a: { measured?: number | null; min?: number | null; max?: number | null; unit?: string; pass: boolean; notes?: string }) {
  if (!can(x.role, "qa.decide")) throw new UserError("You are not authorised to decide inspections.", "denied");
  const i = (await c.query("select * from inspections where id=$1 for update", [inspId])).rows[0];
  if (!i || i.status !== "pending") throw new UserError("This inspection has already been decided.", "conflict");
  let pass = a.pass;
  if (a.measured != null && ((a.min != null && a.measured < a.min) || (a.max != null && a.measured > a.max))) {
    if (pass) throw new UserError(`Measured value ${a.measured} is outside the limits (${a.min ?? "–"} to ${a.max ?? "–"}). Record it as failed, or raise a concession through the NCR.`);
    pass = false;
  }
  await c.query("update inspections set status=$2, decided_by=$3, decided_at=now(), measured=$4, min_value=$5, max_value=$6, unit=$7, notes=$8 where id=$1", [inspId, pass ? "passed" : "failed", x.userId, a.measured ?? null, a.min ?? null, a.max ?? null, a.unit ?? null, a.notes ?? null]);
  if (i.batch_id) await c.query("update batches set status=$2 where id=$1", [i.batch_id, pass ? "available" : "quarantine"]);
  if (!pass) {
    const n = (await c.query("select next_number($1,'ncr','NCR') n", [x.companyId])).rows[0].n;
    await c.query("insert into ncrs(company_id,number,inspection_id,description) values ($1,$2,$3,$4)", [x.companyId, n, inspId, a.notes || "Inspection failed"]);
  }
  await audit(c, actor(x), pass ? "qa.pass" : "qa.fail", "inspection", inspId, { measured: a.measured });
  return pass;
}
export async function disposition(c: Db, x: Ctx, ncrId: string, disp: "rework" | "return" | "concession" | "scrap", reason: string, action?: string) {
  if (!can(x.role, "qa.decide")) throw new UserError("You are not authorised to disposition nonconformances.", "denied");
  if (!reason.trim()) throw new UserError("A reason is required for a disposition.");
  const n = (await c.query("select n.*, i.batch_id, i.item_id, i.qty, i.ref_type, i.ref_id from ncrs n join inspections i on i.id=n.inspection_id where n.id=$1 for update of n", [ncrId])).rows[0];
  if (!n || n.status !== "open") throw new UserError("This NCR has already been dispositioned.", "conflict");
  if (n.batch_id) {
    const bal = (await c.query("select location_id, qty from stock_balances where batch_id=$1 and qty>0", [n.batch_id])).rows;
    if (disp === "concession") await c.query("update batches set status='available' where id=$1", [n.batch_id]);
    if (disp === "scrap" || disp === "return") {
      await c.query("update batches set status='rejected' where id=$1", [n.batch_id]);
      for (const b of bal) await inv.post(c, x, { itemId: n.item_id, batchId: n.batch_id, locationId: b.location_id, qty: -Number(b.qty), kind: disp === "scrap" ? "scrap" : "return", refType: "ncr", refId: ncrId, note: disp });
    }
    if (disp === "rework") {
      if (n.ref_type === "work_order") await prod.createRework(c, x, n.ref_id, Number(n.qty), reason);
      else throw new UserError("Rework applies to manufactured output. For purchased material choose return, concession or scrap.");
    }
  }
  await c.query("update ncrs set disposition=$2, status='dispositioned', decided_by=$3, decision_reason=$4, corrective_action=$5 where id=$1", [ncrId, disp, x.userId, reason, action ?? null]);
  await audit(c, actor(x), "qa.disposition", "ncr", ncrId, { disp }, reason);
}
export async function raiseInspection(c: Db, x: Ctx, a: { kind: "incoming" | "in_process" | "final"; itemId: string; batchId?: string | null; qty: number }) {
  const n = (await c.query("select next_number($1,'qc','QC') n", [x.companyId])).rows[0].n;
  const r = await c.query("insert into inspections(company_id,number,kind,item_id,batch_id,qty) values ($1,$2,$3,$4,$5,$6) returning id", [x.companyId, n, a.kind, a.itemId, a.batchId ?? null, a.qty]);
  return r.rows[0].id as string;
}
