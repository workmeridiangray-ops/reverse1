import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Kpi, Badge, Alert } from "@/components/ui";
import { formatMoney, formatQty } from "@/lib/money";
import { reorderSuggestions } from "@/lib/erp/stock";

export const metadata = { title: "Dashboard" };
export default async function Dashboard() {
  const ctx = await requireTenant(); const p = ctx.perms; const sc = ctx.membership.branchIds;
  const d = await withTenantSystem(ctx.tenant.id, async (db) => {
    const one = async (sql: string, a: any[] = []) => (await db.query(sql, sql.includes("$2") ? [ctx.tenant.id, sc, ...a] : [ctx.tenant.id, ...a])).rows[0];
    const out: any = {};
    if (p.has("sales.view")) { out.openOrders = (await one("select count(*) c, coalesce(sum(total_paise),0) v from sales_orders where tenant_id=$1 and ($2::uuid[] is null or branch_id=any($2)) and status in ('confirmed','partially_fulfilled','credit_hold')")); out.holds = Number((await one("select count(*) c from sales_orders where tenant_id=$1 and ($2::uuid[] is null or branch_id=any($2)) and status='credit_hold'")).c); out.short = Number((await one("select count(*) c from sales_order_lines l join sales_orders o on o.id=l.order_id and o.tenant_id=l.tenant_id where o.tenant_id=$1 and ($2::uuid[] is null or o.branch_id=any($2)) and o.status in ('confirmed','partially_fulfilled') and l.qty > l.reserved_qty + l.dispatched_qty")).c); }
    if (p.has("finance.view")) { out.ar = await one("select coalesce(sum(total_paise-paid_paise-credited_paise),0) v, coalesce(sum(case when due_date<current_date then total_paise-paid_paise-credited_paise else 0 end),0) od from invoices where tenant_id=$1 and ($2::uuid[] is null or branch_id=any($2)) and status in ('posted','partially_paid')");
      out.ap = await one("select coalesce(sum(total_paise-paid_paise),0) v from supplier_bills where tenant_id=$1 and $2::uuid[] is null and status in ('posted','partially_paid')"); }
    if (p.has("procurement.view")) out.openPO = Number((await one("select count(*) c from purchase_orders where tenant_id=$1 and ($2::uuid[] is null or branch_id=any($2)) and status in ('approved','sent','acknowledged','partially_received')")).c);
    if (p.has("approvals.decide")) out.pending = Number((await db.query("select count(*) c from approval_requests where tenant_id=$1 and status='pending' and requested_by <> $2 and approver_permission = any($3)", [ctx.tenant.id, ctx.user.id, [...p]])).rows[0].c);
    if (p.has("inventory.view")) out.reorder = (await reorderSuggestions(db, ctx.tenant.id)).length;
    out.recent = (await db.query("select action, entity_type, created_at from audit_log where tenant_id=$1 and actor_user_id=$2 order by id desc limit 6", [ctx.tenant.id, ctx.user.id])).rows;
    out.setup = ctx.tenant.setup ?? {};
    out.items = Number((await one("select count(*) c from items where tenant_id=$1")).c);
    return out;
  });
  return (<><PageHead title={`Welcome, ${ctx.user.name.split(" ")[0]}`} sub={`${ctx.tenant.name} · ${ctx.membership.roleName}`} />
    {d.items === 0 && ctx.perms.has("masters.manage") && <Alert tone="info">Your company is empty. Follow the <Link href="/app/welcome">setup checklist</Link> to add items, customers and opening stock.</Alert>}
    <div className="kpis">
      {d.openOrders && <Kpi label="Open sales orders" value={d.openOrders.c} hint={`${formatMoney(d.openOrders.v)} booked`} />}
      {d.ar && <Kpi label="Receivables" value={formatMoney(d.ar.v)} hint={`${formatMoney(d.ar.od)} overdue`} />}
      {d.ap && <Kpi label="Payables" value={formatMoney(d.ap.v)} />}
      {d.openPO !== undefined && <Kpi label="Open purchase orders" value={d.openPO} />}
      {d.short !== undefined && <Kpi label="Order lines short of stock" value={d.short} hint={d.short ? "see Shortages" : "all covered"} />}
      {d.holds !== undefined && <Kpi label="Orders on credit hold" value={d.holds} />}
      {d.reorder !== undefined && <Kpi label="Items to reorder" value={d.reorder} />}
      {d.pending !== undefined && <Kpi label="Approvals waiting for you" value={d.pending} />}
    </div>
    <div className="grid g2">
      <div className="card"><h2>Do next</h2><ul>
        {p.has("sales.create") && <li><Link href="/app/sales/orders/new">Create a sales order</Link></li>}
        {p.has("sales.view") && d.short > 0 && <li><Link href="/app/sales/shortages">Resolve {d.short} short order line(s)</Link></li>}
        {p.has("approvals.decide") && d.pending > 0 && <li><Link href="/app/approvals">Decide {d.pending} approval(s)</Link></li>}
        {p.has("finance.receipts") && <li><Link href="/app/finance/receipts/new">Record a customer receipt</Link></li>}
        {p.has("inventory.post") && <li><Link href="/app/inventory/transfers">Transfer or count stock</Link></li>}
        {p.has("reports.view") && <li><Link href="/app/reports">Open the report library</Link></li>}
      </ul></div>
      <div className="card"><h2>Your recent activity</h2>{d.recent.length === 0 ? <p className="muted">Nothing yet.</p> : <ul>{d.recent.map((r: any, i: number) => <li key={i}>{r.action.replace(/[._]/g, " ")} <span className="muted small">· {new Date(r.created_at).toLocaleString("en-IN")}</span></li>)}</ul>}</div>
    </div>
    <p className="small muted">Figures are live from the ledger and stock records. {sc ? "Limited to your assigned branches." : ""}</p></>);
}
void formatQty; void Badge;
