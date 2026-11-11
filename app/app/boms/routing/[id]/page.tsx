import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/server/auth";
import { rd, opts } from "@/lib/server/read";
import { Page, Card, DataTable, Badge, Field, Grid, Hidden, fmt } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { addRoutingOp, releaseRouting } from "../../../actions";
import { can } from "@/lib/server/perms";
export default async function P({ params }: { params: Promise<{ id: string }> }) {
  const a = await requireCompany("master.read"); const { id } = await params; if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await rd(a, async (c) => { const r = (await c.query("select r.*, i.code from routings r join items i on i.id=r.item_id where r.id=$1", [id])).rows[0]; if (!r) return null;
    return { r, ops: (await c.query("select o.*, w.code wc, s.name sname from routing_ops o join work_centres w on w.id=o.work_centre_id left join suppliers s on s.id=o.subcontract_supplier_id where routing_id=$1 order by seq", [id])).rows, wcs: opts((await c.query("select id, code, name from work_centres order by code")).rows), sup: opts((await c.query("select id, code, name from suppliers order by code")).rows) }; });
  if (!d) notFound(); const edit = d.r.status === "draft" && can(a.membership.role, "eng.write");
  return <Page title={`Routing · ${d.r.code} v${d.r.version}`} crumbs={[["BOMs & routings", "/app/boms"], ["Routing"]]} actions={<Badge s={d.r.status} />}>
    <Card><DataTable rows={d.ops} empty="No operations yet." cols={[{ h: "Seq", r: (r: any) => r.seq, num: true }, { h: "Operation", r: (r: any) => r.name }, { h: "Work centre", r: (r: any) => r.wc }, { h: "Setup (min)", r: (r: any) => fmt(r.setup_min), num: true }, { h: "Run (min/unit)", r: (r: any) => fmt(r.run_min_per_unit, 4), num: true }, { h: "Outside", r: (r: any) => r.sname ?? "—", hideSm: true }]} />
      {edit && <><ActionForm action={addRoutingOp} submit="Add operation" className="mt-3" resetOnOk><Hidden name="routing" value={id} /><Grid cols={3}><Field label="Sequence" name="seq" type="number" required defaultValue={(d.ops.at(-1)?.seq ?? 0) + 10} /><Field label="Operation" name="name" required /><Field label="Work centre" name="wc" required options={d.wcs} /><Field label="Setup minutes" name="setup" type="number" defaultValue="0" /><Field label="Run minutes per unit" name="run" type="number" step="any" defaultValue="0" /><Field label="Outside supplier (subcontract)" name="supplier" options={d.sup} /></Grid></ActionForm>
        {can(a.membership.role, "eng.approve") && <ActionForm action={releaseRouting} submit="Release routing" className="mt-4 border-t border-line pt-3" confirm="Release this routing? Earlier released versions become obsolete."><Hidden name="id" value={id} /></ActionForm>}</>}</Card></Page>;
}
