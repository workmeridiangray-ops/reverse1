import { requireCompany } from "@/lib/server/auth";
import { rd } from "@/lib/server/read";
import { Page, Card, DataTable, Field, Grid, Hidden } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { savePartner } from "../actions";
import { can } from "@/lib/server/perms";
export const metadata = { title: "Customers & suppliers" };
export default async function P() {
  const a = await requireCompany("master.read");
  const d = await rd(a, async (c) => ({ cu: (await c.query("select * from customers order by code")).rows, su: (await c.query("select * from suppliers order by code")).rows }));
  const w = can(a.membership.role, "master.write");
  const block = (title: string, type: string, rows: any[]) => <Card title={title}><DataTable rows={rows} empty={`No ${type}s yet.`} cols={[{ h: "Code", r: (r: any) => r.code }, { h: "Name", r: (r: any) => r.name }, { h: "Email", r: (r: any) => r.email ?? "—", hideSm: true }]} />
    {w && <ActionForm action={savePartner} submit={`Add ${type}`} className="mt-3" resetOnOk><Hidden name="type" value={type} /><Grid cols={3}><Field label="Code" name="code" required /><Field label="Name" name="name" required /><Field label="Email" name="email" type="email" /></Grid></ActionForm>}</Card>;
  return <Page title="Customers & suppliers" sub="Invite portal users for a customer or supplier from Settings → Team.">
    <div className="grid gap-4 lg:grid-cols-2">{block("Customers", "customer", d.cu)}{block("Suppliers", "supplier", d.su)}</div></Page>;
}
