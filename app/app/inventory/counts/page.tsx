import { requireCompany } from "@/lib/server/auth";
import { rd, locOpts } from "@/lib/server/read";
import { Page, Card, Field, Grid, Hidden, Badge, Empty } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { startCountAction, saveCountLines, postCountAction } from "../../actions3";
import { can } from "@/lib/server/perms";
export const metadata = { title: "Count sheets" };
export default async function P() {
  const a = await requireCompany("inv.read");
  const d = await rd(a, async (c) => ({ locs: await locOpts(c, "stock"), lines: (await c.query("select s.*, l.code lc from stock_counts s join locations l on l.id=s.location_id where s.status='pending' order by s.sheet, s.item_code")).rows }));
  const sheets = [...new Set(d.lines.map((l: any) => l.sheet))] as string[];
  return <Page title="Stock count sheets" crumbs={[["Stock", "/app/inventory"], ["Counts"]]} sub="Blind count: system quantities are hidden while counting. Posting adjusts each difference with a reason.">
    {can(a.membership.role, "inv.adjust") && <Card title="Start a count"><ActionForm action={startCountAction} submit="Create sheet"><Grid><Field label="Location" name="loc" required options={d.locs} /><Field label="Sheet name" name="sheet" required placeholder="CNT-2026-11-A" /></Grid></ActionForm></Card>}
    {sheets.length === 0 ? <div className="mt-4"><Empty>No open count sheets.</Empty></div> : sheets.map((s) => { const ls = d.lines.filter((l: any) => l.sheet === s); return <Card key={s} title={`${s} · ${ls[0].lc}`} className="mt-4" actions={<Badge s="pending" />}>
      <ActionForm action={saveCountLines} submit="Save counted quantities" secondary><div className="divide-y divide-line">{ls.map((l: any) => <div key={l.id} className="grid items-end gap-2 py-2 sm:grid-cols-[2fr_1fr]"><div className="text-sm">{l.item_code}{l.batch_code ? ` · batch ${l.batch_code}` : ""}</div><Field label="Counted" name={`q_${l.id}`} type="number" step="any" defaultValue={l.counted_qty} /></div>)}</div></ActionForm>
      {can(a.membership.role, "inv.adjust") && <ActionForm action={postCountAction} submit="Post differences" className="mt-4 border-t border-line pt-3" confirm="Post adjustments for every difference on this sheet?"><Hidden name="sheet" value={s} /><Field label="Reason" name="reason" required placeholder="Year-end count" /></ActionForm>}</Card>; })}</Page>;
}
