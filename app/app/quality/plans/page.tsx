import { requireCompany } from "@/lib/server/auth";
import { rd, itemOpts } from "@/lib/server/read";
import { Page, Card, DataTable, Field, Grid, fmt } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { savePlanAction } from "../../actions3";
import { can } from "@/lib/server/perms";
export const metadata = { title: "Inspection plans" };
export default async function P() {
  const a = await requireCompany("qa.read");
  const d = await rd(a, async (c) => ({ rows: (await c.query("select p.*, i.code from inspection_plans p join items i on i.id=p.item_id order by i.code, p.kind")).rows, items: await itemOpts(c) }));
  return <Page title="Inspection plans" crumbs={[["Quality", "/app/quality"], ["Plans"]]} sub="Characteristic and limits copied onto every incoming and final inspection of the item. Out-of-limit values cannot be passed.">
    <DataTable rows={d.rows} empty="No plans yet." cols={[{ h: "Item", r: (r: any) => r.code }, { h: "Applies to", r: (r: any) => r.kind.replace("_", " ") }, { h: "Characteristic", r: (r: any) => r.characteristic }, { h: "Min", r: (r: any) => (r.min_value == null ? "—" : fmt(r.min_value, 4)), num: true }, { h: "Max", r: (r: any) => (r.max_value == null ? "—" : fmt(r.max_value, 4)), num: true }, { h: "Unit", r: (r: any) => r.unit ?? "" }]} />
    {can(a.membership.role, "qa.write") && <Card title="Add / update plan line" className="mt-4"><ActionForm action={savePlanAction} submit="Save" resetOnOk><Grid cols={3}><Field label="Item" name="item" required options={d.items} /><Field label="Applies to" name="kind" required options={[{ value: "incoming", label: "Incoming" }, { value: "in_process", label: "In-process" }, { value: "final", label: "Final" }]} /><Field label="Characteristic" name="ch" required placeholder="Bore diameter" /><Field label="Min" name="min" type="number" step="any" /><Field label="Max" name="max" type="number" step="any" /><Field label="Unit" name="unit" placeholder="mm" /></Grid></ActionForm></Card>}</Page>;
}
