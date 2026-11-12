import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { LineGrid } from "@/components/LineGrid";
import { itemOptions, branchesFor, suppliersList } from "@/lib/erp/opts";
import { createPRAction } from "../../actions";
export default async function NewPR() {
  const ctx = await requireTenant("procurement.create");
  const d = await withTenantSystem(ctx.tenant.id, async (db) => ({ items: await itemOptions(db, ctx.tenant.id, "purchase", true), branches: await branchesFor(db, ctx.tenant.id, ctx.membership.branchIds), sups: await suppliersList(db, ctx.tenant.id), deps: (await db.query("select id, name from departments where tenant_id=$1 and status='active' order by name", [ctx.tenant.id])).rows }));
  return (<><PageHead title="New purchase request" crumbs={[["Purchasing"], ["Requests", "/app/procurement/requests"], ["New"]]} />
    <ActionForm action={createPRAction} submit="Save request"><div className="card"><div className="grid g3">
      <Field name="branch_id" label="Branch" type="select" required>{d.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Field>
      <Field name="department_id" label="Department" type="select"><option value="">—</option>{d.deps.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</Field>
      <Field name="supplier_id" label="Preferred supplier" type="select"><option value="">Decide at conversion</option>{d.sups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Field></div>
      <Field name="reason" label="Reason" type="textarea" /></div>
      <div className="card"><h2>Items</h2><p className="muted small">Price is the estimated unit cost (optional).</p><LineGrid items={d.items} mode="purchase" showDiscount={false} /></div></ActionForm></>);
}
