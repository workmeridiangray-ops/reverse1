import { requireCompany } from "@/lib/server/auth";
import { rd, itemOpts } from "@/lib/server/read";
import { Page, Card, DataTable, Badge, Field, Grid, Hidden, Note, fmt, dt } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { inspectAction, dispositionAction, raiseInspectionAction, returnDispositionAction } from "../actions";
import { can } from "@/lib/server/perms";
import { locOpts } from "@/lib/server/read";
export const metadata = { title: "Quality" };
export default async function P() {
  const a = await requireCompany("qa.read");
  const d = await rd(a, async (c) => ({
    pend: (await c.query("select q.*, i.code, b.code batch from inspections q join items i on i.id=q.item_id left join batches b on b.id=q.batch_id where q.status='pending' order by q.created_at")).rows,
    done: (await c.query("select q.*, i.code, b.code batch from inspections q join items i on i.id=q.item_id left join batches b on b.id=q.batch_id where q.status<>'pending' order by q.decided_at desc limit 20")).rows,
    ncr: (await c.query("select n.*, q.number qn, i.code from ncrs n join inspections q on q.id=n.inspection_id join items i on i.id=q.item_id order by n.created_at desc limit 30")).rows,
    rets: (await c.query("select r.*, i.code from returns r join items i on i.id=r.item_id where r.status='awaiting_inspection'")).rows, locs: await locOpts(c, "stock"), items: await itemOpts(c), batches: (await c.query("select b.id, b.code from batches b order by code limit 300")).rows }));
  const decide = can(a.membership.role, "qa.decide");
  return <Page title="Quality" sub="Quarantine and release decisions control stock availability. Reviewer identity is recorded; this is not calibration certification.">
    <h2 className="mb-2 font-semibold">Pending inspections</h2>
    {d.pend.length === 0 ? <Note>No inspections waiting.</Note> : <div className="space-y-3">{d.pend.map((q: any) => <Card key={q.id} title={`${q.number} · ${q.kind} · ${q.code} × ${fmt(q.qty)}${q.batch ? ` · batch ${q.batch}` : ""}`} actions={<Badge s="pending" />}>
      {decide ? <ActionForm action={inspectAction} submit="Record result"><Hidden name="id" value={q.id} /><Grid cols={4}><Field label="Measured value" name="measured" type="number" step="any" /><Field label="Min" name="min" type="number" step="any" /><Field label="Max" name="max" type="number" step="any" /><Field label="Unit" name="unit" placeholder="mm" /><Field label="Result" name="result" required options={[{ value: "pass", label: "Pass" }, { value: "fail", label: "Fail" }]} /><Field label="Notes" name="notes" className="sm:col-span-3" /></Grid></ActionForm> : <p className="text-sm text-muted">Awaiting a quality inspector.</p>}</Card>)}</div>}
    <h2 className="mb-2 mt-6 font-semibold">Nonconformances</h2>
    <div className="space-y-3">{d.ncr.length === 0 && <Note>No NCRs.</Note>}{d.ncr.map((n: any) => <Card key={n.id} title={`${n.number} · ${n.code} (from ${n.qn})`} actions={<Badge s={n.status} />}><p className="text-sm">{n.description}</p>
      {n.status === "dispositioned" ? <p className="mt-1 text-sm text-muted">Disposition: <b>{n.disposition}</b> — {n.decision_reason}</p> : decide && <ActionForm action={dispositionAction} submit="Record disposition" className="mt-3"><Hidden name="id" value={n.id} /><Grid cols={3}><Field label="Disposition" name="disp" required options={["rework", "return", "concession", "scrap"].map((x) => ({ value: x, label: x }))} /><Field label="Reason" name="reason" required /><Field label="Corrective action" name="action" /></Grid></ActionForm>}</Card>)}</div>
    {d.rets.length > 0 && <><h2 className="mb-2 mt-6 font-semibold">Customer returns awaiting inspection</h2><div className="space-y-3">{d.rets.map((r: any) => <Card key={r.id} title={`${r.number} · ${r.code} × ${fmt(r.qty)}`}><p className="text-sm">{r.reason}</p>{decide && <ActionForm action={returnDispositionAction} submit="Record" className="mt-2"><Hidden name="id" value={r.id} /><Grid cols={3}><Field label="Decision" name="result" required options={[{ value: "restock", label: "Restock" }, { value: "scrap", label: "Scrap" }]} /><Field label="Restock to" name="loc" required options={d.locs} /><Field label="Inspection finding" name="reason" required /></Grid></ActionForm>}</Card>)}</div></>}
    {can(a.membership.role, "qa.write") && <Card title="Raise an in-process / final inspection" className="mt-6"><ActionForm action={raiseInspectionAction} submit="Raise inspection" resetOnOk><Grid cols={4}><Field label="Type" name="kind" options={[{ value: "in_process", label: "In-process" }, { value: "final", label: "Final" }, { value: "incoming", label: "Incoming" }]} /><Field label="Item" name="item" required options={d.items} /><Field label="Batch" name="batch" options={d.batches.map((b: any) => ({ value: b.id, label: b.code }))} /><Field label="Quantity" name="qty" type="number" required /></Grid></ActionForm></Card>}
    <h2 className="mb-2 mt-6 font-semibold">Recent results</h2>
    <DataTable rows={d.done} empty="None yet." cols={[{ h: "No.", r: (r: any) => r.number }, { h: "Item", r: (r: any) => r.code }, { h: "Batch", r: (r: any) => r.batch ?? "—" }, { h: "Measured", r: (r: any) => (r.measured != null ? `${fmt(r.measured, 4)} ${r.unit ?? ""}` : "—") }, { h: "Result", r: (r: any) => <Badge s={r.status} /> }, { h: "Decided", r: (r: any) => dt(r.decided_at), hideSm: true }]} /></Page>;
}
