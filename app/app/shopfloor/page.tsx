import { requireCompany } from "@/lib/server/auth";
import { rd, opts } from "@/lib/server/read";
import { Page, Card, Badge, A, Hidden, Field, Empty, date, fmt } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { opAct, downtimeAction } from "../actions";
export const metadata = { title: "Shop floor" };
export const dynamic = "force-dynamic";
export default async function P() {
  const a = await requireCompany("shop.operate");
  const d = await rd(a, async (c) => ({ ops: (await c.query(`select o.*, wc.code wc, j.number, j.id jid, j.qty, i.code item from wo_operations o join work_centres wc on wc.id=o.work_centre_id join work_orders j on j.id=o.work_order_id join items i on i.id=j.item_id
      where o.status<>'done' and j.status in ('released','in_progress') and not exists (select 1 from wo_operations p where p.work_order_id=o.work_order_id and p.seq<o.seq and p.status<>'done') order by (o.status='running') desc, o.planned_start, j.number limit 40`)).rows, wcs: opts((await c.query("select id, code, name from work_centres order by code")).rows) }));
  return <Page title="Shop floor" sub={`Signed in as ${a.user.name}. Every action is recorded against you — sign out when you leave a shared terminal.`}>
    {d.ops.length === 0 ? <Empty>No operations ready. Released jobs appear here when their previous operation is finished.</Empty> :
      <div className="grid gap-3 md:grid-cols-2">{d.ops.map((o: any) => <div key={o.id} className="card p-4"><div className="flex items-start justify-between gap-2"><div><A href={`/app/production/${o.jid}`} className="text-lg">{o.number}</A><div className="text-sm text-muted">{o.item} × {fmt(o.qty)} · {o.wc}</div></div><Badge s={o.status} /></div>
        <div className="mt-2 text-sm">Op {o.seq}: <b>{o.name}</b> · planned {fmt(o.planned_min, 0)} min · {o.status === "running" ? "running now" : `actual ${fmt(o.actual_min, 1)} min`} · due {date(o.planned_end)}</div>
        <div className="mt-3 flex gap-2">{o.status !== "running" && <ActionForm action={opAct} submit="▶ Start" className="flex-1"><Hidden name="id" value={o.id} /><input type="hidden" name="op" value="start" /></ActionForm>}
          {o.status === "running" && <><ActionForm action={opAct} submit="⏸ Pause" secondary><Hidden name="id" value={o.id} /><input type="hidden" name="op" value="pause" /></ActionForm><ActionForm action={opAct} submit="✔ Finish"><Hidden name="id" value={o.id} /><input type="hidden" name="op" value="finish" /></ActionForm></>}</div>
        <p className="mt-2 text-xs text-muted">Issue material and report output on the <A href={`/app/production/${o.jid}`}>job page</A>. Unposted until you submit.</p></div>)}</div>}
    <Card title="Report downtime" className="mt-5"><ActionForm action={downtimeAction} submit="Record downtime" resetOnOk><div className="grid gap-3 sm:grid-cols-3"><Field label="Work centre" name="wc" required options={d.wcs} /><Field label="Minutes" name="min" type="number" required /><Field label="Reason" name="reason" required placeholder="Tool change, power cut…" /></div></ActionForm></Card></Page>;
}
