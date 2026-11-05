import Link from "next/link";
import { ActionForm } from "@/components/ui/ActionForm";
import { Badge } from "@/components/ui/Badge";
import { DateText, Qty, todayIso } from "@/components/ui/Format";
import { SelectField, TextField, TextAreaField } from "@/components/ui/Field";
import { Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { ProjectTabs } from "@/components/app/ProjectTabs";
import { requireCtx } from "@/lib/server/auth";
import { getProject } from "@/lib/server/queries";
import { recordMeasurement, rejectMeasurement, verifyMeasurement } from "./actions";

export const metadata = { title: "Measurements" };
export default async function Measurements({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string; item?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const c = await requireCtx("project.view");
  const status = ["recorded", "verified", "rejected"].includes(sp.status ?? "") ? sp.status! : "";
  const item = /^[0-9a-f-]{36}$/i.test(sp.item ?? "") ? sp.item! : "";
  const { p, items, rows } = await c.run(async (db) => ({
    p: await getProject(db, id),
    items: await db.q<{ id: string; code: string; description: string; unit: string }>("SELECT id,code,description,unit FROM boq_items WHERE project_id=$1 ORDER BY code", [id]),
    rows: await db.q<{ id: string; code: string; unit: string; qty_milli: number; location: string | null; measured_on: string; status: string; reject_reason: string | null; recorded_by: string | null; rname: string | null }>(
      `SELECT m.id,b.code,b.unit,m.qty_milli,m.location,m.measured_on,m.status,m.reject_reason,m.recorded_by,u.name rname FROM measurements m
         JOIN boq_items b ON b.id=m.boq_item_id LEFT JOIN users u ON u.id=m.recorded_by
        WHERE m.project_id=$1 AND ($2='' OR m.status=$2) AND ($3='' OR m.boq_item_id::text=$3) ORDER BY m.measured_on DESC, m.created_at DESC LIMIT 200`, [id, status, item]),
  }));
  const hid = <input type="hidden" name="project_id" value={id} />;
  const canRecord = c.can("measure.record") && (p.status === "active" || p.status === "handover");
  return (
    <>
      <PageHeader eyebrow={p.code} title="Measurements" description="Recorded by site, verified by a different person. Only verified quantities can be billed, and each quantity is billed once through cumulative running bills." />
      <ProjectTabs c={c} id={id} active="measurements" />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div>
          <form className="mb-4 flex flex-wrap items-end gap-3" role="search">
            <SelectField label="Status" name="status" defaultValue={status} optional><option value="">All</option><option value="recorded">Awaiting verification</option><option value="verified">Verified</option><option value="rejected">Rejected</option></SelectField>
            <SelectField label="Item" name="item" defaultValue={item} optional><option value="">All items</option>{items.map((i) => <option key={i.id} value={i.id}>{i.code}</option>)}</SelectField>
            <button className="min-h-touch rounded border border-ink-500 px-4 font-bold">Filter</button>{status || item ? <Link href="?">Clear</Link> : null}
          </form>
          {rows.length === 0 ? <EmptyState title="No measurements match">{canRecord ? "Record the first measurement using the form." : "Nothing has been recorded yet."}</EmptyState> : (
            <Card>
              <Table caption="Measurements">
                <thead><tr><Th>Date</Th><Th>Item</Th><Th className="text-right">Quantity</Th><Th>Location</Th><Th>Status</Th><Th>Recorded by</Th>{c.can("measure.verify") ? <Th>Review</Th> : null}</tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <Td><DateText at={r.measured_on} /></Td><Td className="font-bold">{r.code}</Td><Td className="text-right"><Qty milli={r.qty_milli} unit={r.unit} /></Td><Td>{r.location ?? "—"}</Td>
                      <Td><Badge status={r.status} />{r.reject_reason ? <p className="mt-1 text-caption text-danger-fg">Reason: {r.reject_reason}</p> : null}</Td><Td>{r.rname ?? "—"}</Td>
                      {c.can("measure.verify") ? (
                        <Td>
                          {r.status === "recorded" ? (
                            <div className="flex flex-col gap-2">
                              <ActionForm action={verifyMeasurement} submitLabel="Verify">{hid}<input type="hidden" name="measurement_id" value={r.id} /></ActionForm>
                              <details><summary className="cursor-pointer text-sm font-bold text-danger-fg">Reject…</summary>
                                <ActionForm action={rejectMeasurement} submitLabel="Reject" variant="secondary">{hid}<input type="hidden" name="measurement_id" value={r.id} /><TextField label="Reason" name="reason" id={`reason-${r.id}`} /></ActionForm></details>
                            </div>
                          ) : null}
                        </Td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </div>
        {canRecord ? (
          <Card title="Record a measurement">
            <ActionForm action={recordMeasurement} submitLabel="Record" reset>
              {hid}
              <SelectField label="BOQ item" name="boq_item_id"><option value="">Choose…</option>{items.map((i) => <option key={i.id} value={i.id}>{i.code} — {i.description} ({i.unit})</option>)}</SelectField>
              <TextField label="Quantity" name="quantity" inputMode="decimal" placeholder="12.500" hint="Up to 3 decimals" />
              <TextField label="Measured on" name="measured_on" type="date" defaultValue={todayIso()} max={todayIso()} />
              <TextField label="Location / zone" name="location" optional placeholder="Block A, level 3" />
              <TextAreaField label="Note" name="note" optional />
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </>
  );
}
