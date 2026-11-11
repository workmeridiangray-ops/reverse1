import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/server/auth";
import { rd, opts } from "@/lib/server/read";
import { Page, Card, Badge, Field, Hidden, Note, date, fmt } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { releaseSuggestionAction, dismissSuggestionAction } from "../../actions";
import { can } from "@/lib/server/perms";
export default async function P({ params }: { params: Promise<{ id: string }> }) {
  const a = await requireCompany("plan.run"); const { id } = await params; if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await rd(a, async (c) => { const r = (await c.query("select * from mrp_runs where id=$1", [id])).rows[0]; if (!r) return null;
    return { r, s: (await c.query("select s.*, i.code, i.name, i.uom from mrp_suggestions s join items i on i.id=s.item_id where run_id=$1 order by s.release_date, i.code", [id])).rows,
      sup: opts((await c.query("select id, code, name from suppliers where active order by code")).rows), plants: opts((await c.query("select id, code, name from plants where active order by code")).rows) }; });
  if (!d) notFound(); const rel = can(a.membership.role, "plan.release");
  return <Page title={`Planning run ${d.r.number}`} crumbs={[["MRP", "/app/planning"], [d.r.number]]} sub={`Horizon ${d.r.params.horizonDays} days from ${d.r.params.today}`}>
    <Note>{(d.r.params.assumptions as string[]).join(" · ")}</Note>
    {d.s.length === 0 ? <Card><p className="text-sm">No shortages in the horizon — stock and open supply cover all demand.</p></Card> : <div className="space-y-3">{d.s.map((s: any) => (
      <Card key={s.id} title={`${s.kind === "purchase" ? "Buy" : "Make"} ${fmt(s.qty, 3)} ${s.uom} · ${s.code}`} actions={<Badge s={s.status} />}>
        <p className="text-sm">Need by <b>{date(s.need_date)}</b> · start/order by <b>{date(s.release_date)}</b> (lead time {s.reason.leadTimeDays} working days, lot size {s.reason.lotSize})</p>
        <p className="mt-1 text-sm text-muted">Why: on hand {fmt(s.reason.onHand, 3)}, safety stock {fmt(s.reason.safetyStock, 3)}, shortage {fmt(s.reason.shortage, 3)} after demand below.</p>
        <ul className="mt-1 list-disc pl-5 text-sm">{(s.reason.sources as any[]).map((x, i) => <li key={i}>{x.source}: {fmt(x.qty, 3)} on {date(x.date)}</li>)}</ul>
        {s.reason.note && <Note tone="warn">{s.reason.note}</Note>}
        {s.status === "released" && <p className="mt-2 text-sm">Released as <b>{s.released_ref}</b></p>}
        {s.status === "suggested" && rel && <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <ActionForm action={releaseSuggestionAction} submit={s.kind === "purchase" ? "Release as draft PO" : "Release as planned job"}><Hidden name="id" value={s.id} />
            {s.kind === "purchase" ? <div className="grid gap-2 sm:grid-cols-2"><Field label="Supplier" name="supplier" required options={d.sup} /><Field label="Unit price (₹)" name="price" placeholder="0.00" /></div> : <Field label="Plant" name="plant" required options={d.plants} />}</ActionForm>
          <ActionForm action={dismissSuggestionAction} submit="Dismiss" secondary><Hidden name="id" value={s.id} /><Field label="Reason" name="reason" required /></ActionForm></div>}
      </Card>))}</div>}</Page>;
}
