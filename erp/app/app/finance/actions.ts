"use server";
import { tenantAction, formObj, type ActionResult } from "@/lib/actions";
import { UserError } from "@/lib/errors";
import { parseMoney } from "@/lib/money";
import { invoiceOrder, recordReceipt, reverseReceipt, payRefund, draftJournal, postDraftJournal, createExpense, closePeriod, reopenPeriod } from "@/lib/erp/finance";
import { issueCreditNote } from "@/lib/erp/fulfilment";
import { reverseJournal, today } from "@/lib/erp/ledger";
import { qtyFields } from "../fulfilment/actions";
import { saveFile } from "@/lib/files";

const money = (v: string, key: string, label = "Amount") => { try { return parseMoney(v, label); } catch (e: any) { throw new UserError(e.message, { [key]: e.message }); } };

export async function invoiceAction(orderId: string, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("finance.invoice", form, async (ctx, db) => {
    const f = formObj(form);
    const r = await invoiceOrder(db, ctx, orderId, qtyFields(f, "qty_").map((x) => ({ lineId: x.id, qty: x.qty })), f.issue_date || today());
    return { ok: true, message: `Invoice ${r.number} posted.`, redirectTo: `/app/finance/invoices/${r.id}` };
  });
}
export async function receiptAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("finance.receipts", form, async (ctx, db) => {
    const f = formObj(form);
    if (!f.customer_id) throw new UserError("Choose a customer.", { customer_id: "Required" });
    const allocations = qtyFields(f, "alloc_").map((x) => ({ invoiceId: x.id, amount: 0 }));
    const al: { invoiceId: string; amount: number }[] = [];
    for (const [k, v] of Object.entries(f)) if (k.startsWith("alloc_") && v) al.push({ invoiceId: k.slice(6), amount: money(v, k, "Allocation") });
    void allocations;
    const r = await recordReceipt(db, ctx, { customerId: f.customer_id, amount: money(f.amount, "amount"), method: f.method || "bank", reference: f.reference, receivedOn: f.received_on || today(), allocations: al });
    return { ok: true, message: `Receipt ${r.number} recorded.`, redirectTo: "/app/finance/receipts" };
  });
}
export async function reverseReceiptAction(id: string, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("finance.reverse", form, async (ctx, db) => { await reverseReceipt(db, ctx, id, formObj(form).reason ?? ""); return { ok: true, message: "Receipt reversed; invoices are open again." }; });
}
export async function creditNoteAction(invoiceId: string, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("finance.invoice", form, async (ctx, db) => {
    const f = formObj(form);
    const id = await issueCreditNote(db, ctx, invoiceId, money(f.net, "net", "Net amount"), f.tax ? money(f.tax, "tax", "Tax") : 0, f.reason ?? "");
    void id; return { ok: true, message: "Credit note issued." };
  });
}
export async function refundAction(cnId: string, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("finance.receipts", form, async (ctx, db) => { const f = formObj(form); await payRefund(db, ctx, cnId, money(f.amount, "amount"), (f.method as any) || "bank"); return { ok: true, message: "Refund recorded." }; });
}
export async function journalAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("finance.journal", form, async (ctx, db) => {
    const f = formObj(form); const lines: { accountId: string; debit: number; credit: number }[] = [];
    for (let i = 0; i < 12; i++) { const a = f[`acct_${i}`]; if (!a) continue; lines.push({ accountId: a, debit: f[`dr_${i}`] ? money(f[`dr_${i}`], `dr_${i}`) : 0, credit: f[`cr_${i}`] ? money(f[`cr_${i}`], `cr_${i}`) : 0 }); }
    for (const l of lines) if ((l.debit > 0) === (l.credit > 0)) throw new UserError("Each line needs either a debit or a credit, not both or neither.");
    if (!f.memo) throw new UserError("Add a description.", { memo: "Required" });
    const j = await draftJournal(db, ctx, { date: f.entry_date || today(), memo: f.memo, lines });
    return { ok: true, message: `Draft ${j.number} saved. A second user with approval rights posts it.`, redirectTo: "/app/finance/journals" };
  });
}
export async function postJournalAction(id: string): Promise<ActionResult> {
  return tenantAction("finance.journal", null, async (ctx, db) => { await postDraftJournal(db, ctx, id); return { ok: true, message: "Journal posted." }; });
}
export async function reverseJournalAction(id: string, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("finance.reverse", form, async (ctx, db) => { await reverseJournal(db, ctx.tenant.id, ctx.user.id, id, formObj(form).reason ?? "", today()); return { ok: true, message: "Reversal posted; the original is marked reversed and stays on record." }; });
}
export async function expenseAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("finance.invoice", form, async (ctx, db) => {
    const f = formObj(form); if (!f.account_id) throw new UserError("Choose an expense account.", { account_id: "Required" }); if (!f.description) throw new UserError("Describe the expense.", { description: "Required" });
    let fileId: string | undefined;
    const file = form.get("receipt");
    const e = await createExpense(db, ctx, { branchId: f.branch_id, date: f.expense_date || today(), description: f.description, accountId: f.account_id, amount: money(f.amount, "amount"), paidVia: f.paid_via || "cash" });
    if (file instanceof File && file.size > 0) { fileId = await saveFile(db, ctx, "expense", e.id, file); await db.query("update expenses set file_id=$2 where id=$1", [e.id, fileId]); }
    return { ok: true, message: `Expense ${e.number} recorded.` };
  });
}
export async function closePeriodAction(id: string): Promise<ActionResult> {
  return tenantAction("finance.period", null, async (ctx, db) => { await closePeriod(db, ctx, id); return { ok: true, message: "Period closed. Nothing can post into it." }; });
}
export async function reopenPeriodAction(id: string, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("finance.period", form, async (ctx, db) => { await reopenPeriod(db, ctx, id, formObj(form).reason ?? ""); return { ok: true, message: "Period reopened (recorded in the audit trail)." }; });
}
