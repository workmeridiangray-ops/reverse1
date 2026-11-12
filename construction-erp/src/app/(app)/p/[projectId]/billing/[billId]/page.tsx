import { notFound, redirect } from 'next/navigation';
import { PageHeader, Card, Table, Td, Badge, Money, DL, Field, Alert, fmtDate } from '@/components/ui';
import ActionForm, { ConfirmButton, ReasonForm } from '@/components/ActionForm';
import { requireSession, permSet } from '@/lib/session';
import { withTenant, many, one } from '@/lib/db';
import * as A from '@/app/actions/project';
import { formatQty } from '@/lib/rules/money';
import { milli } from '@/lib/domain/common';
export default async function BillPage({ params }: { params: Promise<{ projectId: string; billId: string }> }) {
  const { projectId, billId } = await params; const s = await requireSession(); const perms = await permSet(s);
  if (!perms.has('billing:view')) redirect('/denied');
  const d = await withTenant(s.ctx, async q => { if (!/^[0-9a-f-]{36}$/.test(billId)) return null; const b = await one<any>(q, 'select * from ra_bills where id=$1 and project_id=$2', [billId, projectId]); if (!b) return null;
    return { b, lines: await many<any>(q, 'select l.*, i.code, i.description, i.unit from ra_bill_lines l join boq_items i on i.id = l.boq_item_id where bill_id=$1 order by i.code', [billId]),
      inv: await one<any>(q, 'select * from invoices where bill_id=$1', [billId]), disputes: await many<any>(q, `select d.* from disputes d join invoices i on i.id=d.invoice_id where i.bill_id=$1`, [billId]), receipts: await many<any>(q, `select r.* from receipts r join invoices i on i.id=r.invoice_id where i.bill_id=$1 order by received_on`, [billId]) }; });
  if (!d) notFound(); const { b, lines, inv } = d; const cert = ['certified', 'invoiced'].includes(b.status);
  return (<>
    <PageHeader title={`Running bill ${b.bill_no}`} sub={<Badge status={b.status} />} crumbs={[{ href: `/p/${projectId}/billing`, label: 'Client billing' }, { label: `Bill ${b.bill_no}` }]} />
    <div className="flex flex-wrap gap-2 mb-6 items-start">
      {b.status === 'draft' && perms.has('billing:edit') && <ConfirmButton action={A.submitBillAction.bind(null, b.id)} label="Submit for certification" confirmText="Submit this bill to the client/consultant?" className="btn btn-primary" />}
      {b.status === 'certified' && perms.has('billing:edit') && <ConfirmButton action={A.invoiceBillAction.bind(null, b.id)} label="Raise invoice" confirmText="Raise the invoice for the certified amount?" className="btn btn-primary" />}
      {b.status === 'submitted' && perms.has('billing:approve') && <ReasonForm action={A.rejectBillAction.bind(null, b.id)} label="Reject bill" reasonLabel="Why is it rejected?" danger />}
    </div>
    {b.reject_reason && <div className="mb-4"><Alert kind={b.status === 'rejected' ? 'bad' : 'info'} title={b.status === 'rejected' ? 'Rejected' : 'Certification note'}>{b.reject_reason}</Alert></div>}
    {b.status === 'submitted' && perms.has('billing:approve') ? (
      <Card title="Record the certificate" className="mb-6"><ActionForm action={A.certifyBillAction.bind(null, b.id)} submit="Certify">
        <Table head={[{ label: 'Item' }, { label: 'Previous cum.', num: true }, { label: 'Claimed', num: true }, { label: 'Rate', num: true, hideSm: true }, { label: 'Certified qty', num: true }]}>{lines.map((l: any) => <tr key={l.id}><Td>{l.code}<div className="text-xs text-muted">{l.description}</div></Td><Td num>{formatQty(milli(l.prev_cum_qty))}</Td><Td num>{formatQty(milli(l.this_qty))} {l.unit}</Td><Td num hideSm><Money v={l.rate_paise} /></Td><Td><input name={`cert_${l.id}`} aria-label={`Certified quantity ${l.code}`} defaultValue={String(l.this_qty)} inputMode="decimal" className="input num" /></Td></tr>)}</Table>
        <div className="grid sm:grid-cols-2 gap-3"><Field label="Certificate reference" name="ref" required><input id="ref" name="ref" className="input" required minLength={3} /></Field><Field label="Reason if certifying less than claimed" name="reduce_reason"><input id="reduce_reason" name="reduce_reason" className="input" /></Field></div>
        <p className="help">Advance recovery and retention are calculated on cumulative certified gross value, after you certify. Clients and consultants with delegated authority can also certify from their portal.</p></ActionForm></Card>
    ) : (
      <Card title="Lines" className="mb-6"><Table head={[{ label: 'Item' }, { label: 'Previous', num: true }, { label: 'Claimed', num: true }, { label: 'Certified', num: true }, { label: 'Claimed ₹', num: true, hideSm: true }, { label: 'Certified ₹', num: true }]}>{lines.map((l: any) => <tr key={l.id}><Td>{l.code}</Td><Td num>{formatQty(milli(l.prev_cum_qty))}</Td><Td num>{formatQty(milli(l.this_qty))}</Td><Td num>{l.certified_this_qty === null ? '—' : formatQty(milli(l.certified_this_qty))}</Td><Td num hideSm><Money v={l.amount_submitted_paise} /></Td><Td num>{cert ? <Money v={l.amount_certified_paise} /> : '—'}</Td></tr>)}</Table></Card>
    )}
    <Card title="Calculation" className="mb-6"><DL items={[['Claimed this bill', <Money v={b.submitted_paise} />], ['Cumulative gross certified', cert ? <Money v={b.certified_gross_paise} /> : '—'], ['Less: advance recovered (cumulative)', cert ? <Money v={b.advance_recovery_paise} /> : '—'], ['Less: retention (cumulative)', cert ? <Money v={b.retention_paise} /> : '—'], ['Gross certified in earlier bills', <Money v={b.prev_certified_gross_paise} />], ['Net payable on this bill', cert ? <strong><Money v={b.net_certified_paise} /></strong> : '—'], ['Certificate ref', b.certificate_ref]]} /></Card>
    {inv && (<Card title={`Invoice ${inv.number}`} className="mb-6"><DL items={[['Amount', <Money v={inv.amount_paise} />], ['Collected', <Money v={inv.collected_paise} />], ['Written off', <Money v={inv.written_off_paise} />], ['Status', <Badge status={inv.status} />], ['Due', fmtDate(inv.due_date)]]} />
      <Table head={[{ label: 'Receipt' }, { label: 'Date' }, { label: 'Amount', num: true }]}>{d.receipts.map((r: any) => <tr key={r.id}><Td>{r.reference}</Td><Td>{fmtDate(r.received_on)}</Td><Td num><Money v={r.amount_paise} /></Td></tr>)}</Table>
      {perms.has('billing:edit') && <div className="grid lg:grid-cols-2 gap-6 mt-4">
        <div><h3 className="mb-2">Record a receipt</h3><ActionForm action={A.receiptAction.bind(null, inv.id)} submit="Record receipt" resetOnSuccess><div className="grid grid-cols-2 gap-3"><Field label="Amount (₹)" name="amount" required><input id="amount" name="amount" inputMode="decimal" className="input" required /></Field><Field label="Received on" name="received_on" required><input id="received_on" name="received_on" type="date" className="input" required /></Field><Field label="Method" name="method"><select id="method" name="method" className="input"><option value="bank">Bank transfer</option><option value="cheque">Cheque</option><option value="upi">UPI</option></select></Field><Field label="UTR / cheque no." name="reference" required><input id="reference" name="reference" className="input" required /></Field></div></ActionForm></div>
        <div><h3 className="mb-2">Record a disputed amount</h3><ActionForm action={A.disputeAction.bind(null, inv.id)} submit="Record dispute" resetOnSuccess><Field label="Disputed amount (₹)" name="amount" required><input id="amount" name="amount" inputMode="decimal" className="input" required /></Field><Field label="Reason" name="reason" required><input id="reason" name="reason" className="input" required minLength={3} /></Field></ActionForm></div></div>}
      {d.disputes.length > 0 && <ul className="mt-4 divide-y divide-line">{d.disputes.map((x: any) => <li key={x.id} className="py-2 flex flex-wrap justify-between gap-2 items-start"><span><Money v={x.amount_paise} /> — {x.reason} <Badge status={x.status} /></span>{x.status === 'open' && perms.has('billing:edit') && <span className="flex gap-2"><ReasonForm action={A.resolveDisputeAction.bind(null, x.id, 'resolved')} label="Resolve" reasonLabel="Resolution" /><ReasonForm action={A.resolveDisputeAction.bind(null, x.id, 'written_off')} label="Write off" reasonLabel="Basis for write-off (manager)" danger /></span>}</li>)}</ul>}
    </Card>)}
  </>);
}
