import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Badge, Empty, Pager } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { paging, sp1, pages, type SP } from "@/lib/list";
import { reverseReceiptAction } from "../actions";
import { formatMoney } from "@/lib/money";
export default async function Receipts({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireTenant("finance.view"); const sp = await searchParams; const { page, limit, offset } = paging(sp); void sp1;
  const d = await withTenantSystem(ctx.tenant.id, async (db) => ({ total: Number((await db.query("select count(*) c from receipts where tenant_id=$1", [ctx.tenant.id])).rows[0].c),
    rows: (await db.query(`select r.*, c.name customer from receipts r join customers c on c.id=r.customer_id and c.tenant_id=r.tenant_id where r.tenant_id=$1 order by r.created_at desc limit ${limit} offset ${offset}`, [ctx.tenant.id])).rows }));
  return (<><PageHead title="Receipts" crumbs={[["Finance"], ["Receipts"]]} sub="Money collected from customers and how it was allocated to invoices.">{ctx.perms.has("finance.receipts") && <Link className="btn primary" href="/app/finance/receipts/new">Record receipt</Link>}</PageHead>
    <div className="card flush">{d.rows.length === 0 ? <Empty title="No receipts yet" /> : <div className="tablewrap"><table className="stack-sm"><thead><tr><th>Receipt</th><th>Customer</th><th>Date</th><th>Method</th><th>Status</th><th className="num">Amount</th><th className="num">On account</th><th></th></tr></thead><tbody>
      {d.rows.map((r: any) => <tr key={r.id}><td data-label="Receipt">{r.number}</td><td data-label="Customer">{r.customer}</td><td data-label="Date">{r.received_on}</td><td data-label="Method">{r.method}{r.reference && ` · ${r.reference}`}</td><td data-label="Status"><Badge status={r.status} /></td><td data-label="Amount" className="num">{formatMoney(r.amount_paise)}</td><td data-label="On account" className="num">{formatMoney(r.amount_paise - r.allocated_paise)}</td>
        <td>{r.status === "posted" && ctx.perms.has("finance.reverse") && !ctx.readOnlyReason && <details><summary className="btn sm">Reverse</summary><ActionForm action={reverseReceiptAction.bind(null, r.id)} submit="Reverse receipt" danger confirm="Reverse this receipt? Linked invoices become unpaid again."><Field name="reason" label="Reason (required)" required /></ActionForm></details>}</td></tr>)}</tbody></table></div>}
      <Pager page={page} pages={pages(d.total)} total={d.total} base="/app/finance/receipts" params={{}} /></div></>);
}
