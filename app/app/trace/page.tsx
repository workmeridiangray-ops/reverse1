import { requireCompany } from "@/lib/server/auth";
import { rd } from "@/lib/server/read";
import { Page, Card, DataTable, Badge, Field, Empty, Note } from "@/components/ui";
import { forwardTrace, backwardTrace } from "@/lib/server/svc/inventory";
export const metadata = { title: "Traceability" };
export default async function P({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const a = await requireCompany("inv.read"); const sp = await searchParams;
  const d = await rd(a, async (c) => {
    const batches = (await c.query("select b.id, b.code, b.status, i.code ic from batches b join items i on i.id=b.item_id order by b.created_at desc limit 300")).rows;
    const sel = sp.batch ? (await c.query("select b.*, i.code ic from batches b join items i on i.id=b.item_id where b.id=$1", [sp.batch.match(/^[0-9a-f-]{36}$/) ? sp.batch : "00000000-0000-0000-0000-000000000000"])).rows[0] : null;
    return { batches, sel, fwd: sel ? await forwardTrace(c, sel.id) : null, back: sel ? await backwardTrace(c, sel.id) : null };
  });
  return <Page title="Traceability & recall" sub="Choose a batch to see where it came from and everything it went into — down to the customers who received it.">
    <form className="mb-4 flex flex-wrap items-end gap-2"><Field label="Batch" name="batch" defaultValue={sp.batch} options={d.batches.map((b: any) => ({ value: b.id, label: `${b.code} · ${b.ic} · ${b.status}` }))} className="w-80 max-w-full" /><button className="btn-primary">Trace</button></form>
    {!d.sel ? <Empty>Select a batch above to run a recall query.</Empty> : <>
      <Note tone={d.fwd!.shipments.length ? "warn" : "info"}>Batch <b>{d.sel.code}</b> ({d.sel.ic}, <Badge s={d.sel.status} />): used in {d.fwd!.workOrders.length} job(s), produced {d.fwd!.outputBatches.length} output batch(es), shipped on {d.fwd!.shipments.length} dispatch line(s).</Note>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Forward: jobs consuming this batch"><DataTable rows={d.fwd!.workOrders} empty="Not consumed." cols={[{ h: "Job", r: (r: any) => r.number }, { h: "Item", r: (r: any) => r.item_code }]} /></Card>
        <Card title="Forward: output batches"><DataTable rows={d.fwd!.outputBatches} empty="None." cols={[{ h: "Batch", r: (r: any) => r.code }, { h: "Item", r: (r: any) => r.item_code }, { h: "Status", r: (r: any) => <Badge s={r.status} /> }]} /></Card>
        <Card title="Forward: dispatched to customers" className="lg:col-span-2"><DataTable rows={d.fwd!.shipments} empty="Nothing shipped from this lineage." cols={[{ h: "Shipment", r: (r: any) => r.number }, { h: "Customer", r: (r: any) => r.customer }, { h: "Item", r: (r: any) => r.item_code }, { h: "Batch", r: (r: any) => r.batch_code ?? "—" }, { h: "Qty", r: (r: any) => Number(r.qty), num: true }, { h: "Status", r: (r: any) => <Badge s={r.status} /> }]} /></Card>
        <Card title="Backward: input batches" className="lg:col-span-2"><DataTable rows={d.back!.inputBatches} empty="No recorded inputs (purchased or opening stock)." cols={[{ h: "Batch", r: (r: any) => r.code }, { h: "Item", r: (r: any) => r.item_code }, { h: "Source", r: (r: any) => r.source_ref ?? "—" }, { h: "Status", r: (r: any) => <Badge s={r.status} /> }]} /></Card>
      </div></>}</Page>;
}
