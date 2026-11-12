import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { LineGrid } from "@/components/LineGrid";
import { itemOptions, branchesFor, warehousesFor, customersList } from "@/lib/erp/opts";
import { createOrderAction } from "../../actions";
export default async function NewOrder() {
  const ctx = await requireTenant("sales.create");
  const d = await withTenantSystem(ctx.tenant.id, async (db) => ({ items: await itemOptions(db, ctx.tenant.id, "sale"), branches: await branchesFor(db, ctx.tenant.id, ctx.membership.branchIds), whs: await warehousesFor(db, ctx.tenant.id, ctx.membership.branchIds), customers: await customersList(db, ctx.tenant.id) }));
  return (<><PageHead title="New sales order" crumbs={[["Sales"], ["Orders", "/app/sales/orders"], ["New"]]} />
    <ActionForm action={createOrderAction} submit="Save draft order">
      <div className="card"><div className="grid g3">
        <Field name="customer_id" label="Customer" type="select" required><option value="">Choose…</option>{d.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Field>
        <Field name="branch_id" label="Branch" type="select" required>{d.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Field>
        <Field name="warehouse_id" label="Fulfil from warehouse" type="select" required>{d.whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Field></div>
        <div className="grid g2"><Field name="promised_date" label="Promised delivery date" type="date" /><Field name="notes" label="Notes" type="textarea" /></div></div>
      <div className="card"><h2>Lines</h2><LineGrid items={d.items} mode="sale" /></div>
    </ActionForm></>);
}
