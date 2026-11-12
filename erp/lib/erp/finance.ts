import type { Db } from "../db";
import type { TCtx } from "../actions";
import { UserError } from "../errors";
import { audit } from "../audit";
import { postJournal, reverseJournal, today, addDays, acct } from "./ledger";
import { lineAmounts, mulDiv } from "../money";
import { ruleFor, requestApproval, onDecision } from "./approvals";

const num = async (db: Db, t: string, k: string) => (await db.query("select next_number($1,$2) n", [t, k])).rows[0].n as string;

// ---------- sales invoices ----------
export async function invoiceOrder(db: Db, ctx: TCtx, orderId: string, items: { lineId: string; qty: number }[], issueDate = today()) {
  const o = (await db.query("select * from sales_orders where id=$1 for update", [orderId])).rows[0];
  if (!o) throw new UserError("Order not found");
  if (["draft", "cancelled", "credit_hold"].includes(o.status)) throw new UserError(`A ${o.status.replace("_", " ")} order cannot be invoiced.`);
  const todo = items.filter((x) => x.qty > 0);
  if (!todo.length) throw new UserError("Enter a quantity to invoice on at least one line.");
  const cust = (await db.query("select * from customers where id=$1", [o.customer_id])).rows[0];
  const lines: any[] = []; let net = 0, tax = 0;
  for (const t of todo) {
    const l = (await db.query("select l.*, i.kind, i.name from sales_order_lines l join items i on i.id=l.item_id and i.tenant_id=l.tenant_id where l.id=$1 and l.order_id=$2 for update of l", [t.lineId, orderId])).rows[0];
    if (!l) throw new UserError("Line does not belong to this order");
    // goods are billed after dispatch (net of un-credited returns); services can be billed against the order
    const billable = l.kind === "goods" ? l.dispatched_qty - l.returned_qty - l.invoiced_qty : l.qty - l.invoiced_qty;
    if (t.qty > billable) throw new UserError(`${l.name}: only ${Math.max(0, billable) / 1000} can be invoiced (dispatched ${l.dispatched_qty / 1000}, returned ${l.returned_qty / 1000}, already invoiced ${l.invoiced_qty / 1000}).`);
    const a = lineAmounts(t.qty, l.unit_price_paise, l.discount_bps, l.tax_bps, Number(l.uom_factor_milli));
    lines.push({ l, qty: t.qty, a }); net += a.net; tax += a.tax;
  }
  const number = await num(db, ctx.tenant.id, "invoice");
  const due = addDays(issueDate, cust.payment_terms_days);
  const id = (await db.query(
    `insert into invoices(tenant_id,number,order_id,customer_id,branch_id,issue_date,due_date,subtotal_paise,tax_paise,total_paise,created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`, [ctx.tenant.id, number, orderId, o.customer_id, o.branch_id, issueDate, due, net, tax, net + tax, ctx.user.id])).rows[0].id as string;
  for (const { l, qty, a } of lines) {
    await db.query("insert into invoice_lines(tenant_id,invoice_id,order_line_id,item_id,description,qty,unit_price_paise,discount_bps,tax_bps,net_paise,tax_paise,total_paise) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [ctx.tenant.id, id, l.id, l.item_id, l.name, qty, l.unit_price_paise, l.discount_bps, l.tax_bps, a.net, a.tax, a.total]);
    await db.query("update sales_order_lines set invoiced_qty = invoiced_qty + $2 where id=$1", [l.id, qty]);
  }
  const j = await postJournal(db, { tenantId: ctx.tenant.id, userId: ctx.user.id, date: issueDate, memo: `Invoice ${number}`, sourceType: "invoice", sourceId: id,
    lines: [{ account: "ar", debit: net + tax, branchId: o.branch_id }, { account: "sales", credit: net, branchId: o.branch_id }, { account: "output_tax", credit: tax, branchId: o.branch_id }] });
  await db.query("update invoices set journal_id=$2 where id=$1", [id, j]);
  // order is closed once everything dispatched has been invoiced
  const open = (await db.query("select count(*) c from sales_order_lines l join items i on i.id=l.item_id and i.tenant_id=l.tenant_id where l.order_id=$1 and (l.invoiced_qty + 0 < l.qty)", [orderId])).rows[0].c;
  if (Number(open) === 0) await db.query("update sales_orders set status='closed' where id=$1", [orderId]);
  await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "invoice.posted", entityType: "invoice", entityId: id, detail: { number, total: net + tax } });
  return { id, number, total: net + tax };
}

// ---------- receipts (collections) ----------
export async function recordReceipt(db: Db, ctx: TCtx, i: { customerId: string; amount: number; method: string; reference?: string; receivedOn: string; allocations: { invoiceId: string; amount: number }[] }) {
  if (i.amount <= 0) throw new UserError("Amount must be greater than zero.", { amount: "Required" });
  const allocTotal = i.allocations.reduce((s, a) => s + a.amount, 0);
  if (allocTotal > i.amount) throw new UserError("Allocated amounts exceed the receipt amount.", { amount: "Allocations exceed receipt" });
  const number = await num(db, ctx.tenant.id, "receipt");
  const id = (await db.query("insert into receipts(tenant_id,number,customer_id,amount_paise,allocated_paise,method,reference,received_on,created_by) values ($1,$2,$3,$4,0,$5,$6,$7,$8) returning id",
    [ctx.tenant.id, number, i.customerId, i.amount, i.method, i.reference || null, i.receivedOn, ctx.user.id])).rows[0].id as string;
  for (const a of i.allocations.filter((x) => x.amount > 0)) await allocate(db, ctx, id, a.invoiceId, a.amount);
  const j = await postJournal(db, { tenantId: ctx.tenant.id, userId: ctx.user.id, date: i.receivedOn, memo: `Receipt ${number}`, sourceType: "receipt", sourceId: id,
    lines: [{ account: "cash", debit: i.amount }, { account: "ar", credit: i.amount }] });
  await db.query("update receipts set journal_id=$2 where id=$1", [id, j]);
  await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "receipt.posted", entityType: "receipt", entityId: id, detail: { number, amount: i.amount } });
  return { id, number };
}

export async function allocate(db: Db, ctx: TCtx, receiptId: string, invoiceId: string, amount: number) {
  const r = (await db.query("select * from receipts where id=$1 for update", [receiptId])).rows[0];
  const inv = (await db.query("select * from invoices where id=$1 for update", [invoiceId])).rows[0];
  if (!r || !inv) throw new UserError("Receipt or invoice not found");
  if (r.status !== "posted") throw new UserError("A reversed receipt cannot be allocated.");
  if (r.customer_id !== inv.customer_id) throw new UserError("The receipt and invoice belong to different customers.");
  if (inv.status === "void") throw new UserError(`Invoice ${inv.number} is void.`);
  const due = inv.total_paise - inv.paid_paise - inv.credited_paise;
  if (amount > due) throw new UserError(`Invoice ${inv.number}: only ${(due / 100).toFixed(2)} is outstanding.`);
  if (amount > r.amount_paise - r.allocated_paise) throw new UserError("Not enough unallocated balance on this receipt.");
  await db.query("insert into receipt_allocations(tenant_id,receipt_id,invoice_id,amount_paise) values ($1,$2,$3,$4)", [ctx.tenant.id, receiptId, invoiceId, amount]);
  await db.query("update receipts set allocated_paise = allocated_paise + $2 where id=$1", [receiptId, amount]);
  const paid = inv.paid_paise + amount;
  await db.query("update invoices set paid_paise=$2, status=$3 where id=$1", [invoiceId, paid, paid + inv.credited_paise >= inv.total_paise ? "paid" : "partially_paid"]);
}

export async function reverseReceipt(db: Db, ctx: TCtx, receiptId: string, reason: string) {
  const r = (await db.query("select * from receipts where id=$1 for update", [receiptId])).rows[0];
  if (!r) throw new UserError("Receipt not found");
  if (r.status !== "posted") throw new UserError("Already reversed.");
  await reverseJournal(db, ctx.tenant.id, ctx.user.id, r.journal_id, reason, today());
  const as = (await db.query("select * from receipt_allocations where receipt_id=$1", [receiptId])).rows;
  for (const a of as) {
    const inv = (await db.query("select * from invoices where id=$1 for update", [a.invoice_id])).rows[0];
    const paid = inv.paid_paise - a.amount_paise;
    await db.query("update invoices set paid_paise=$2, status=$3 where id=$1", [inv.id, paid, paid + inv.credited_paise >= inv.total_paise ? "paid" : paid + inv.credited_paise > 0 ? "partially_paid" : "posted"]);
  }
  await db.query("update receipts set status='reversed' where id=$1", [receiptId]);
  await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "receipt.reversed", entityType: "receipt", entityId: receiptId, reason });
}

export async function payRefund(db: Db, ctx: TCtx, creditNoteId: string, amount: number, method: "cash" | "bank") {
  const cn = (await db.query("select * from credit_notes where id=$1 for update", [creditNoteId])).rows[0];
  if (!cn) throw new UserError("Credit note not found");
  const left = cn.refund_due_paise - cn.refunded_paise;
  if (amount <= 0 || amount > left) throw new UserError(`Refund must be between ₹0.01 and ${(left / 100).toFixed(2)}.`);
  await postJournal(db, { tenantId: ctx.tenant.id, userId: ctx.user.id, date: today(), memo: `Refund for ${cn.number} (${method})`, sourceType: "refund", sourceId: creditNoteId,
    lines: [{ account: "ar", debit: amount }, { account: "cash", credit: amount }] }).catch((e) => { throw e; });
  await db.query("update credit_notes set refunded_paise = refunded_paise + $2 where id=$1", [creditNoteId, amount]);
  await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "refund.paid", entityType: "credit_note", entityId: creditNoteId, detail: { amount } });
}

// ---------- manual journals ----------
export async function draftJournal(db: Db, ctx: TCtx, i: { date: string; memo: string; lines: { accountId: string; debit: number; credit: number }[] }) {
  const d = i.lines.reduce((s, l) => s + l.debit, 0), c = i.lines.reduce((s, l) => s + l.credit, 0);
  if (i.lines.length < 2) throw new UserError("A journal needs at least two lines.");
  if (d !== c) throw new UserError(`Debits (${(d / 100).toFixed(2)}) and credits (${(c / 100).toFixed(2)}) must be equal.`);
  const number = await num(db, ctx.tenant.id, "journal");
  const id = (await db.query("insert into journals(tenant_id,number,entry_date,memo,status,created_by) values ($1,$2,$3,$4,'draft',$5) returning id", [ctx.tenant.id, number, i.date, i.memo, ctx.user.id])).rows[0].id as string;
  for (const l of i.lines) await db.query("insert into journal_lines(tenant_id,journal_id,account_id,debit_paise,credit_paise) values ($1,$2,$3,$4,$5)", [ctx.tenant.id, id, l.accountId, l.debit, l.credit]);
  return { id, number };
}
export async function postDraftJournal(db: Db, ctx: TCtx, id: string) {
  const j = (await db.query("select * from journals where id=$1 for update", [id])).rows[0];
  if (!j) throw new UserError("Journal not found");
  if (j.status !== "draft") throw new UserError(`Journal ${j.number} is already ${j.status}.`);
  if (j.created_by === ctx.user.id && !ctx.perms.has("finance.approve") ) throw new UserError("A different user with approval rights must post this journal (separation of duties).");
  await db.query("update journals set status='posted', posted_by=$2, posted_at=now() where id=$1", [id, ctx.user.id]);
  await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "journal.posted", entityType: "journal", entityId: id });
}

// ---------- expenses ----------
export async function createExpense(db: Db, ctx: TCtx, i: { branchId?: string; date: string; description: string; accountId: string; amount: number; paidVia: string; fileId?: string }) {
  const number = await num(db, ctx.tenant.id, "expense");
  const id = (await db.query("insert into expenses(tenant_id,number,branch_id,expense_date,description,account_id,amount_paise,paid_via,file_id,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id",
    [ctx.tenant.id, number, i.branchId || null, i.date, i.description, i.accountId, i.amount, i.paidVia, i.fileId ?? null, ctx.user.id])).rows[0].id as string;
  const rule = await ruleFor(db, ctx.tenant.id, "expense", i.amount);
  if (rule) {
    await db.query("update expenses set status='pending_approval' where id=$1", [id]);
    await requestApproval(db, ctx, { entityType: "expense", entityId: id, ref: number, amount: i.amount, permission: rule.approver_permission, impact: { expense: i.amount } });
  } else await postExpense(db, ctx, id);
  return { id, number };
}
async function postExpense(db: Db, ctx: TCtx, id: string) {
  const e = (await db.query("select * from expenses where id=$1 for update", [id])).rows[0];
  const j = await postJournal(db, { tenantId: ctx.tenant.id, userId: ctx.user.id, date: e.expense_date, memo: `Expense ${e.number}: ${e.description}`, sourceType: "expense", sourceId: id,
    lines: [{ account: e.account_id, debit: e.amount_paise, branchId: e.branch_id }, { account: "cash", credit: e.amount_paise }] });
  await db.query("update expenses set status='posted', journal_id=$2 where id=$1", [id, j]);
}
onDecision("expense", async (db, ctx, id, ok) => {
  if (!ok) { await db.query("update expenses set status='rejected' where id=$1", [id]); return; }
  await postExpense(db, ctx, id);
});

// ---------- periods ----------
export async function closePeriod(db: Db, ctx: TCtx, periodId: string) {
  const p = (await db.query("select * from fin_periods where id=$1 for update", [periodId])).rows[0];
  if (!p) throw new UserError("Period not found");
  if (p.status === "closed") throw new UserError("Already closed.");
  const prior = (await db.query("select label from fin_periods where tenant_id=$1 and ends_on < $2 and status='open' order by ends_on limit 1", [ctx.tenant.id, p.starts_on])).rows[0];
  if (prior) throw new UserError(`Close ${prior.label} first; periods close in order.`);
  const drafts = Number((await db.query("select count(*) c from journals where status='draft' and entry_date between $1 and $2", [p.starts_on, p.ends_on])).rows[0].c);
  if (drafts) throw new UserError(`${drafts} draft journal(s) dated in this period must be posted or deleted first.`);
  await db.query("update fin_periods set status='closed', closed_by=$2, closed_at=now() where id=$1", [periodId, ctx.user.id]);
  await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "period.closed", entityType: "fin_period", entityId: periodId, detail: { label: p.label } });
}
export async function reopenPeriod(db: Db, ctx: TCtx, periodId: string, reason: string) {
  if (reason.trim().length < 5) throw new UserError("A reason is required to reopen a period.", { reason: "Required" });
  const later = (await db.query("select label from fin_periods where tenant_id=$1 and status='closed' and starts_on > (select ends_on from fin_periods where id=$2) limit 1", [ctx.tenant.id, periodId])).rows[0];
  if (later) throw new UserError(`${later.label} is closed after this period; reopen the latest closed period first.`);
  await db.query("update fin_periods set status='open', closed_by=null, closed_at=null where id=$1", [periodId]);
  await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "period.reopened", entityType: "fin_period", entityId: periodId, reason });
}

// ---------- reporting ----------
export async function trialBalance(db: Db, tenantId: string, asOf: string) {
  return (await db.query(
    `select a.id, a.code, a.name, a.type, coalesce(sum(l.debit_paise),0) debit, coalesce(sum(l.credit_paise),0) credit
       from accounts a left join (select jl.* from journal_lines jl join journals j on j.id=jl.journal_id and j.tenant_id=jl.tenant_id
                                   where j.status in ('posted','reversed') and j.entry_date <= $2) l on l.account_id=a.id
      where a.tenant_id=$1 group by a.id order by a.code`, [tenantId, asOf])).rows as { id: string; code: string; name: string; type: string; debit: number; credit: number }[];
}
export async function profitAndLoss(db: Db, tenantId: string, from: string, to: string) {
  return (await db.query(
    `select a.code, a.name, a.type, coalesce(sum(jl.credit_paise - jl.debit_paise),0) net_credit
       from accounts a join journal_lines jl on jl.account_id=a.id and jl.tenant_id=a.tenant_id join journals j on j.id=jl.journal_id and j.tenant_id=jl.tenant_id
      where a.tenant_id=$1 and a.type in ('income','expense') and j.status in ('posted','reversed') and j.entry_date between $2 and $3 group by a.id order by a.code`, [tenantId, from, to])).rows as { code: string; name: string; type: string; net_credit: number }[];
}
export async function receivablesAgeing(db: Db, tenantId: string, asOf: string) {
  return (await db.query(
    `select c.id customer_id, c.name,
        sum(case when o <= 0 then o end) filter (where false) _x,
        coalesce(sum(case when d <= 0 then o else 0 end),0) current_amt,
        coalesce(sum(case when d between 1 and 30 then o else 0 end),0) d1_30,
        coalesce(sum(case when d between 31 and 60 then o else 0 end),0) d31_60,
        coalesce(sum(case when d between 61 and 90 then o else 0 end),0) d61_90,
        coalesce(sum(case when d > 90 then o else 0 end),0) d90_plus,
        coalesce(sum(o),0) total
       from customers c join (select customer_id, (total_paise - paid_paise - credited_paise) o, ($2::date - due_date) d from invoices
                              where tenant_id=$1 and status in ('posted','partially_paid') and issue_date <= $2) x on x.customer_id = c.id
      where c.tenant_id=$1 group by c.id, c.name order by total desc`, [tenantId, asOf])).rows;
}
/** Subledger-to-ledger checks the auditor will ask for. All differences should be zero (inventory valuation within rounding). */
export async function reconciliation(db: Db, tenantId: string) {
  const bal = async (key: string, side: "dr" | "cr") => Number((await db.query(
    `select coalesce(sum(${side === "dr" ? "jl.debit_paise - jl.credit_paise" : "jl.credit_paise - jl.debit_paise"}),0) b from journal_lines jl join accounts a on a.id=jl.account_id and a.tenant_id=jl.tenant_id
       join journals j on j.id=jl.journal_id and j.tenant_id=jl.tenant_id where a.tenant_id=$1 and a.system_key=$2 and j.status in ('posted','reversed')`, [tenantId, key])).rows[0].b);
  const ar = await bal("ar", "dr");
  const arSub = Number((await db.query("select coalesce(sum(total_paise-paid_paise-credited_paise),0) s from invoices where tenant_id=$1 and status in ('posted','partially_paid')", [tenantId])).rows[0].s);
  const unalloc = Number((await db.query("select coalesce(sum(amount_paise-allocated_paise),0) s from receipts where tenant_id=$1 and status='posted'", [tenantId])).rows[0].s);
  const refundsDue = Number((await db.query("select coalesce(sum(refund_due_paise-refunded_paise),0) s from credit_notes where tenant_id=$1", [tenantId])).rows[0].s);
  const ap = await bal("ap", "cr");
  const apSub = Number((await db.query("select coalesce(sum(total_paise-paid_paise),0) s from supplier_bills where tenant_id=$1 and status in ('posted','partially_paid')", [tenantId])).rows[0].s);
  const inv = await bal("inventory", "dr");
  const invSub = Number((await db.query(
    `select coalesce(sum(b.on_hand * i.avg_cost_paise / 1000),0)::bigint s from stock_balances b join items i on i.id=b.item_id and i.tenant_id=b.tenant_id where b.tenant_id=$1`, [tenantId])).rows[0].s);
  const stock = (await db.query(
    `select count(*) c from stock_balances b left join (select item_id, warehouse_id, sum(qty_delta) s from stock_movements where tenant_id=$1 group by 1,2) m on m.item_id=b.item_id and m.warehouse_id=b.warehouse_id where b.tenant_id=$1 and b.on_hand <> coalesce(m.s,0)`, [tenantId])).rows[0].c;
  const unbalanced = (await db.query(
    `select count(*) c from (select j.id from journals j join journal_lines l on l.journal_id=j.id where j.tenant_id=$1 and j.status <> 'draft' group by j.id having sum(l.debit_paise) <> sum(l.credit_paise)) x`, [tenantId])).rows[0].c;
  return [
    { check: "Receivables: ledger vs open invoices, receipts on account and refunds due", ledger: ar, subledger: arSub - unalloc - refundsDue },
    { check: "Payables: ledger vs open supplier bills", ledger: ap, subledger: apSub },
    { check: "Inventory: ledger vs quantity × average cost (rounding differences possible)", ledger: inv, subledger: invSub },
    { check: "Stock balances that differ from the movement ledger (count)", ledger: Number(stock), subledger: 0 },
    { check: "Posted journals that do not balance (count)", ledger: Number(unbalanced), subledger: 0 },
  ].map((r) => ({ ...r, diff: r.ledger - r.subledger }));
}
export { acct, mulDiv };
