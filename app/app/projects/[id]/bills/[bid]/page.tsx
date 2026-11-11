import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ui/ActionForm";
import { Badge } from "@/components/ui/Badge";
import { DateText, DateTimeText, Money, Qty, todayIso } from "@/components/ui/Format";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { Alert, Card, PageHeader } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { ProjectTabs } from "@/components/app/ProjectTabs";
import { requireCtx } from "@/lib/server/auth";
import { getProject } from "@/lib/server/queries";
import { collectionState } from "@/lib/rules/billing";
import { formatPercent } from "@/lib/rules/qty";
import { formatQty } from "@/lib/rules/qty";
import { toMajorString } from "@/lib/rules/money";
import { cancelBill, certifyBill, invoiceBill, raiseDispute, recordReceipt, resolveDispute, returnBill, reverseReceipt, submitBill } from "../actions";

export const metadata = { title: "Running bill" };
interface Bill { id: string; bill_no: number; status: string; version: number; claimed_gross_minor: number; certified_gross_minor: number; retention_minor: number; advance_recovery_minor: number; other_deduction_minor: number; other_deduction_reason: string | null; net_minor: number; terms: { retentionBp: number; retentionCapBp: number; advanceRecoveryBp: number }; prepared_by: string | null; certified_at: Date | null; certify_note: string | null; cancel_reason: string | null; pname: string | null; cname: string | null }

export default async function BillPage({ params }: { params: Promise<{ id: string; bid: string }> }) {
  const { id, bid } = await params;
  const c = await requireCtx("bill.view");
  const data = await c.run(async (db) => {
    const p = await getProject(db, id);
    if (!/^[0-9a-f-]{36}$/i.test(bid)) return null;
    const b = await db.maybe<Bill>(`SELECT b.id,b.bill_no,b.status,b.version,b.claimed_gross_minor,b.certified_gross_minor,b.retention_minor,b.advance_recovery_minor,b.other_deduction_minor,b.other_deduction_reason,b.net_minor,b.terms,b.prepared_by,b.certified_at,b.certify_note,b.cancel_reason,pu.name pname,cu.name cname
      FROM bills b LEFT JOIN users pu ON pu.id=b.prepared_by LEFT JOIN users cu ON cu.id=b.certified_by WHERE b.id=$1 AND b.project_id=$2`, [bid, id]);
    if (!b) return null;
    const lines = await db.q<{ id: string; code: string; description: string; unit: string; rate_minor: number; contract_qty_milli: number; prev_qty_milli: number; claimed_qty_milli: number; certified_qty_milli: number; claimed_amount_minor: number; certified_amount_minor: number }>(
      `SELECT l.id,i.code,i.description,i.unit,l.rate_minor,l.contract_qty_milli,l.prev_qty_milli,l.claimed_qty_milli,l.certified_qty_milli,l.claimed_amount_minor,l.certified_amount_minor FROM bill_lines l JOIN boq_items i ON i.id=l.boq_item_id WHERE l.bill_id=$1 ORDER BY i.code`, [bid]);
    const inv = c.can("invoice.view") ? await db.maybe<{ id: string; number: string; amount_minor: number; issued_on: string; due_on: string }>("SELECT id,number,amount_minor,issued_on,due_on FROM client_invoices WHERE bill_id=$1", [bid]) : null;
    const receipts = inv ? await db.q<{ id: string; amount_minor: number; received_on: string; method: string; reference: string | null; reversed_at: Date | null; reversal_reason: string | null }>("SELECT id,amount_minor,received_on,method,reference,reversed_at,reversal_reason FROM receipts WHERE invoice_id=$1 ORDER BY created_at", [inv.id]) : [];
    const disputes = inv ? await db.q<{ id: string; amount_minor: number; reason: string; status: string; resolution: string | null }>("SELECT id,amount_minor,reason,status,resolution FROM disputes WHERE invoice_id=$1 ORDER BY created_at", [inv.id]) : [];
    return { p, b, lines, inv, receipts, disputes };
  });
  if (!data) notFound();
  const { p, b, lines, inv, receipts, disputes } = data;
  const hidden = <><input type="hidden" name="project_id" value={id} /><input type="hidden" name="bill_id" value={b.id} /><input type="hidden" name="version" value={b.version} /></>;
  const own = b.prepared_by === c.user.id;
  const coll = inv ? collectionState(inv.amount_minor, receipts.filter((r) => !r.reversed_at).map((r) => r.amount_minor), disputes.filter((d) => d.status === "open").map((d) => d.amount_minor)) : null;
  const open = p.status !== "closed";
  return (
    <>
      <PageHeader eyebrow={p.code} title={`Running bill ${b.bill_no}`} description={<span className="flex items-center gap-2"><Badge status={b.status} /> prepared by {b.pname ?? "—"}{b.cname ? <> · certified by {b.cname} <DateTimeText at={b.certified_at} /></> : null}</span>} />
      <ProjectTabs c={c} id={id} active="bills" />
      {b.certify_note ? <div className="mb-4"><Alert tone="info" title="Certifier's note">{b.certify_note}</Alert></div> : null}
      {b.cancel_reason ? <div className="mb-4"><Alert tone="warn" title="Cancelled">{b.cancel_reason}</Alert></div> : null}

      <Card title="Measurement book — cumulative quantities">
        {b.status === "submitted" && c.can("bill.certify") && !own && open ? (
          <ActionForm action={certifyBill} submitLabel="Certify bill">
            {hidden}
            <LineTable lines={lines} editable />
            <Totals b={b} />
            <div className="grid gap-4 sm:grid-cols-2"><TextField label="Other deduction (₹)" name="other_deduction" inputMode="decimal" optional defaultValue="0" hint="e.g. material recovery, penalty" /><TextField label="Reason for other deduction" name="other_reason" optional /></div>
            <TextAreaField label="Certification note" name="note" optional hint="Required if you certify less than claimed" />
          </ActionForm>
        ) : (<><LineTable lines={lines} /><Totals b={b} /></>)}
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {b.status === "draft" && c.can("bill.prepare") && open ? (
          <Card title="Prepare"><div className="flex flex-col gap-4">
            <ActionForm action={submitBill} submitLabel="Submit for certification">{hidden}<p className="text-ink-700">Once submitted the claim goes to the certifier. Quantities cannot change.</p></ActionForm>
            <details><summary className="cursor-pointer font-bold text-danger-fg">Cancel this bill…</summary><ActionForm action={cancelBill} submitLabel="Cancel bill" variant="secondary">{hidden}<TextField label="Reason" name="reason" /></ActionForm></details>
          </div></Card>
        ) : null}
        {b.status === "submitted" && open ? (
          <Card title="Review">
            {own ? <Alert tone="warn" title="You prepared this bill">A different person must certify it.</Alert> : null}
            {c.can("bill.certify") && !own ? <details><summary className="cursor-pointer font-bold">Return to preparer…</summary><ActionForm action={returnBill} submitLabel="Return bill" variant="secondary">{hidden}<TextField label="Reason" name="reason" /></ActionForm></details> : null}
            {c.can("bill.prepare") ? <details className="mt-4"><summary className="cursor-pointer font-bold text-danger-fg">Cancel this bill…</summary><ActionForm action={cancelBill} submitLabel="Cancel bill" variant="secondary">{hidden}<TextField label="Reason" name="reason" /></ActionForm></details> : null}
            {!c.can("bill.certify") && !c.can("bill.prepare") ? <p className="text-ink-700">Awaiting certification.</p> : null}
          </Card>
        ) : null}
        {b.status === "certified" && c.can("invoice.create") && open ? (
          <Card title="Invoice"><ActionForm action={invoiceBill} submitLabel="Issue invoice">{hidden}<p className="text-ink-700">Issues a numbered invoice for the net payable of <Money minor={b.net_minor} />.</p></ActionForm></Card>
        ) : null}
      </div>

      {inv && coll ? (
        <Card title={`Invoice ${inv.number}`} className="mt-6">
          <dl className="mb-4 grid gap-4 sm:grid-cols-4">
            <div><dt className="text-caption font-bold text-ink-500">Invoiced</dt><dd><Money minor={coll.invoicedMinor} /></dd></div>
            <div><dt className="text-caption font-bold text-ink-500">Collected</dt><dd><Money minor={coll.collectedMinor} /></dd></div>
            <div><dt className="text-caption font-bold text-ink-500">Outstanding</dt><dd><Money minor={coll.outstandingMinor} /> <Badge status={coll.status} /></dd></div>
            <div><dt className="text-caption font-bold text-ink-500">Of which disputed</dt><dd><Money minor={coll.disputedOpenMinor} /></dd></div>
          </dl>
          <p className="mb-4 text-sm text-ink-500">Issued <DateText at={inv.issued_on} /> · due <DateText at={inv.due_on} /> · undisputed outstanding <Money minor={coll.undisputedOutstandingMinor} /></p>
          <Table caption="Receipts">
            <thead><tr><Th>Date</Th><Th>Method</Th><Th>Reference</Th><Th className="text-right">Amount</Th><Th>Note</Th></tr></thead>
            <tbody>{receipts.length === 0 ? <tr><Td colSpan={5} className="text-ink-500">No receipts yet.</Td></tr> : receipts.map((r) => (
              <tr key={r.id}><Td><DateText at={r.received_on} /></Td><Td>{r.method}</Td><Td>{r.reference ?? "—"}</Td>
                <Td className={`text-right ${r.reversed_at ? "line-through" : ""}`}><Money minor={r.amount_minor} /></Td>
                <Td>{r.reversed_at ? <span className="text-danger-fg">Reversed: {r.reversal_reason}</span> : c.can("dispute.manage") && open ? <details><summary className="cursor-pointer text-sm">Reverse…</summary><ActionForm action={reverseReceipt} submitLabel="Reverse" variant="secondary">{hidden}<input type="hidden" name="receipt_id" value={r.id} /><TextField label="Reason for correction" name="reason" id={`rev-${r.id}`} /></ActionForm></details> : null}</Td></tr>))}</tbody>
          </Table>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            {c.can("receipt.record") && open && coll.outstandingMinor > 0 ? (
              <ActionForm action={recordReceipt} submitLabel="Record receipt" reset>
                {hidden}<input type="hidden" name="invoice_id" value={inv.id} /><h3 className="font-bold">Record a receipt</h3>
                <TextField label="Amount (₹)" name="amount" id="receipt-amount" inputMode="decimal" hint={`Outstanding ${toMajorString(coll.outstandingMinor, "INR")}`} />
                <TextField label="Received on" name="received_on" id="receipt-date" type="date" defaultValue={todayIso()} max={todayIso()} />
                <SelectField label="Method" name="method" id="receipt-method"><option value="bank">Bank transfer</option><option value="cheque">Cheque</option><option value="upi">UPI</option><option value="cash">Cash</option></SelectField>
                <TextField label="Reference" name="reference" id="receipt-ref" optional />
              </ActionForm>
            ) : null}
            <div>
              <h3 className="mb-2 font-bold">Disputes</h3>
              {disputes.length === 0 ? <p className="mb-3 text-ink-500">None raised.</p> : <ul className="mb-4 space-y-3">{disputes.map((d) => (
                <li key={d.id} className="rounded border border-line p-3"><p className="flex items-center gap-2"><Money minor={d.amount_minor} /> <Badge status={d.status} /></p><p className="text-sm text-ink-700">{d.reason}</p>{d.resolution ? <p className="text-sm text-ok-fg">Resolved: {d.resolution}</p> : null}
                  {d.status === "open" && c.can("dispute.manage") && open ? <details className="mt-2"><summary className="cursor-pointer text-sm font-bold">Resolve…</summary><ActionForm action={resolveDispute} submitLabel="Mark resolved" variant="secondary">{hidden}<input type="hidden" name="dispute_id" value={d.id} /><TextField label="Resolution" name="resolution" id={`res-${d.id}`} /></ActionForm></details> : null}</li>))}</ul>}
              {(c.can("dispute.raise") || c.can("dispute.manage")) && open && coll.undisputedOutstandingMinor > 0 ? (
                <ActionForm action={raiseDispute} submitLabel="Record dispute" reset>{hidden}<input type="hidden" name="invoice_id" value={inv.id} />
                  <TextField label="Disputed amount (₹)" name="amount" id="dispute-amount" inputMode="decimal" /><TextAreaField label="Reason" name="reason" id="dispute-reason" /></ActionForm>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}
    </>
  );
}

function LineTable({ lines, editable = false }: { lines: Array<{ id: string; code: string; description: string; unit: string; rate_minor: number; contract_qty_milli: number; prev_qty_milli: number; claimed_qty_milli: number; certified_qty_milli: number; claimed_amount_minor: number; certified_amount_minor: number }>; editable?: boolean }) {
  return (
    <Table caption="Bill lines">
      <thead><tr><Th>Item</Th><Th className="text-right">Contract qty</Th><Th className="text-right">Previously certified</Th><Th className="text-right">Claimed now</Th><Th className="text-right">{editable ? "Certify qty" : "Certified now"}</Th><Th className="text-right">Rate</Th><Th className="text-right">Claimed ₹</Th><Th className="text-right">Certified ₹</Th></tr></thead>
      <tbody>{lines.map((l) => (
        <tr key={l.id}><Td><span className="font-bold">{l.code}</span> <span className="text-ink-500">{l.unit}</span><span className="block text-caption text-ink-500">{l.description}</span></Td>
          <Td className="text-right"><Qty milli={l.contract_qty_milli} /></Td><Td className="text-right"><Qty milli={l.prev_qty_milli} /></Td><Td className="text-right"><Qty milli={l.claimed_qty_milli} /></Td>
          <Td className="text-right">{editable ? <input aria-label={`Certified quantity for ${l.code}`} name={`cert_${l.id}`} defaultValue={formatQty(l.claimed_qty_milli)} inputMode="decimal" className="min-h-touch w-28 rounded border border-ink-500 px-2 text-right font-mono" /> : <Qty milli={l.certified_qty_milli} />}</Td>
          <Td className="text-right"><Money minor={l.rate_minor} /></Td><Td className="text-right"><Money minor={l.claimed_amount_minor} /></Td><Td className="text-right"><Money minor={l.certified_amount_minor} /></Td></tr>))}</tbody>
    </Table>
  );
}
function Totals({ b }: { b: Bill }) {
  const row = (l: string, v: number, strong = false, sub?: string) => <tr><Td className={strong ? "font-bold" : ""}>{l}{sub ? <span className="block text-caption text-ink-500">{sub}</span> : null}</Td><Td className={`text-right ${strong ? "font-bold" : ""}`}><Money minor={v} /></Td></tr>;
  return (
    <div className="mt-4 max-w-lg">
      <Table caption="Bill calculation"><tbody>
        {row("Submitted (claimed) gross", b.claimed_gross_minor)}
        {row("Certified gross", b.certified_gross_minor, true)}
        {row("Less: retention", -b.retention_minor, false, `${formatPercent(b.terms.retentionBp)} of certified gross, capped at ${formatPercent(b.terms.retentionCapBp)} of contract value`)}
        {row("Less: advance recovery", -b.advance_recovery_minor, false, `${formatPercent(b.terms.advanceRecoveryBp)} of certified gross, up to the outstanding advance`)}
        {b.other_deduction_minor ? row("Less: other deductions", -b.other_deduction_minor, false, b.other_deduction_reason ?? undefined) : null}
        {row("Net payable", b.net_minor, true)}
      </tbody></Table>
      <p className="mt-2 text-caption text-ink-500">Before certification, retention and recovery are indicative and recalculated from the certified quantities.</p>
    </div>
  );
}
