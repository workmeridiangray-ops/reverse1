import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { LineGrid } from "@/components/LineGrid";
import { itemOptions, branchesFor, customersList } from "@/lib/erp/opts";
import { createQuoteAction } from "../../actions";

export default async function NewQuote() {
  const ctx = await requireTenant("sales.create");
  const d = await withTenantSystem(ctx.tenant.id, async (db) => ({ items: await itemOptions(db, ctx.tenant.id, "sale"), branches: await branchesFor(db, ctx.tenant.id, ctx.membership.branchIds), customers: await customersList(db, ctx.tenant.id) }));
  return (<><PageHead title="New quotation" crumbs={[["Sales"], ["Quotations", "/app/sales/quotes"], ["New"]]} />
    <ActionForm action={createQuoteAction} submit="Save draft quotation">
      <div className="card"><div className="grid g3">
        <Field name="customer_id" label="Customer" type="select" required><option value="">Choose…</option>{d.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Field>
        <Field name="branch_id" label="Branch" type="select" required>{d.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Field>
        <Field name="valid_until" label="Valid until" type="date" /></div>
        <Field name="notes" label="Notes to customer" type="textarea" /></div>
      <div className="card"><h2>Lines</h2><p className="muted small">Prices default from the customer’s price list or the item. Leave price blank to use the list price.</p><LineGrid items={d.items} mode="sale" /></div>
    </ActionForm></>);
}
