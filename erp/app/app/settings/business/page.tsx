import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { saveBusinessAction } from "../actions";
export default async function Business() {
  const ctx = await requireTenant("settings.manage");
  const t = await withTenantSystem(ctx.tenant.id, async (db) => (await db.query("select * from tenants where id=$1", [ctx.tenant.id])).rows[0]);
  return (<><PageHead title="Business settings" crumbs={[["Company"], ["Business"]]} sub="Shown on invoices and delivery notes. Currency is INR; language is English." />
    <div className="card"><ActionForm action={saveBusinessAction} submit="Save"><div className="grid g2"><Field name="name" label="Display name" defaultValue={t.name} required /><Field name="legal_name" label="Legal name" defaultValue={t.legal_name} required />
      <Field name="gstin" label="GSTIN" defaultValue={t.gstin} hint="15 characters" /><Field name="pan" label="PAN" defaultValue={t.pan} /><Field name="phone" label="Phone" defaultValue={t.phone} /><Field name="footer" label="Invoice footer note" defaultValue={t.branding?.footer} /></div>
      <Field name="address" label="Registered address" type="textarea" defaultValue={t.address} /></ActionForm></div></>);
}
