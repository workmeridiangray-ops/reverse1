import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Empty } from "@/components/ui";
import { shortageLines } from "@/lib/erp/sales";
import { formatQty } from "@/lib/money";
import { StatusButton } from "@/components/StatusButton";
import { raisePRAction } from "../actions";
export default async function Shortages() {
  const ctx = await requireTenant("sales.view");
  const rows = await withTenantSystem(ctx.tenant.id, (db) => shortageLines(db, ctx.tenant.id));
  const byOrder = new Map<string, any[]>(); for (const r of rows) byOrder.set(r.order_id, [...(byOrder.get(r.order_id) ?? []), r]);
  return (<><PageHead title="Shortages and backorders" crumbs={[["Sales"], ["Shortages"]]} sub="Confirmed orders waiting for stock. Receipts allocate to the oldest order first." />
    <div className="card flush">{rows.length === 0 ? <Empty title="No shortages">Every confirmed order is fully covered by reserved stock or dispatched goods.</Empty> :
      <div className="tablewrap"><table className="stack-sm"><thead><tr><th>Order</th><th>Customer</th><th>Item</th><th className="num">Short</th><th className="num">Already requested</th><th></th></tr></thead><tbody>
        {rows.map((r: any) => <tr key={r.line_id}><td data-label="Order"><Link href={`/app/sales/orders/${r.order_id}`}>{r.number}</Link></td><td data-label="Customer">{r.customer}</td><td data-label="Item">{r.sku} — {r.item}</td><td data-label="Short" className="num">{formatQty(r.short)}</td><td data-label="Requested" className="num">{formatQty(r.requested)}</td>
          <td>{ctx.perms.has("procurement.create") && !ctx.readOnlyReason && r.short > r.requested ? (byOrder.get(r.order_id)![0] === r ? <StatusButton className="btn sm" action={raisePRAction.bind(null, r.order_id)} label="Raise purchase request" /> : null) : r.short <= r.requested ? <span className="small muted">covered by request</span> : null}</td></tr>)}</tbody></table></div>}</div></>);
}
