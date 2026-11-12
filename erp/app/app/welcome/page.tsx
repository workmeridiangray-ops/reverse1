import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Badge } from "@/components/ui";
import { subscriptionOf } from "@/lib/billing";
export default async function Welcome() {
  const ctx = await requireTenant();
  const d = await withTenantSystem(ctx.tenant.id, async (db) => {
    const c = async (t: string, w = "") => Number((await db.query(`select count(*) c from ${t} where tenant_id=$1 ${w}`, [ctx.tenant.id])).rows[0].c);
    const t = (await db.query("select legal_name, gstin, address from tenants where id=$1", [ctx.tenant.id])).rows[0];
    return { biz: !!(t.gstin && t.address), branches: await c("branches", "and status='active'"), items: await c("items"), customers: await c("customers"), suppliers: await c("suppliers"), stock: await c("stock_movements"), team: await c("memberships", "and status='active'"), sub: await subscriptionOf(db, ctx.tenant.id), orders: await c("sales_orders") };
  });
  const steps: [string, boolean, string, string][] = [
    ["Business details (GSTIN, address)", d.biz, "/app/settings/business", "settings.manage"], ["Branches and warehouses", d.branches > 1, "/app/masters/branches", "masters.manage"],
    ["Items and services", d.items > 0, "/app/masters/items", "masters.manage"], ["Customers", d.customers > 0, "/app/masters/customers", "masters.manage"], ["Suppliers", d.suppliers > 0, "/app/masters/suppliers", "masters.manage"],
    ["Opening stock", d.stock > 0, "/app/inventory/counts", "inventory.adjust"], ["Invite your team", d.team > 1, "/app/settings/team", "users.manage"], ["Bulk import from CSV", false, "/app/import", "masters.manage"],
    ["Choose a plan", d.sub?.status === "active", "/app/settings/billing", "billing.manage"], ["Create your first sales order", d.orders > 0, "/app/sales/orders/new", "sales.create"],
  ];
  const done = steps.filter((s) => s[1]).length;
  return (<><PageHead title="Setup checklist" sub={`${done} of ${steps.length} steps complete — progress is detected from your data, so it is always saved.`} />
    <div className="card">{steps.map(([l, ok, h, p]) => <p key={l} className="row between" style={{ borderBottom: "1px solid var(--border)", paddingBottom: 8 }}><span>{ok ? "✔" : "○"} {l}</span>{ok ? <Badge status="done" label="done" /> : ctx.perms.has(p) ? <Link className="btn sm" href={h}>Open</Link> : <span className="small muted">needs {p}</span>}</p>)}</div>
    <p className="small muted">Sample data is not added automatically, so your books stay clean. To explore with demo data, use a separate trial company.</p></>);
}
