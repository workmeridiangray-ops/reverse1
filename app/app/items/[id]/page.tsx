import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/server/auth";
import { rd, opts, itemOpts } from "@/lib/server/read";
import { Page, Card, Field, Grid, Hidden, DataTable, A, Badge, fmt, date, dt } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { saveItem, reviseItem, saveConversion, addAlternate } from "../../actions";
import { can } from "@/lib/server/perms";
import { audit } from "@/lib/server/audit";
export default async function P({ params }: { params: Promise<{ id: string }> }) {
  const a = await requireCompany("master.read"); const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await rd(a, async (c) => {
    const item = (await c.query("select * from items where id=$1", [id])).rows[0]; if (!item) return null;
    return { item, revs: (await c.query("select * from item_revisions where item_id=$1 order by created_at desc", [id])).rows,
      stock: (await c.query("select l.code loc, ba.code batch, ba.status, b.qty from stock_balances b join locations l on l.id=b.location_id left join batches ba on ba.id=b.batch_id where b.item_id=$1", [id])).rows,
      moves: (await c.query("select m.*, l.code loc from stock_movements m join locations l on l.id=m.location_id where m.item_id=$1 order by m.seq desc limit 15", [id])).rows,
      conv: (await c.query("select * from uom_conversions where item_id=$1 or item_id is null", [id])).rows, alts: (await c.query("select i.code from item_alternates x join items i on i.id=x.alternate_item_id where x.item_id=$1", [id])).rows,
      boms: (await c.query("select id, version, status from boms where item_id=$1 order by version desc", [id])).rows, items: await itemOpts(c) };
  });
  if (!d) notFound(); const i = d.item; const w = can(a.membership.role, "master.write");
  return <Page title={`${i.code} · ${i.name}`} crumbs={[["Items", "/app/items"], [i.code]]} sub={`${i.kind} item · revision ${i.revision} · ${i.uom}`} actions={<Badge s={i.active ? "active" : "obsolete"} />}>
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Planning & costing" className="lg:col-span-2">{w ? <ActionForm action={saveItem} submit="Save changes"><Hidden name="id" value={i.id} /><Hidden name="version" value={i.version} /><Hidden name="kind" value={i.kind} /><Grid cols={3}>
        <Field label="Name" name="name" defaultValue={i.name} required className="sm:col-span-3" /><Field label="Lot size" name="lot" type="number" defaultValue={i.lot_size} /><Field label="Lead time (working days)" name="lt" type="number" defaultValue={i.lead_time_days} /><Field label="Safety stock" name="ss" type="number" defaultValue={i.safety_stock} />
        <Field label="Standard cost (₹)" name="std" defaultValue={(i.std_cost_paise / 100).toFixed(2)} /><label className="mt-6 flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={i.active} className="h-4 w-4" /> Active</label></Grid></ActionForm>
        : <dl className="grid grid-cols-2 gap-2 text-sm"><dt>Lot size</dt><dd>{i.lot_size}</dd><dt>Lead time</dt><dd>{i.lead_time_days} d</dd><dt>Safety stock</dt><dd>{i.safety_stock}</dd></dl>}</Card>
      <Card title="Revisions">{can(a.membership.role, "eng.approve") && <ActionForm action={reviseItem} submit="Approve new revision" small secondary><Hidden name="id" value={i.id} /><Field label="New revision" name="rev" required placeholder="B" /><Field label="What changed" name="notes" className="mt-2" /></ActionForm>}
        <ul className="mt-3 space-y-1 text-sm">{d.revs.map((r: any) => <li key={r.id} className="flex justify-between"><span>Rev {r.rev} {r.notes && <span className="text-muted">— {r.notes}</span>}</span><Badge s={r.status} /></li>)}</ul></Card>
    </div>
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <Card title="Stock by location & batch"><DataTable rows={d.stock} empty="No stock." cols={[{ h: "Location", r: (r: any) => r.loc }, { h: "Batch", r: (r: any) => r.batch ?? "—" }, { h: "Status", r: (r: any) => (r.status ? <Badge s={r.status} /> : "—") }, { h: "Qty", r: (r: any) => fmt(r.qty, 3), num: true }]} /></Card>
      <Card title="Recent movements"><DataTable rows={d.moves} empty="No movements." cols={[{ h: "When", r: (r: any) => dt(r.posted_at) }, { h: "Kind", r: (r: any) => r.kind }, { h: "Loc", r: (r: any) => r.loc }, { h: "Qty", r: (r: any) => fmt(r.qty, 3), num: true }]} /></Card>
      <Card title="BOM versions">{d.boms.length ? <ul className="text-sm">{d.boms.map((b: any) => <li key={b.id} className="flex justify-between py-1"><A href={`/app/boms/${b.id}`}>Version {b.version}</A><Badge s={b.status} /></li>)}</ul> : <p className="text-sm text-muted">No BOM. {i.kind !== "buy" && <A href="/app/boms">Create one</A>}</p>}</Card>
      <Card title="Unit conversions & alternates">
        <ul className="mb-2 text-sm">{d.conv.map((c: any) => <li key={c.id}>1 {c.from_uom} = {Number(c.factor)} {c.to_uom}{!c.item_id && <span className="text-muted"> (global)</span>}</li>)}{d.conv.length === 0 && <li className="text-muted">No approved conversions.</li>}</ul>
        {w && <ActionForm action={saveConversion} submit="Approve conversion" small secondary resetOnOk><Hidden name="item" value={i.id} /><Grid cols={3}><Field label="From" name="from" required placeholder="KG" /><Field label="To" name="to" required placeholder="G" /><Field label="Factor" name="factor" type="number" required placeholder="1000" /></Grid></ActionForm>}
        <p className="mt-3 text-sm">Approved alternates: {d.alts.map((x: any) => x.code).join(", ") || "none"}</p>
        {w && <ActionForm action={addAlternate} submit="Add alternate" small secondary resetOnOk><Hidden name="item" value={i.id} /><Field label="Alternate item" name="alt" required options={d.items.filter((o: any) => o.value !== i.id)} /></ActionForm>}</Card>
    </div>
  </Page>;
}
void opts; void date; void audit;
