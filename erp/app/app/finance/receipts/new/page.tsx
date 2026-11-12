import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Alert } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { receiptAction } from "../../actions";
import { customersList } from "@/lib/erp/opts";
import { formatMoney } from "@/lib/money";
import { sp1, type SP } from "@/lib/list";
export default async function NewReceipt({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireTenant("finance.receipts"); const sp = await searchParams; const cust = sp1(sp.customer);
  const d = await withTenantSystem(ctx.tenant.id, async (db) => ({ customers: await customersList(db, ctx.tenant.id),
    invoices: /^[0-9a-f-]{36}$/.test(cust) ? (await db.query("select id, number, due_date, total_paise - paid_paise - credited_paise bal from invoices where tenant_id=$1 and customer_id=$2 and status in ('posted','partially_paid') order by due_date", [ctx.tenant.id, cust])).rows : [] }));
  return (<><PageHead title="Record receipt" crumbs={[["Finance"], ["Receipts", "/app/finance/receipts"], ["New"]]} />
    <form className="toolbar" method="get"><div><label className="f" htmlFor="customer">Customer</label><select id="customer" name="customer" defaultValue={cust}><option value="">Choose…</option>{d.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div><button className="btn">Show open invoices</button></form>
    {cust && <ActionForm action={receiptAction} submit="Record receipt"><input type="hidden" name="customer_id" value={cust} />
      <div className="card"><div className="grid g3"><Field name="amount" label="Amount received (₹)" required /><Field name="method" label="Method" type="select"><option value="bank">Bank transfer</option><option value="upi">UPI</option><option value="cheque">Cheque</option><option value="cash">Cash</option><option value="card">Card</option></Field><Field name="received_on" label="Date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></div><Field name="reference" label="Reference (UTR / cheque no.)" /></div>
      <div className="card"><h2>Allocate to invoices</h2>{d.invoices.length === 0 ? <Alert tone="info">No open invoices for this customer. The money will be held on account and can be allocated later.</Alert> : <div className="tablewrap"><table><thead><tr><th>Invoice</th><th>Due</th><th className="num">Balance</th><th>Allocate (₹)</th></tr></thead><tbody>
        {d.invoices.map((i: any) => <tr key={i.id}><td>{i.number}</td><td>{i.due_date}</td><td className="num">{formatMoney(i.bal)}</td><td style={{ width: 160 }}><input aria-label={`Allocate to ${i.number}`} name={`alloc_${i.id}`} inputMode="decimal" placeholder="0.00" /></td></tr>)}</tbody></table></div>}
        <p className="hint">Any amount not allocated stays on account for this customer.</p></div></ActionForm>}</>);
}
