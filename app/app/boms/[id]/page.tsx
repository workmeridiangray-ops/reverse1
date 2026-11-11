import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/server/auth";
import { rd, itemOpts } from "@/lib/server/read";
import { Page, Card, DataTable, A, Badge, Field, Grid, Hidden, Note, fmt } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { addBomLine, removeBomLine, submitBom } from "../../actions";
import { can } from "@/lib/server/perms";
import { loadBoms } from "@/lib/server/svc/engineering";
import { explode } from "@/lib/domain/bom";
export default async function P({ params }: { params: Promise<{ id: string }> }) {
  const a = await requireCompany("master.read"); const { id } = await params; if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await rd(a, async (c) => {
    const b = (await c.query("select b.*, i.code, i.name from boms b join items i on i.id=b.item_id where b.id=$1", [id])).rows[0]; if (!b) return null;
    const lines = (await c.query("select l.*, i.code, i.name, i.uom, s.code scode from bom_lines l join items i on i.id=l.component_item_id left join items s on s.id=l.substitute_item_id where l.bom_id=$1 order by i.code", [id])).rows;
    const boms = await loadBoms(c, new Date().toISOString().slice(0, 10)); const tmp = new Map(boms); tmp.set(b.item_id, { item: b.item_id, bomId: id, version: b.version, yieldPct: Number(b.yield_pct), lines: lines.map((l: any) => ({ component: l.component_item_id, qtyPer: Number(l.qty_per), scrapPct: Number(l.scrap_pct) })) });
    let tree: any[] = [], cyc = ""; try { tree = explode(b.item_id, 1, (i) => tmp.get(i)); } catch (e: any) { cyc = e.message; }
    const names = new Map((await c.query("select id, code from items")).rows.map((r: any) => [r.id, r.code]));
    return { b, lines, tree: tree.map((t) => ({ ...t, code: names.get(t.item), parentCode: names.get(t.parent) })), cyc, items: await itemOpts(c) };
  });
  if (!d) notFound(); const { b } = d; const edit = b.status === "draft" && can(a.membership.role, "eng.write");
  return <Page title={`BOM · ${b.code} v${b.version}`} crumbs={[["BOMs", "/app/boms"], [`${b.code} v${b.version}`]]} sub={b.name} actions={<Badge s={b.status} />}>
    {b.status === "released" && <Note>Released and frozen. To change it, create a new version and submit it for approval — open jobs will be listed.</Note>}
    {b.status === "pending" && <Note tone="warn">Awaiting approval in <A href="/app/changes">Engineering changes</A>.</Note>}
    {d.cyc && <Note tone="danger">{d.cyc}</Note>}
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={`Components (yield ${Number(b.yield_pct)}%)`}><DataTable rows={d.lines} empty="No components yet." cols={[{ h: "Component", r: (r: any) => <A href={`/app/items/${r.component_item_id}`}>{r.code}</A> }, { h: "Qty per", r: (r: any) => `${fmt(r.qty_per, 6)} ${r.uom}`, num: true }, { h: "Scrap %", r: (r: any) => fmt(r.scrap_pct), num: true }, { h: "Substitute", r: (r: any) => r.scode ?? "—", hideSm: true },
        ...(edit ? [{ h: "", r: (r: any) => <ActionForm action={removeBomLine} submit="Remove" small danger confirm="Remove this component?"><Hidden name="id" value={r.id} /></ActionForm> }] : [])]} />
        {edit && <ActionForm action={addBomLine} submit="Add component" className="mt-3" resetOnOk><Hidden name="bom" value={b.id} /><Grid cols={2}><Field label="Component" name="comp" required options={d.items} /><Field label="Quantity per parent" name="qty" type="number" step="any" required /><Field label="Scrap allowance %" name="scrap" type="number" defaultValue="0" /><Field label="Approved substitute" name="sub" options={d.items} /></Grid></ActionForm>}
        {edit && <ActionForm action={submitBom} submit="Submit for approval" className="mt-4 border-t border-line pt-3"><Hidden name="id" value={b.id} /><Field label="Reason for this release" name="reason" required placeholder="e.g. Replace seal with higher-grade part" /></ActionForm>}</Card>
      <Card title="Multi-level explosion (per 1 unit)"><DataTable rows={d.tree} empty="Nothing to explode." cols={[{ h: "Level", r: (r: any) => r.level, num: true }, { h: "Component", r: (r: any) => <span style={{ paddingLeft: (r.level - 1) * 12 }}>{r.code}</span> }, { h: "Under", r: (r: any) => r.parentCode, hideSm: true }, { h: "Qty", r: (r: any) => fmt(r.qty, 4), num: true }]} /></Card>
    </div></Page>;
}
