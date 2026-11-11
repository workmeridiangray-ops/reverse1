import { requireCompany } from "@/lib/server/auth";
import { rd, itemOpts } from "@/lib/server/read";
import { Page, Card, DataTable, A, Badge, Field, Grid, date } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { createBom, createRouting } from "../actions";
import { can } from "@/lib/server/perms";
export const metadata = { title: "BOMs & routings" };
export default async function P() {
  const a = await requireCompany("master.read");
  const d = await rd(a, async (c) => ({ boms: (await c.query("select b.*, i.code, i.name from boms b join items i on i.id=b.item_id order by i.code, b.version desc")).rows, rts: (await c.query("select r.*, i.code from routings r join items i on i.id=r.item_id order by i.code, r.version desc")).rows, items: await itemOpts(c, "active and kind <> 'buy'") }));
  const w = can(a.membership.role, "eng.write");
  return <Page title="Bills of materials & routings" sub="Released BOMs are frozen; changes go through an engineering change request that lists affected open jobs.">
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Bills of materials"><DataTable rows={d.boms} empty="No BOMs yet." cols={[{ h: "Item", r: (r: any) => <A href={`/app/boms/${r.id}`}>{r.code}</A> }, { h: "Ver", r: (r: any) => r.version, num: true }, { h: "Effective", r: (r: any) => date(r.effective_from), hideSm: true }, { h: "Status", r: (r: any) => <Badge s={r.status} /> }]} />
        {w && <ActionForm action={createBom} submit="New BOM version" className="mt-3"><Grid><Field label="Item" name="item" required options={d.items} /><Field label="Yield %" name="yield" type="number" defaultValue="100" hint="Loss in making the item; raises component need." /><Field label="Effective from" name="from" type="date" /></Grid></ActionForm>}</Card>
      <Card title="Routings"><DataTable rows={d.rts} empty="No routings yet." cols={[{ h: "Item", r: (r: any) => <A href={`/app/boms/routing/${r.id}`}>{r.code}</A> }, { h: "Ver", r: (r: any) => r.version, num: true }, { h: "Status", r: (r: any) => <Badge s={r.status} /> }]} />
        {w && <ActionForm action={createRouting} submit="New routing version" className="mt-3"><Field label="Item" name="item" required options={d.items} /></ActionForm>}</Card>
    </div></Page>;
}
