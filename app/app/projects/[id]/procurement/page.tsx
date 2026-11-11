import { ActionForm } from "@/components/ui/ActionForm";
import { Badge } from "@/components/ui/Badge";
import { Money, Qty } from "@/components/ui/Format";
import { SelectField, TextField } from "@/components/ui/Field";
import { Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { ProjectTabs } from "@/components/app/ProjectTabs";
import { requireCtx } from "@/lib/server/auth";
import { getProject } from "@/lib/server/queries";
import { amountFor } from "@/lib/rules/qty";
import { createPo, createRequest, decideRequest, issuePo, receiveGoods, submitRequest } from "./actions";

export const metadata = { title: "Procurement" };
interface Rq { id: string; number: number; status: string; needed_by: string | null; requested_by: string | null; decision_reason: string | null }
interface RqL { id: string; request_id: string; description: string; unit: string; qty_milli: number }
interface Po { id: string; number: number; status: string; sname: string }
interface PoL { id: string; po_id: string; description: string; unit: string; qty_milli: number; rate_minor: number; accepted: number; rejected: number }
export default async function Procurement({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await requireCtx("project.view");
  if (!c.can("po.view") && !c.can("material.request")) return null;
  const d = await c.run(async (db) => ({
    p: await getProject(db, id),
    items: await db.q<{ id: string; code: string }>("SELECT id,code FROM boq_items WHERE project_id=$1 ORDER BY code", [id]),
    suppliers: await db.q<{ id: string; name: string }>("SELECT id,name FROM suppliers ORDER BY name"),
    reqs: await db.q<Rq>("SELECT id,number,status,needed_by,requested_by,decision_reason FROM material_requests WHERE project_id=$1 ORDER BY number DESC", [id]),
    rl: await db.q<RqL>("SELECT id,request_id,description,unit,qty_milli FROM material_request_lines WHERE project_id=$1", [id]),
    pos: await db.q<Po>("SELECT o.id,o.number,o.status,s.name sname FROM purchase_orders o JOIN suppliers s ON s.id=o.supplier_id WHERE o.project_id=$1 ORDER BY o.number DESC", [id]),
    pl: await db.q<PoL>("SELECT l.id,l.po_id,l.description,l.unit,l.qty_milli,l.rate_minor,COALESCE((SELECT sum(accepted_qty_milli) FROM grn_lines g WHERE g.po_line_id=l.id),0)::bigint accepted,COALESCE((SELECT sum(rejected_qty_milli) FROM grn_lines g WHERE g.po_line_id=l.id),0)::bigint rejected FROM po_lines l WHERE l.project_id=$1", [id]),
  }));
  const hid = <input type="hidden" name="project_id" value={id} />;
  const live = d.p.status !== "closed";
  const approved = d.reqs.filter((r) => r.status === "approved");
  return (
    <>
      <PageHeader eyebrow={d.p.code} title="Procurement" description="Requested → approved → ordered → received. Rejected material is quarantined (not counted as received) and the order stays open for replacement." />
      <ProjectTabs c={c} id={id} active="procurement" />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-4" aria-labelledby="mr"><h2 id="mr" className="text-heading font-bold">Material requests</h2>
          {d.reqs.length === 0 ? <EmptyState title="No requests" /> : d.reqs.map((r) => (
            <Card key={r.id}>
              <div className="flex items-center justify-between"><h3 className="font-bold">MR-{r.number}</h3><Badge status={r.status} /></div>
              <ul className="mt-1 text-sm">{d.rl.filter((l) => l.request_id === r.id).map((l) => <li key={l.id}>{l.description} — <Qty milli={l.qty_milli} unit={l.unit} /></li>)}</ul>
              {r.decision_reason ? <p className="mt-1 text-sm text-danger-fg">Reason: {r.decision_reason}</p> : null}
              {r.status === "draft" && c.can("material.request") && live ? <ActionForm action={submitRequest} submitLabel="Submit">{hid}<input type="hidden" name="mr_id" value={r.id} /></ActionForm> : null}
              {r.status === "submitted" && c.can("material.approve") && live ? (r.requested_by === c.user.id ? <p className="mt-2 text-sm text-warn-fg">You raised this; someone else must approve.</p> : (
                <div className="mt-2 flex flex-wrap gap-6"><ActionForm action={decideRequest} submitLabel="Approve">{hid}<input type="hidden" name="mr_id" value={r.id} /><input type="hidden" name="decision" value="approve" /></ActionForm>
                  <details><summary className="cursor-pointer font-bold text-danger-fg">Reject…</summary><ActionForm action={decideRequest} submitLabel="Reject" variant="secondary">{hid}<input type="hidden" name="mr_id" value={r.id} /><input type="hidden" name="decision" value="reject" /><TextField label="Reason" name="reason" id={`mr-${r.id}`} /></ActionForm></details></div>)) : null}
            </Card>))}
          {c.can("material.request") && live && d.p.status !== "tender" ? (
            <Card title="New request"><ActionForm action={createRequest} submitLabel="Save draft" reset>{hid}
              {[0, 1, 2, 3, 4].map((i) => (<fieldset key={i} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr]"><legend className="sr-only">Line {i + 1}</legend>
                <TextField label={`Line ${i + 1} description`} name={`desc_${i}`} id={`desc_${i}`} optional /><TextField label="Unit" name={`unit_${i}`} id={`unit_${i}`} optional /><TextField label="Quantity" name={`qty_${i}`} id={`qty_${i}`} inputMode="decimal" optional />
                <input type="hidden" name={`item_${i}`} value="" /></fieldset>))}
              <TextField label="Needed by" name="needed_by" type="date" optional /></ActionForm></Card>) : null}
        </section>
        <section className="space-y-4" aria-labelledby="po"><h2 id="po" className="text-heading font-bold">Purchase orders and receipts</h2>
          {d.pos.length === 0 ? <EmptyState title="No purchase orders" /> : d.pos.map((o) => {
            const ls = d.pl.filter((l) => l.po_id === o.id);
            const value = ls.reduce((a, l) => a + amountFor(l.qty_milli, l.rate_minor), 0);
            return (
              <Card key={o.id}>
                <div className="flex items-center justify-between"><h3 className="font-bold">PO-{o.number} · {o.sname}</h3><Badge status={o.status} /></div>
                <Table caption={`PO-${o.number} lines`}><thead><tr><Th>Item</Th><Th className="text-right">Ordered</Th><Th className="text-right">Received</Th><Th className="text-right">Rejected</Th><Th className="text-right">Rate</Th></tr></thead>
                  <tbody>{ls.map((l) => <tr key={l.id}><Td>{l.description}</Td><Td className="text-right"><Qty milli={l.qty_milli} unit={l.unit} /></Td><Td className="text-right"><Qty milli={l.accepted} /></Td><Td className="text-right"><Qty milli={l.rejected} /></Td><Td className="text-right"><Money minor={l.rate_minor} /></Td></tr>)}</tbody></Table>
                <p className="mt-2 text-sm">Order value <Money minor={value} /></p>
                {o.status === "draft" && c.can("po.manage") && live ? <ActionForm action={issuePo} submitLabel="Issue PO">{hid}<input type="hidden" name="po_id" value={o.id} /></ActionForm> : null}
                {["issued", "part_received"].includes(o.status) && c.can("grn.manage") && live ? (
                  <details className="mt-2"><summary className="cursor-pointer font-bold">Record goods receipt…</summary>
                    <ActionForm action={receiveGoods} submitLabel="Save receipt" reset>{hid}<input type="hidden" name="po_id" value={o.id} />
                      {ls.map((l) => (<fieldset key={l.id} className="grid gap-2 sm:grid-cols-3"><legend className="font-bold">{l.description}</legend>
                        <TextField label="Accepted" name={`acc_${l.id}`} id={`acc_${l.id}`} inputMode="decimal" optional /><TextField label="Rejected" name={`rej_${l.id}`} id={`rej_${l.id}`} inputMode="decimal" optional /><TextField label="Rejection reason" name={`reason_${l.id}`} id={`reason_${l.id}`} optional /></fieldset>))}
                      <TextField label="Received on" name="received_on" type="date" optional /></ActionForm></details>) : null}
              </Card>);
          })}
          {c.can("po.manage") && live && approved.length ? (
            <Card title="Create a purchase order"><ActionForm action={createPo} submitLabel="Create PO (draft)" reset>{hid}
              <SelectField label="Approved request" name="mr_id"><option value="">Choose…</option>{approved.map((r) => <option key={r.id} value={r.id}>MR-{r.number}</option>)}</SelectField>
              <SelectField label="Supplier" name="supplier_id"><option value="">Choose…</option>{d.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</SelectField>
              <p className="text-sm text-ink-700">Enter a rate (₹ per unit) for each line to order. Lines without a rate are left out. Remaining unordered quantity is used.</p>
              {approved.flatMap((r) => d.rl.filter((l) => l.request_id === r.id).map((l) => <TextField key={l.id} label={`MR-${r.number}: ${l.description} (${l.unit})`} name={`rate_${l.id}`} id={`rate_${l.id}`} inputMode="decimal" optional />))}
            </ActionForm></Card>) : null}
        </section>
      </div>
    </>
  );
}
