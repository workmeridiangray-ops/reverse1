import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Badge, Empty } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { inspectReturnAction } from "../actions";
import { formatQty, formatMoney } from "@/lib/money";
export default async function Returns() {
  const ctx = await requireTenant("sales.view");
  const rows = await withTenantSystem(ctx.tenant.id, async (db) => (await db.query(
    `select r.*, o.number order_no, i.name item, c.name customer from customer_returns r join sales_orders o on o.id=r.order_id and o.tenant_id=r.tenant_id join items i on i.id=r.item_id and i.tenant_id=r.tenant_id join customers c on c.id=o.customer_id and c.tenant_id=o.tenant_id
      where r.tenant_id=$1 and ($2::uuid[] is null or o.branch_id=any($2)) order by r.created_at desc limit 200`, [ctx.tenant.id, ctx.membership.branchIds])).rows);
  return (<><PageHead title="Customer returns" crumbs={[["Fulfilment"], ["Returns"]]} sub="Request returns from the order page. Inspection decides whether goods go back on the shelf." />
    {rows.length === 0 ? <div className="card"><Empty title="No returns">Returns you request appear here for inspection.</Empty></div> : rows.map((r: any) => (
      <div className="card" key={r.id}><div className="row between"><h3>{r.number} · {r.item} × {formatQty(r.qty)}</h3><Badge status={r.status} /></div>
        <p className="muted small">Order <Link href={`/app/sales/orders/${r.order_id}`}>{r.order_no}</Link> · {r.customer} · Reason: {r.reason} · Refund value {formatMoney(r.refund_net_paise + r.refund_tax_paise)}</p>
        {r.status === "closed" && <p>Outcome: <strong>{r.outcome === "restock" ? "Restocked" : "Rejected (not restocked)"}</strong> — {r.inspection_note}</p>}
        {r.status === "requested" && ctx.perms.has("inventory.post") && !ctx.readOnlyReason && <ActionForm action={inspectReturnAction.bind(null, r.id)} submit="Record inspection">
          <div className="grid g2"><Field name="outcome" label="Outcome" type="select" required><option value="">Choose…</option><option value="restock">Good — return to stock</option><option value="reject">Rejected — do not restock</option></Field><Field name="note" label="Inspection note" required /></div></ActionForm>}
      </div>))}</>);
}
