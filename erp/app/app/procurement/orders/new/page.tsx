import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { LineGrid } from "@/components/LineGrid";
import { itemOptions, branchesFor, warehousesFor, suppliersList } from "@/lib/erp/opts";
import { createPOAction } from "../../actions";
export default async function NewPO() {
  const ctx = await requireTenant("procurement.create");
  const d = await withTenantSystem(ctx.tenant.id, async (db) => ({ items: await itemOptions(db, ctx.tenant.id, "purchase", true), branches: await branchesFor(db, ctx.tenant.id, ctx.membership.branchIds), whs: await warehousesFor(db, ctx.tenant.id, ctx.membership.branchIds), sups: await suppliersList(db, ctx.tenant.id) }));
  return (<><PageHead title="New purchase order" crumbs={[["Purchasing"], ["Orders", "/app/procurement/orders"], ["New"]]} />
    <ActionForm action={createPOAction} submit="Save draft order"><div className="card"><div className="grid g3">
      <Field name="supplier_id" label="Supplier" type="select" required><option value="">Choose…</option>{d.sups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Field>
      <Field name="branch_id" label="Branch" type="select" required>{d.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Field>
      <Field name="warehouse_id" label="Receive into" type="select" required>{d.whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Field></div>
      <div className="grid g2"><Field name="expected_date" label="Expected delivery" type="date" /><Field name="notes" label="Notes" type="textarea" /></div></div>
      <div className="card"><h2>Lines</h2><LineGrid items={d.items} mode="purchase" showDiscount={false} /></div></ActionForm></>);
}
