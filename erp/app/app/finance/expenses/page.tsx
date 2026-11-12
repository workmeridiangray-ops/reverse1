import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Badge, Empty } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { expenseAction } from "../actions";
import { branchesFor } from "@/lib/erp/opts";
import { formatMoney } from "@/lib/money";
export default async function Expenses() {
  const ctx = await requireTenant("finance.view");
  const d = await withTenantSystem(ctx.tenant.id, async (db) => ({ rows: (await db.query("select e.*, a.name account from expenses e join accounts a on a.id=e.account_id and a.tenant_id=e.tenant_id where e.tenant_id=$1 order by e.created_at desc limit 100", [ctx.tenant.id])).rows,
    accts: (await db.query("select id, code||' — '||name n from accounts where tenant_id=$1 and type='expense' and status='active' order by code", [ctx.tenant.id])).rows, branches: await branchesFor(db, ctx.tenant.id, ctx.membership.branchIds) }));
  return (<><PageHead title="Expenses" crumbs={[["Finance"], ["Expenses"]]} sub="Small expenses post immediately; amounts above the approval rule wait for an approver." />
    {ctx.perms.has("finance.invoice") && !ctx.readOnlyReason && <details className="drawer"><summary>+ Record expense</summary><div><ActionForm action={expenseAction} submit="Save expense" resetOnSuccess><div className="grid g3"><Field name="expense_date" label="Date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /><Field name="account_id" label="Expense account" type="select" required><option value="">Choose…</option>{d.accts.map((a: any) => <option key={a.id} value={a.id}>{a.n}</option>)}</Field><Field name="amount" label="Amount (₹)" required /></div>
      <div className="grid g3"><Field name="description" label="Description" required /><Field name="paid_via" label="Paid via" type="select"><option value="cash">Cash</option><option value="bank">Bank</option></Field><Field name="branch_id" label="Branch" type="select"><option value="">—</option>{d.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Field></div>
      <div className="field"><label className="f" htmlFor="receipt">Receipt (PDF/PNG/JPG, max 5 MB)</label><input id="receipt" name="receipt" type="file" accept=".pdf,.png,.jpg,.jpeg" /></div></ActionForm></div></details>}
    <div className="card flush">{d.rows.length === 0 ? <Empty title="No expenses recorded" /> : <div className="tablewrap"><table className="stack-sm"><thead><tr><th>Expense</th><th>Date</th><th>Description</th><th>Account</th><th>Status</th><th className="num">Amount</th></tr></thead><tbody>
      {d.rows.map((e: any) => <tr key={e.id}><td data-label="Expense">{e.number}</td><td data-label="Date">{e.expense_date}</td><td data-label="Description">{e.description}{e.file_id && <> · <a href={`/app/files/${e.file_id}`}>receipt</a></>}</td><td data-label="Account">{e.account}</td><td data-label="Status"><Badge status={e.status} /></td><td data-label="Amount" className="num">{formatMoney(e.amount_paise)}</td></tr>)}</tbody></table></div>}</div></>);
}
