import { ActionForm } from "@/components/ui/ActionForm";
import { Badge } from "@/components/ui/Badge";
import { DateText, Money, Qty, todayIso } from "@/components/ui/Format";
import { SelectField, TextField } from "@/components/ui/Field";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { ProjectTabs } from "@/components/app/ProjectTabs";
import { requireCtx } from "@/lib/server/auth";
import { getProject } from "@/lib/server/queries";
import { formatPercent } from "@/lib/rules/qty";
import { addWoLine, advanceSubMeasurement, approveSubBill, awardPackage, createPackage, createSubBill, prepareSubMeasurement } from "./actions";

export const metadata = { title: "Subcontracts" };
export default async function Subcontracts({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await requireCtx("sub.view");
  const d = await c.run(async (db) => ({
    p: await getProject(db, id),
    pkgs: await db.q<{ id: string; number: number; name: string; status: string; retention_bp: number; sname: string }>("SELECT sp.id,sp.number,sp.name,sp.status,sp.retention_bp,s.name sname FROM sub_packages sp JOIN suppliers s ON s.id=sp.supplier_id WHERE sp.project_id=$1 ORDER BY sp.number DESC", [id]),
    suppliers: await db.q<{ id: string; name: string }>("SELECT id,name FROM suppliers ORDER BY name"),
    items: await db.q<{ id: string; code: string }>("SELECT id,code FROM boq_items WHERE project_id=$1 ORDER BY code", [id]),
    lines: await db.q<{ id: string; package_id: string; code: string; unit: string; qty_milli: number; rate_minor: number; approved: number }>("SELECT l.id,l.package_id,b.code,b.unit,l.qty_milli,l.rate_minor,COALESCE((SELECT sum(qty_milli) FROM sub_measurements m WHERE m.wo_line_id=l.id AND m.status='approved'),0)::bigint approved FROM sub_wo_lines l JOIN boq_items b ON b.id=l.boq_item_id WHERE l.project_id=$1 ORDER BY b.code", [id]),
    meas: await db.q<{ id: string; wo_line_id: string; qty_milli: number; measured_on: string; location: string | null; status: string; reject_reason: string | null; prepared_by: string | null; verified_by: string | null }>("SELECT id,wo_line_id,qty_milli,measured_on,location,status,reject_reason,prepared_by,verified_by FROM sub_measurements WHERE project_id=$1 ORDER BY created_at DESC", [id]),
    bills: await db.q<{ id: string; package_id: string; bill_no: number; status: string; gross_minor: number; retention_minor: number; material_recovery_minor: number; net_minor: number; prepared_by: string | null }>("SELECT id,package_id,bill_no,status,gross_minor,retention_minor,material_recovery_minor,net_minor,prepared_by FROM sub_bills WHERE project_id=$1 ORDER BY bill_no DESC", [id]),
  }));
  const hid = <input type="hidden" name="project_id" value={id} />;
  const live = d.p.status !== "closed";
  return (
    <>
      <PageHeader eyebrow={d.p.code} title="Subcontracts" description="Package → work order → measurement (prepared, jointly verified and approved by three different people) → bill. Only approved, unbilled quantity can be billed." />
      <ProjectTabs c={c} id={id} active="subcontracts" />
      {d.pkgs.length === 0 ? <EmptyState title="No subcontract packages" /> : d.pkgs.map((k) => {
        const ls = d.lines.filter((l) => l.package_id === k.id);
        return (
          <Card key={k.id} className="mb-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-title font-bold">SP-{k.number} · {k.name} <span className="font-normal text-ink-500">({k.sname}, retention {formatPercent(k.retention_bp)})</span></h2><Badge status={k.status === "awarded" ? "active" : k.status} /></div>
            <Table caption={`SP-${k.number} work order`}><thead><tr><Th>BOQ item</Th><Th className="text-right">Ordered</Th><Th className="text-right">Approved</Th><Th className="text-right">Rate</Th></tr></thead>
              <tbody>{ls.map((l) => <tr key={l.id}><Td className="font-bold">{l.code}</Td><Td className="text-right"><Qty milli={l.qty_milli} unit={l.unit} /></Td><Td className="text-right"><Qty milli={l.approved} /></Td><Td className="text-right"><Money minor={l.rate_minor} /></Td></tr>)}</tbody></Table>
            {k.status === "draft" && c.can("sub.manage") && live ? (
              <div className="mt-4 grid gap-6 lg:grid-cols-2">
                <ActionForm action={addWoLine} submitLabel="Add line" reset>{hid}<input type="hidden" name="package_id" value={k.id} /><h3 className="font-bold">Add work-order line</h3>
                  <SelectField label="BOQ item" name="boq_item_id" id={`wi-${k.id}`}><option value="">Choose…</option>{d.items.map((i) => <option key={i.id} value={i.id}>{i.code}</option>)}</SelectField>
                  <TextField label="Quantity" name="quantity" id={`wq-${k.id}`} inputMode="decimal" /><TextField label="Agreed rate (₹)" name="rate" id={`wr-${k.id}`} inputMode="decimal" /></ActionForm>
                <ActionForm action={awardPackage} submitLabel="Award package">{hid}<input type="hidden" name="package_id" value={k.id} /><p className="text-ink-700">Awarding makes the work order live; lines can no longer change.</p></ActionForm>
              </div>) : null}
            {k.status === "awarded" ? (
              <>
                <h3 className="mb-2 mt-6 font-bold">Measurements</h3>
                {ls.map((l) => d.meas.filter((m) => m.wo_line_id === l.id).map((m) => (
                  <div key={m.id} className="mb-2 flex flex-wrap items-center gap-3 rounded border border-line p-2">
                    <strong>{l.code}</strong> <Qty milli={m.qty_milli} unit={l.unit} /> <DateText at={m.measured_on} /> {m.location ?? ""} <Badge status={m.status === "prepared" ? "recorded" : m.status} />
                    {m.reject_reason ? <span className="text-sm text-danger-fg">{m.reject_reason}</span> : null}
                    {m.status === "prepared" && c.can("sub.verify") && m.prepared_by !== c.user.id ? <ActionForm action={advanceSubMeasurement} submitLabel="Verify jointly" variant="secondary">{hid}<input type="hidden" name="measurement_id" value={m.id} /><input type="hidden" name="step" value="verify" /></ActionForm> : null}
                    {m.status === "verified" && c.can("sub.approve") && m.prepared_by !== c.user.id && m.verified_by !== c.user.id ? <ActionForm action={advanceSubMeasurement} submitLabel="Approve" variant="secondary">{hid}<input type="hidden" name="measurement_id" value={m.id} /><input type="hidden" name="step" value="approve" /></ActionForm> : null}
                  </div>)))}
                {c.can("sub.measure") && live && ls.length ? (
                  <ActionForm action={prepareSubMeasurement} submitLabel="Prepare measurement" reset className="mt-4 max-w-xl">{hid}<h3 className="font-bold">Prepare a measurement</h3>
                    <SelectField label="Work-order line" name="wo_line_id" id={`ml-${k.id}`}><option value="">Choose…</option>{ls.map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}</SelectField>
                    <TextField label="Quantity" name="quantity" id={`mq-${k.id}`} inputMode="decimal" /><TextField label="Measured on" name="measured_on" id={`md-${k.id}`} type="date" defaultValue={todayIso()} max={todayIso()} /><TextField label="Location" name="location" id={`mloc-${k.id}`} optional /></ActionForm>) : null}
                <h3 className="mb-2 mt-6 font-bold">Bills</h3>
                {d.bills.filter((b) => b.package_id === k.id).map((b) => (
                  <div key={b.id} className="mb-3 rounded border border-line p-3"><p className="flex flex-wrap items-center gap-3"><strong>Bill {b.bill_no}</strong> <Badge status={b.status} /> gross <Money minor={b.gross_minor} /> − retention <Money minor={b.retention_minor} /> − recovery <Money minor={b.material_recovery_minor} /> = <strong>net <Money minor={b.net_minor} /></strong></p>
                    {b.status === "draft" && c.can("sub.approve") ? (b.prepared_by === c.user.id ? <Alert tone="warn" title="You prepared this bill">A different person must approve it.</Alert> : <ActionForm action={approveSubBill} submitLabel="Approve bill">{hid}<input type="hidden" name="bill_id" value={b.id} /></ActionForm>) : null}</div>))}
                {c.can("sub.approve") && live ? <ActionForm action={createSubBill} submitLabel="Prepare bill from approved work" className="max-w-xl">{hid}<input type="hidden" name="package_id" value={k.id} /><TextField label="Material recovery (₹)" name="recovery" id={`rec-${k.id}`} inputMode="decimal" optional defaultValue="0" /><TextField label="Reason for recovery" name="recovery_reason" id={`recr-${k.id}`} optional /></ActionForm> : null}
              </>) : null}
          </Card>);
      })}
      {c.can("sub.manage") && live ? (
        <Card title="New package"><ActionForm action={createPackage} submitLabel="Create package" reset className="max-w-xl">{hid}<TextField label="Package name" name="name" id="pk-name" /><SelectField label="Subcontractor (from Suppliers)" name="supplier_id" id="pk-sup"><option value="">Choose…</option>{d.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</SelectField><TextField label="Retention (%)" name="retention" id="pk-ret" inputMode="decimal" defaultValue="5" /></ActionForm></Card>) : null}
    </>
  );
}
