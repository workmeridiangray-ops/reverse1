"use server";
import { z } from "zod";
import { audit, type Db, UserError } from "@/lib/server/db";
import { dateStr, mutation, str } from "@/lib/server/actions";
import { todayIso } from "@/components/ui/Format";
import { boqWithDeltas, writableProject } from "@/lib/server/queries";
import { parseMajor } from "@/lib/rules/money";
import { parseQty, percentOf } from "@/lib/rules/qty";
import { collectionState, computeBill, contractValue, maxNewDispute, type BillLineInput, type Terms } from "@/lib/rules/billing";
import { violatesSeparation } from "@/lib/rules/permissions";

interface ContractRow { retention_bp: number; retention_cap_bp: number; advance_minor: number; advance_recovery_bp: number; payment_days: number; status: string }

async function priorTotals(db: Db, projectId: string, excludeBill?: string) {
  const r = await db.one<{ ret: number; adv: number }>(
    `SELECT COALESCE(sum(retention_minor),0)::bigint ret, COALESCE(sum(advance_recovery_minor),0)::bigint adv FROM bills
      WHERE project_id=$1 AND status IN ('certified','invoiced') AND ($2::uuid IS NULL OR id <> $2)`, [projectId, excludeBill ?? null]);
  return { retentionToDateMinor: r.ret, advanceRecoveredToDateMinor: r.adv };
}
async function termsFor(db: Db, projectId: string, k: ContractRow): Promise<Terms> {
  const boq = await boqWithDeltas(db, projectId);
  return { retentionBp: k.retention_bp, retentionCapBp: k.retention_cap_bp, advanceRecoveryBp: k.advance_recovery_bp, advanceMinor: Number(k.advance_minor),
    contractValueMinor: contractValue(boq.map((b) => ({ qtyMilli: b.qty_milli, approvedDeltaMilli: Number(b.delta), rateMinor: b.rate_minor }))) };
}

export const createBill = mutation("bill.prepare", "createBill", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id")); // locks the project row: bills for one project are created one at a time
  if (p.status !== "active" && p.status !== "handover") throw new UserError("Bills can be prepared once the project is active.");
  const k = await db.maybe<ContractRow>("SELECT * FROM contracts WHERE project_id=$1 AND status='approved'", [p.id]);
  if (!k) throw new UserError("Approve the contract before preparing a bill.");
  const open = await db.maybe<{ bill_no: number; status: string }>("SELECT bill_no,status FROM bills WHERE project_id=$1 AND status IN ('draft','submitted') LIMIT 1", [p.id]);
  if (open) throw new UserError(`Running bill ${open.bill_no} is still ${open.status}. Finish or cancel it before preparing the next one.`);
  const boq = await boqWithDeltas(db, p.id);
  const ver = new Map((await db.q<{ boq_item_id: string; q: number }>("SELECT boq_item_id, sum(qty_milli)::bigint q FROM measurements WHERE project_id=$1 AND status='verified' GROUP BY 1", [p.id])).map((r) => [r.boq_item_id, r.q]));
  const prev = new Map((await db.q<{ boq_item_id: string; q: number }>(
    `SELECT l.boq_item_id, sum(l.certified_qty_milli)::bigint q FROM bill_lines l JOIN bills b ON b.id=l.bill_id WHERE b.project_id=$1 AND b.status IN ('certified','invoiced') GROUP BY 1`, [p.id])).map((r) => [r.boq_item_id, r.q]));
  const lines: BillLineInput[] = [];
  for (const b of boq) {
    const claimed = (ver.get(b.id) ?? 0) - (prev.get(b.id) ?? 0);
    if (claimed > 0) lines.push({ boqItemId: b.id, code: b.code, rateMinor: b.rate_minor, contractQtyMilli: b.qty_milli + Number(b.delta), prevQtyMilli: prev.get(b.id) ?? 0, claimedQtyMilli: claimed, certifiedQtyMilli: claimed });
  }
  if (lines.length === 0) throw new UserError("There is no verified, unbilled work. Verify measurements first.");
  const terms = await termsFor(db, p.id, k);
  const calc = computeBill(lines, terms, await priorTotals(db, p.id));
  const no = (await db.one<{ n: number }>("SELECT COALESCE(max(bill_no),0)::int + 1 n FROM bills WHERE project_id=$1", [p.id])).n;
  const bill = await db.one<{ id: string }>(
    `INSERT INTO bills(tenant_id,project_id,bill_no,claimed_gross_minor,certified_gross_minor,retention_minor,advance_recovery_minor,net_minor,terms,prepared_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [c.tenant.id, p.id, no, calc.claimedGrossMinor, calc.certifiedGrossMinor, calc.retentionMinor, calc.advanceRecoveryMinor, calc.netMinor, JSON.stringify({ ...terms, paymentDays: k.payment_days }), c.user.id]);
  for (const l of calc.lines)
    await db.exec(`INSERT INTO bill_lines(tenant_id,project_id,bill_id,boq_item_id,rate_minor,contract_qty_milli,prev_qty_milli,claimed_qty_milli,certified_qty_milli,claimed_amount_minor,certified_amount_minor)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [c.tenant.id, p.id, bill.id, l.boqItemId, l.rateMinor, l.contractQtyMilli, l.prevQtyMilli, l.claimedQtyMilli, l.certifiedQtyMilli, l.claimedAmountMinor, l.certifiedAmountMinor]);
  await db.exec("UPDATE measurements SET bill_id=$1 WHERE project_id=$2 AND status='verified' AND bill_id IS NULL", [bill.id, p.id]);
  await audit(db, c.user.id, c.tenant.id, "bill.created", "bill", bill.id, { billNo: no, claimed: calc.claimedGrossMinor });
  return { message: `Running bill ${no} prepared from verified measurements.`, redirectTo: `/app/projects/${p.id}/bills/${bill.id}` };
});

async function loadBill(db: Db, projectId: string, billId: string, version: number) {
  const b = await db.one<{ id: string; status: string; version: number; prepared_by: string | null; bill_no: number; terms: Terms & { paymentDays: number }; other_deduction_minor: number }>(
    "SELECT id,status,version,prepared_by,bill_no,terms,other_deduction_minor FROM bills WHERE id=$1 AND project_id=$2 FOR UPDATE", [billId, projectId]);
  if (b.version !== version) throw new UserError("This bill was changed by someone else while you were viewing it. Reload the page to see the latest version.");
  return b;
}

export const submitBill = mutation("bill.prepare", "submitBill", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const b = await loadBill(db, p.id, str(fd, "bill_id"), Number(str(fd, "version")));
  if (b.status !== "draft") throw new UserError(`Bill is ${b.status}; only a draft can be submitted.`);
  await db.exec("UPDATE bills SET status='submitted', version=version+1 WHERE id=$1", [b.id]);
  await audit(db, c.user.id, c.tenant.id, "bill.submitted", "bill", b.id);
  return "Bill submitted for certification.";
});

export const returnBill = mutation("bill.certify", "returnBill", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const reason = z.string().trim().min(5, "Give a reason (at least 5 characters)").max(500).parse(str(fd, "reason"));
  const b = await loadBill(db, p.id, str(fd, "bill_id"), Number(str(fd, "version")));
  if (b.status !== "submitted") throw new UserError("Only a submitted bill can be returned.");
  await db.exec("UPDATE bills SET status='draft', certify_note=$2, version=version+1 WHERE id=$1", [b.id, `Returned: ${reason}`]);
  await audit(db, c.user.id, c.tenant.id, "bill.returned", "bill", b.id, { reason });
  return "Bill returned to the preparer with your reason.";
});

export const certifyBill = mutation("bill.certify", "certifyBill", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const b = await loadBill(db, p.id, str(fd, "bill_id"), Number(str(fd, "version")));
  if (b.status !== "submitted") throw new UserError(`Bill is ${b.status}; only a submitted bill can be certified.`);
  if (violatesSeparation(c.user.id, b.prepared_by)) throw new UserError("You prepared this bill; a different person must certify it.");
  const lines = await db.q<{ id: string; boq_item_id: string; code: string; rate_minor: number; contract_qty_milli: number; prev_qty_milli: number; claimed_qty_milli: number }>(
    "SELECT l.id,l.boq_item_id,i.code,l.rate_minor,l.contract_qty_milli,l.prev_qty_milli,l.claimed_qty_milli FROM bill_lines l JOIN boq_items i ON i.id=l.boq_item_id WHERE l.bill_id=$1 ORDER BY i.code", [b.id]);
  const inputs: BillLineInput[] = lines.map((l) => {
    const raw = str(fd, `cert_${l.id}`);
    const cert = raw === "" ? l.claimed_qty_milli : parseQty(raw, `Certified quantity for ${l.code}`);
    return { boqItemId: l.boq_item_id, code: l.code, rateMinor: l.rate_minor, contractQtyMilli: l.contract_qty_milli, prevQtyMilli: l.prev_qty_milli, claimedQtyMilli: l.claimed_qty_milli, certifiedQtyMilli: cert };
  });
  const other = parseMajor(str(fd, "other_deduction") || "0", "INR");
  const otherReason = str(fd, "other_reason");
  if (other > 0 && otherReason.length < 5) throw new UserError("Give a reason for the other deduction.", "other_reason");
  const partial = inputs.some((i) => i.certifiedQtyMilli < i.claimedQtyMilli);
  const note = str(fd, "note");
  if (partial && note.length < 5) throw new UserError("You certified less than claimed. Explain why in the certification note.", "note");
  const calc = computeBill(inputs, b.terms, await priorTotals(db, p.id, b.id), other);
  for (const l of calc.lines) await db.exec("UPDATE bill_lines SET certified_qty_milli=$2, certified_amount_minor=$3 WHERE bill_id=$1 AND boq_item_id=$4", [b.id, l.certifiedQtyMilli, l.certifiedAmountMinor, l.boqItemId]);
  await db.exec(`UPDATE bills SET status='certified', certified_gross_minor=$2, retention_minor=$3, advance_recovery_minor=$4, other_deduction_minor=$5, other_deduction_reason=$6,
                   net_minor=$7, certified_by=$8, certified_at=now(), certify_note=$9, version=version+1 WHERE id=$1`,
    [b.id, calc.certifiedGrossMinor, calc.retentionMinor, calc.advanceRecoveryMinor, other, other ? otherReason : null, calc.netMinor, c.user.id, note || null]);
  await audit(db, c.user.id, c.tenant.id, "bill.certified", "bill", b.id, { certified: calc.certifiedGrossMinor, net: calc.netMinor, partial });
  return `Bill ${b.bill_no} certified${partial ? " (partially)" : ""}.`;
});

export const cancelBill = mutation("bill.prepare", "cancelBill", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const reason = z.string().trim().min(5, "Give a reason (at least 5 characters)").max(500).parse(str(fd, "reason"));
  const b = await loadBill(db, p.id, str(fd, "bill_id"), Number(str(fd, "version")));
  if (b.status !== "draft" && b.status !== "submitted") throw new UserError("Only a draft or submitted bill can be cancelled.");
  await db.exec("UPDATE bills SET status='cancelled', cancel_reason=$2, version=version+1 WHERE id=$1", [b.id, reason]);
  await db.exec("UPDATE measurements SET bill_id=NULL WHERE bill_id=$1", [b.id]);
  await audit(db, c.user.id, c.tenant.id, "bill.cancelled", "bill", b.id, { reason });
  return "Bill cancelled. Its measurements are available for the next bill.";
});

export const invoiceBill = mutation("invoice.create", "invoiceBill", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const b = await loadBill(db, p.id, str(fd, "bill_id"), Number(str(fd, "version")));
  if (b.status !== "certified") throw new UserError("Only a certified bill can be invoiced.");
  const full = await db.one<{ net_minor: number }>("SELECT net_minor FROM bills WHERE id=$1", [b.id]);
  const n = (await db.one<{ n: number }>("SELECT next_number('invoice') n")).n;
  const number = `INV-${String(n).padStart(4, "0")}`;
  const issued = todayIso();
  const due = new Date(Date.parse(issued) + (b.terms.paymentDays ?? 30) * 86400000).toISOString().slice(0, 10);
  const inv = await db.one<{ id: string }>("INSERT INTO client_invoices(tenant_id,project_id,bill_id,number,amount_minor,issued_on,due_on,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
    [c.tenant.id, p.id, b.id, number, full.net_minor, issued, due, c.user.id]);
  await db.exec("UPDATE bills SET status='invoiced', version=version+1 WHERE id=$1", [b.id]);
  await audit(db, c.user.id, c.tenant.id, "invoice.created", "invoice", inv.id, { number, amount: full.net_minor });
  return `Invoice ${number} issued.`;
});

async function invoiceState(db: Db, invoiceId: string) {
  const inv = await db.one<{ id: string; amount_minor: number; project_id: string }>("SELECT id,amount_minor,project_id FROM client_invoices WHERE id=$1 FOR UPDATE", [invoiceId]);
  const rec = await db.q<{ a: number }>("SELECT amount_minor a FROM receipts WHERE invoice_id=$1 AND reversed_at IS NULL", [invoiceId]);
  const dis = await db.q<{ a: number }>("SELECT amount_minor a FROM disputes WHERE invoice_id=$1 AND status='open'", [invoiceId]);
  return { inv, state: collectionState(inv.amount_minor, rec.map((r) => r.a), dis.map((d) => d.a)), disputes: dis.map((d) => d.a) };
}

export const recordReceipt = mutation("receipt.record", "recordReceipt", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const invoiceId = z.string().uuid().parse(str(fd, "invoice_id"));
  const amount = parseMajor(str(fd, "amount"), "INR");
  if (amount <= 0) throw new UserError("Amount must be greater than zero.", "amount");
  const on = dateStr.parse(str(fd, "received_on"));
  if (on > todayIso()) throw new UserError("The receipt date cannot be in the future.", "received_on");
  const { inv, state } = await invoiceState(db, invoiceId);
  if (inv.project_id !== p.id) throw new UserError("Invoice does not belong to this project.");
  if (amount > state.outstandingMinor) throw new UserError("This receipt is more than the outstanding balance. Check the amount.", "amount");
  const r = await db.one<{ id: string }>("INSERT INTO receipts(tenant_id,project_id,invoice_id,amount_minor,received_on,method,reference,recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
    [c.tenant.id, p.id, invoiceId, amount, on, ["bank", "cheque", "cash", "upi"].includes(str(fd, "method")) ? str(fd, "method") : "bank", str(fd, "reference") || null, c.user.id]);
  await audit(db, c.user.id, c.tenant.id, "receipt.recorded", "receipt", r.id, { amount });
  return "Receipt recorded.";
});

export const reverseReceipt = mutation("receipt.record", "reverseReceipt", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const id = z.string().uuid().parse(str(fd, "receipt_id"));
  const reason = z.string().trim().min(5, "A reason is required for a correction (at least 5 characters)").max(500).parse(str(fd, "reason"));
  if (!c.can("dispute.manage")) throw new UserError("Only accounts or owners can reverse a receipt.");
  const n = await db.exec("UPDATE receipts SET reversed_at=now(), reversed_by=$2, reversal_reason=$3 WHERE id=$1 AND project_id=$4 AND reversed_at IS NULL", [id, c.user.id, reason, p.id]);
  if (!n) throw new UserError("Receipt not found or already reversed.");
  await audit(db, c.user.id, c.tenant.id, "receipt.reversed", "receipt", id, { reason });
  return "Receipt reversed. The original entry is kept with your reason.";
});

export const raiseDispute = mutation(null, "raiseDispute", async (c, db, fd) => {
  if (!c.can("dispute.raise") && !c.can("dispute.manage")) throw new UserError("You are not allowed to raise disputes.");
  const p = await writableProject(db, str(fd, "project_id"));
  const invoiceId = z.string().uuid().parse(str(fd, "invoice_id"));
  const amount = parseMajor(str(fd, "amount"), "INR");
  const reason = z.string().trim().min(5, "Describe the dispute").max(800).parse(str(fd, "reason"));
  const { inv, state, disputes } = await invoiceState(db, invoiceId);
  if (inv.project_id !== p.id) throw new UserError("Invoice does not belong to this project.");
  if (amount <= 0 || amount > maxNewDispute(state.outstandingMinor, disputes)) throw new UserError("The disputed amount must be above zero and within the undisputed outstanding balance.", "amount");
  const d = await db.one<{ id: string }>("INSERT INTO disputes(tenant_id,project_id,invoice_id,amount_minor,reason,raised_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [c.tenant.id, p.id, invoiceId, amount, reason, c.user.id]);
  await audit(db, c.user.id, c.tenant.id, "dispute.raised", "dispute", d.id, { amount });
  return "Dispute recorded; the disputed amount is shown separately from the undisputed balance.";
});

export const resolveDispute = mutation("dispute.manage", "resolveDispute", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const id = z.string().uuid().parse(str(fd, "dispute_id"));
  const note = z.string().trim().min(5, "Record how it was resolved").max(800).parse(str(fd, "resolution"));
  const n = await db.exec("UPDATE disputes SET status='resolved', resolution=$2 WHERE id=$1 AND project_id=$3 AND status='open'", [id, note, p.id]);
  if (!n) throw new UserError("Dispute not found or already resolved.");
  await audit(db, c.user.id, c.tenant.id, "dispute.resolved", "dispute", id);
  return "Dispute resolved.";
});
void percentOf;
