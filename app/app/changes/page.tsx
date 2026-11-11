import { requireCompany } from "@/lib/server/auth";
import { rd } from "@/lib/server/read";
import { Page, Card, A, Badge, Field, Hidden, Note, Empty, dt } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { decideChange } from "../actions";
import { can } from "@/lib/server/perms";
export const metadata = { title: "Engineering changes" };
export default async function P() {
  const a = await requireCompany("master.read");
  const rows = await rd(a, async (c) => (await c.query("select c.*, i.code, b.version from change_requests c join boms b on b.id=c.bom_id join items i on i.id=b.item_id order by c.created_at desc limit 100")).rows);
  const approve = can(a.membership.role, "eng.approve");
  return <Page title="Engineering changes" sub="Each request shows the open jobs it would affect before anyone approves. Jobs already released keep their original BOM snapshot.">
    {rows.length === 0 ? <Empty>No change requests. Submit a draft BOM for approval to create one.</Empty> : <div className="space-y-3">{rows.map((r: any) => <Card key={r.id} title={`${r.number} · ${r.code} v${r.version}`} actions={<Badge s={r.status} />}>
      <p className="text-sm">{r.reason}</p><p className="text-xs text-muted">Requested {dt(r.created_at)}</p>
      {(r.affected as any[]).length > 0 ? <Note tone="warn">{(r.affected as any[]).length} open job(s) use this item or its components: {(r.affected as any[]).map((j) => j.number).join(", ")}. They keep their released snapshot.</Note> : <p className="mt-2 text-sm text-muted">No open jobs are affected.</p>}
      <p className="text-sm"><A href={`/app/boms/${r.bom_id}`}>View BOM</A></p>
      {r.status === "pending" && approve && <ActionForm action={decideChange} submit="Approve" className="mt-3"><Hidden name="id" value={r.id} /><input type="hidden" name="decision" value="approve" /></ActionForm>}
      {r.status === "pending" && approve && <ActionForm action={decideChange} submit="Reject" danger className="mt-2"><Hidden name="id" value={r.id} /><input type="hidden" name="decision" value="reject" /><Field label="Reason (required to reject)" name="reason" /></ActionForm>}
      {r.decision_reason && <p className="mt-2 text-sm text-muted">Decision note: {r.decision_reason}</p>}</Card>)}</div>}</Page>;
}
