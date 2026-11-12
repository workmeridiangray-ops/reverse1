import Link from 'next/link';
import { Card, Table, Td, Badge, Money, Field, Alert, fmtDate, fmtDateTime } from './ui';
import ActionForm, { ConfirmButton, ReasonForm } from './ActionForm';
import Uploader from './Uploader';
import { withTenant, many, one, type Ctx } from '@/lib/db';
import * as X from '@/app/actions/extras';
import { formatQty, formatINR } from '@/lib/rules/money';
import { milli } from '@/lib/domain/common';
import { cumulativeMeasured } from '@/lib/domain/subcontract';

const Sel = ({ name, label, options, required = true }: { name: string; label: string; options: { id: string; label: string }[]; required?: boolean }) =>
  <Field label={label} name={name} required={required}><select id={name} name={name} className="input" required={required}><option value="">Choose…</option>{options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select></Field>;
const Txt = ({ name, label, ...r }: any) => <Field label={label} name={name} required={r.required} help={r.help}><input id={name} name={name} className="input" {...r} /></Field>;

export async function Attachments({ entityType, entityId, projectId, canUpload, ctx }: { entityType: string; entityId: string; projectId: string | null; canUpload: boolean; ctx: Ctx }) {
  const docs = await withTenant(ctx, q => many<any>(q, `select d.id, d.title, d.kind, d.created_at, f.id file_id, f.size_bytes, f.mime from documents d join files f on f.id = d.file_id where d.entity_type = $1 and d.entity_id = $2 order by d.created_at desc`, [entityType, entityId]));
  return (
    <Card title="Attachments & evidence" className="mt-6">
      {docs.length === 0 ? <p className="text-sm text-muted mb-3">No files attached yet. PDF, JPG, PNG, CSV, XLSX, DOCX or ZIP, up to 25 MB.</p> :
        <ul className="divide-y divide-line mb-3">{docs.map((d: any) => <li key={d.id} className="py-2 flex justify-between gap-3 text-sm"><a href={`/api/files/${d.file_id}`}>{d.title}</a><span className="text-muted whitespace-nowrap">{Math.max(1, Math.round(d.size_bytes / 1024))} KB · {fmtDateTime(d.created_at)}</span></li>)}</ul>}
      {canUpload && <Uploader project={projectId} entityType={entityType} entityId={entityId} />}
    </Card>
  );
}

export async function Extras({ entity, row, projectId, perms, ctx }: { entity: string; row: any; projectId: string; perms: Set<string>; ctx: Ctx }) {
  const id = row.id as string;
  const body = await withTenant(ctx, async q => {
    switch (entity) {
      case 'material_requests': {
        const lines = await many<any>(q, 'select l.*, (select code from boq_items b where b.id = l.boq_item_id) boq from mr_lines l where mr_id = $1 order by l.created_at', [id]);
        const boq = await many<any>(q, `select id, code || ' · ' || description label from boq_items where project_id = $1 order by code`, [projectId]);
        const editable = ['draft', 'rejected'].includes(row.status) && perms.has('procurement:create');
        const rfq = await one<any>(q, 'select * from rfqs where mr_id = $1', [id]);
        return (
          <Card title="Requested items" className="mb-6">
            <Table head={[{ label: 'Item' }, { label: 'Description' }, { label: 'Unit' }, { label: 'Quantity', num: true }, { label: 'BOQ', hideSm: true }, { label: '' }]}>
              {lines.map((l: any) => <tr key={l.id}><Td>{l.item_code}</Td><Td>{l.description}</Td><Td>{l.unit}</Td><Td num>{formatQty(milli(l.qty))}</Td><Td hideSm>{l.boq ?? '—'}</Td><Td>{editable && <ConfirmButton action={X.removeMrLine.bind(null, l.id)} label="Remove" confirmText="Remove this line?" />}</Td></tr>)}
            </Table>
            {editable && <div className="mt-4"><ActionForm action={X.addMrLine.bind(null, id)} submit="Add line" resetOnSuccess><div className="grid sm:grid-cols-5 gap-3"><Txt name="item_code" label="Item code" required placeholder="CEM-53" /><div className="sm:col-span-2"><Txt name="description" label="Description" required /></div><Txt name="unit" label="Unit" required placeholder="bag" /><Txt name="qty" label="Quantity" required inputMode="decimal" /></div><Sel name="boq_item_id" label="Charge to BOQ item (for budget tracking)" options={boq} required={false} /></ActionForm></div>}
            {row.status === 'approved' && perms.has('procurement:create') && !rfq && <div className="mt-4"><ActionForm action={X.createRfqAction.bind(null, id)} submit="Create RFQ for quotes" submitClass="btn btn-primary"><p className="text-sm text-muted">Collect quotes from suppliers, compare them and place an order.</p></ActionForm></div>}
            {rfq && <p className="mt-3 text-sm">RFQ <strong>{rfq.number}</strong> — manage quotes on the <Link href={`/p/${projectId}/procurement`}>Procurement page</Link>.</p>}
          </Card>
        );
      }
      case 'purchase_orders': {
        const lines = await many<any>(q, 'select * from po_lines where po_id = $1 order by created_at', [id]);
        const sites = await many<any>(q, `select id, code || ' · ' || name label from wbs_nodes where project_id = $1 and kind = 'site' order by code`, [projectId]);
        const grns = await many<any>(q, `select g.*, w.name site from goods_receipts g join wbs_nodes w on w.id = g.site_id where po_id = $1 order by g.created_at`, [id]);
        const canReceive = ['issued', 'part_received'].includes(row.status) && perms.has('stores:create');
        return (
          <>
            <Card title="Order lines" className="mb-6">
              <Table head={[{ label: 'Item' }, { label: 'Qty', num: true }, { label: 'Rate', num: true }, { label: 'Value', num: true }, { label: 'Received', num: true }, { label: 'Rejected', num: true, hideSm: true }]}>
                {lines.map((l: any) => <tr key={l.id}><Td>{l.item_code}<div className="text-xs text-muted">{l.description}</div></Td><Td num>{formatQty(milli(l.qty))} {l.unit}</Td><Td num><Money v={l.rate_paise} /></Td><Td num><Money v={BigInt(Math.round(Number(l.qty) * Number(l.rate_paise)))} /></Td><Td num>{formatQty(milli(l.received_qty))}</Td><Td num hideSm>{formatQty(milli(l.rejected_qty))}</Td></tr>)}
              </Table>
              {grns.length > 0 && <p className="text-sm mt-3">Goods receipts: {grns.map((g: any) => `${g.number} (${g.site}, ${fmtDate(g.received_on)})`).join('; ')}</p>}
            </Card>
            {canReceive && (
              <Card title="Receive goods" className="mb-6">
                <ActionForm action={X.receiveGoodsAction.bind(null, id)} submit="Record goods receipt">
                  <div className="grid sm:grid-cols-3 gap-3"><Sel name="site_id" label="Received at site" options={sites} /><Txt name="received_on" label="Received on" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /><Txt name="notes" label="Delivery note / remarks" /></div>
                  {lines.map((l: any) => { const open = milli(l.qty) - milli(l.received_qty); return (
                    <fieldset key={l.id} className="border border-line rounded p-3"><legend className="px-1 text-sm font-medium">{l.item_code} — ordered {formatQty(milli(l.qty))}, received so far {formatQty(milli(l.received_qty))} {l.unit}</legend>
                      <div className="grid sm:grid-cols-4 gap-3"><Txt name={`rec_${l.id}`} label="Received now" inputMode="decimal" help={`Open: ${formatQty(open)}`} /><Txt name={`acc_${l.id}`} label="Accepted" inputMode="decimal" help="Leave blank = all accepted" />
                        <Txt name={`reason_${l.id}`} label="Rejection reason" help="Needed if some is rejected" /><Field label="Supplier will" name={`exp_${l.id}`}><select id={`exp_${l.id}`} name={`exp_${l.id}`} className="input"><option value="none">—</option><option value="replacement">Replace</option><option value="credit">Credit</option></select></Field></div>
                    </fieldset>); })}
                </ActionForm>
              </Card>
            )}
          </>
        );
      }
      case 'work_orders': {
        const items = await many<any>(q, 'select i.*, b.code from wo_items i join boq_items b on b.id = i.boq_item_id where work_order_id = $1 order by i.created_at', [id]);
        const boq = await many<any>(q, `select id, code || ' · ' || description || ' (' || unit || ')' label from boq_items where project_id = $1 order by code`, [projectId]);
        return (
          <Card title="Scope & rates" className="mb-6">
            <Table head={[{ label: 'BOQ item' }, { label: 'Description', hideSm: true }, { label: 'Limit', num: true }, { label: 'Tolerance', num: true, hideSm: true }, { label: 'Rate', num: true }]}>
              {items.map((i: any) => <tr key={i.id}><Td>{i.code}</Td><Td hideSm>{i.description}</Td><Td num>{formatQty(milli(i.qty_limit))} {i.unit}</Td><Td num hideSm>{i.tolerance_bp / 100}%</Td><Td num><Money v={i.rate_paise} /></Td></tr>)}
            </Table>
            {row.status === 'draft' && perms.has('subcontract:create') && <div className="mt-4"><ActionForm action={X.addWoItemAction.bind(null, id)} submit="Add item" resetOnSuccess><div className="grid sm:grid-cols-4 gap-3"><div className="sm:col-span-2"><Sel name="boq_item_id" label="BOQ item" options={boq} /></div><Txt name="rate" label="Subcontract rate (₹/unit)" required inputMode="decimal" /><Txt name="qty_limit" label="Quantity limit" required inputMode="decimal" /><Txt name="tolerance_bp" label="Tolerance (bp)" required defaultValue="0" help="500 = 5%" /></div></ActionForm></div>}
          </Card>
        );
      }
      case 'measurement_sheets': {
        const lines = await many<any>(q, `select l.*, i.description, i.unit from measurement_lines l join wo_items i on i.id = l.wo_item_id where sheet_id = $1 order by l.measured_on, l.created_at`, [id]);
        const items = await many<any>(q, `select id, description || ' (' || unit || ')' label from wo_items where work_order_id = $1`, [row.work_order_id]);
        const editable = ['draft', 'rejected'].includes(row.status) && perms.has('subcontract:create');
        const bill = await one<any>(q, 'select * from sub_bills where sheet_id = $1', [id]);
        return (
          <Card title="Measurements" className="mb-6">
            <Table head={[{ label: 'Item' }, { label: 'Location' }, { label: 'Measured on', hideSm: true }, { label: 'Quantity', num: true }, { label: '' }]}>
              {lines.map((l: any) => <tr key={l.id}><Td>{l.description}</Td><Td>{l.location}</Td><Td hideSm>{fmtDate(l.measured_on)}</Td><Td num>{formatQty(milli(l.qty))} {l.unit}</Td><Td>{editable && <ConfirmButton action={X.removeMeasurement.bind(null, l.id)} label="Remove" confirmText="Remove this measurement?" />}</Td></tr>)}
            </Table>
            {editable && <div className="mt-4"><ActionForm action={X.addMeasurementAction.bind(null, id)} submit="Add measurement" resetOnSuccess><div className="grid sm:grid-cols-4 gap-3"><div className="sm:col-span-2"><Sel name="wo_item_id" label="Work-order item" options={items} /></div><Txt name="location" label="Location" required placeholder="Grid A–C, Level 2" /><Txt name="measured_on" type="date" label="Measured on" required /><Txt name="qty" label="Quantity" required inputMode="decimal" /></div></ActionForm></div>}
            {row.status === 'approved' && !bill && perms.has('subcontract:create') && (
              <div className="mt-6 border-t border-line pt-4"><h3 className="mb-2">Create subcontract bill</h3>
                <ActionForm action={X.createSubBillAction.bind(null, id)} submit="Create bill"><div className="grid sm:grid-cols-3 gap-3"><Txt name="material" label="Material recovery (₹)" inputMode="decimal" help="Material issued free of cost" /><Txt name="other" label="Other deductions (₹)" inputMode="decimal" /><Txt name="deduction_reason" label="Reason for deductions" /></div><p className="help">Retention and advance recovery are applied from the work order automatically and shown on the bill.</p></ActionForm></div>
            )}
            {bill && <p className="mt-3 text-sm">Billed in <Link href={`/p/${projectId}/e/sub_bills/${bill.id}`}>{bill.number}</Link> — this measured work cannot be billed again.</p>}
          </Card>
        );
      }
      case 'variations': {
        const items = await many<any>(q, `select i.*, b.code base_code from variation_items i left join boq_items b on b.id = i.base_boq_item_id where variation_id = $1 order by i.created_at`, [id]);
        const boq = await many<any>(q, `select id, code || ' · ' || description || ' @ ' || rate_paise label from boq_items where project_id = $1 and source <> 'variation' order by code`, [projectId]);
        return (
          <Card title={`Cost impact: ${formatINR(row.cost_delta_paise)} · Time impact: ${row.time_delta_days} day(s)`} className="mb-6">
            <Table head={[{ label: 'Item' }, { label: 'Basis', hideSm: true }, { label: 'Qty', num: true }, { label: 'Rate', num: true }, { label: 'Amount', num: true }, { label: '' }]}>
              {items.map((i: any) => <tr key={i.id}><Td>{i.code}<div className="text-xs text-muted">{i.description}</div></Td><Td hideSm>{i.base_code ? `Existing item ${i.base_code} — original contract rate` : 'New item — proposed rate'}</Td><Td num>{formatQty(milli(i.qty))} {i.unit}</Td><Td num><Money v={i.rate_paise} /></Td><Td num><Money v={BigInt(Math.round(Number(i.qty) * Number(i.rate_paise)))} /></Td><Td>{row.status === 'draft' && perms.has('variations:create') && <ConfirmButton action={X.removeVariationItem.bind(null, id, i.id)} label="Remove" confirmText="Remove this item?" />}</Td></tr>)}
            </Table>
            {row.status === 'draft' && perms.has('variations:create') && <div className="mt-4"><ActionForm action={X.addVariationItem.bind(null, id)} submit="Add item" resetOnSuccess><div className="grid sm:grid-cols-5 gap-3"><Txt name="code" label="Code" required /><div className="sm:col-span-2"><Txt name="description" label="Description" required /></div><Txt name="unit" label="Unit" required /><Txt name="qty" label="Quantity" required inputMode="decimal" /></div>
              <div className="grid sm:grid-cols-2 gap-3"><Sel name="base_boq_item_id" label="Vary an existing BOQ item (keeps its contract rate)" options={boq} required={false} /><Txt name="rate" label="Rate for a NEW item (₹/unit)" inputMode="decimal" help="Ignored when an existing item is chosen" /></div></ActionForm></div>}
          </Card>
        );
      }
      case 'ncrs': {
        const acts = await many<any>(q, `select a.*, u.name owner from corrective_actions a left join users u on u.id = a.owner_user_id where ncr_id = $1 order by a.created_at`, [id]);
        const users = await many<any>(q, `select u.id, u.name label from users u join memberships m on m.user_id = u.id and m.status='active' where m.org_id = app_org() and m.role not in ('client','consultant','contractor') order by 2`);
        return (
          <Card title="Corrective actions" className="mb-6">
            {acts.length === 0 && <p className="text-sm text-muted mb-3">No actions yet. Assign an owner and a due date.</p>}
            <ul className="divide-y divide-line">{acts.map((a: any) => (
              <li key={a.id} className="py-3 space-y-2"><div className="flex flex-wrap gap-2 items-center justify-between"><span>{a.action} <span className="text-sm text-muted">— {a.owner ?? 'unassigned'}{a.due_date ? `, due ${fmtDate(a.due_date)}` : ''}</span></span><Badge status={a.status} /></div>
                {a.status === 'open' && perms.has('quality:edit') && <ActionForm action={X.completeCorrectiveAction.bind(null, a.id)} submit="Mark done with evidence" submitClass="btn btn-sm btn-primary"><Uploader project={projectId} entityType="corrective_actions" entityId={a.id} label="Evidence (photo or document)" hiddenName="file_id" kind="evidence" /></ActionForm>}
                {a.status === 'done' && perms.has('quality:approve') && <ConfirmButton action={X.verifyCorrectiveAction.bind(null, a.id)} label="Verify correction" confirmText="Confirm the correction has been checked on site?" className="btn btn-sm btn-primary" />}
              </li>))}</ul>
            {row.status !== 'closed' && perms.has('quality:edit') && <div className="mt-4"><ActionForm action={X.addCorrectiveAction.bind(null, id)} submit="Assign action" resetOnSuccess><div className="grid sm:grid-cols-3 gap-3"><div className="sm:col-span-3"><Txt name="action" label="Corrective action" required /></div><Sel name="owner_user_id" label="Owner" options={users} required={false} /><Txt name="due_date" type="date" label="Due" /></div></ActionForm></div>}
          </Card>
        );
      }
      case 'drawings': {
        const revs = await many<any>(q, 'select r.*, f.name fname from drawing_revisions r left join files f on f.id = r.file_id where drawing_id = $1 order by r.created_at desc', [id]);
        const cur = revs.find((r: any) => r.status === 'approved');
        return (
          <Card title="Revisions" className="mb-6">
            {cur ? <Alert kind="ok" title={`Current for site execution: revision ${cur.rev}`}>Approved {fmtDate(cur.approved_at)}. Earlier revisions are superseded and must not be used on site.</Alert> : <Alert kind="warn" title="No approved revision">Nothing on this drawing is approved for site use yet.</Alert>}
            <div className="mt-3"><Table head={[{ label: 'Rev' }, { label: 'Status' }, { label: 'File' }, { label: 'Note', hideSm: true }, { label: 'Actions' }]}>
              {revs.map((r: any) => <tr key={r.id}><Td>{r.rev}</Td><Td><Badge status={r.status} /></Td><Td>{r.file_id ? <a href={`/api/files/${r.file_id}`}>{r.fname}</a> : '—'}</Td><Td hideSm>{r.note ?? ''}</Td>
                <Td><div className="flex flex-wrap gap-2">
                  {r.status === 'draft' && perms.has('drawings:edit') && <ConfirmButton action={X.revisionFlowAction.bind(null, r.id, 'review')} label="Send for review" confirmText="Send this revision for review?" />}
                  {r.status === 'in_review' && perms.has('drawings:approve') && <><ConfirmButton action={X.revisionFlowAction.bind(null, r.id, 'approve')} label="Approve" confirmText={`Approve revision ${r.rev}? Any currently approved revision will be superseded.`} className="btn btn-sm btn-primary" /><ReasonForm action={X.revisionFlowAction.bind(null, r.id, 'reject')} label="Reject" danger /></>}
                </div></Td></tr>)}
            </Table></div>
            {perms.has('drawings:create') && <div className="mt-4 border-t border-line pt-4"><h3 className="mb-2">Add a revision</h3><ActionForm action={X.addRevisionAction.bind(null, id)} submit="Add revision" resetOnSuccess><div className="grid sm:grid-cols-3 gap-3"><Txt name="rev" label="Revision" required placeholder="B" /><div className="sm:col-span-2"><Txt name="note" label="What changed" /></div></div><Uploader project={projectId} entityType="drawings" entityId={id} label="Drawing file (PDF)" accept=".pdf,.png,.jpg,.jpeg" hiddenName="file_id" kind="drawing" /></ActionForm></div>}
          </Card>
        );
      }
      case 'transmittals': {
        const items = await many<any>(q, `select t.*, d.number, r.rev, r.status from transmittal_items t join drawing_revisions r on r.id = t.drawing_revision_id join drawings d on d.id = r.drawing_id where transmittal_id = $1`, [id]);
        const revs = await many<any>(q, `select r.id, d.number || ' rev ' || r.rev label from drawing_revisions r join drawings d on d.id = r.drawing_id where r.project_id = $1 and r.status = 'approved' order by 2`, [projectId]);
        return (
          <Card title="Drawings in this transmittal (distribution log)" className="mb-6">
            <Table head={[{ label: 'Drawing' }, { label: 'Revision' }, { label: 'Status' }]}>{items.map((i: any) => <tr key={i.id}><Td>{i.number}</Td><Td>{i.rev}</Td><Td><Badge status={i.status} /></Td></tr>)}</Table>
            {row.status === 'draft' && <div className="mt-4"><ActionForm action={X.addTransmittalItem.bind(null, id)} submit="Add drawing" resetOnSuccess><Sel name="drawing_revision_id" label="Approved revision to send" options={revs} /></ActionForm></div>}
            {row.status === 'sent' && <p className="text-sm mt-3">Sent {fmtDateTime(row.sent_at)}. The distribution record is permanent.</p>}
          </Card>
        );
      }
      default: return null;
    }
  });
  const attachable = ['rfis', 'inspections', 'ncrs', 'snags', 'warranties', 'drawings', 'variations', 'work_orders', 'opportunities', 'material_requests'].includes(entity);
  return (
    <>
      {body}
      {attachable && <Attachments entityType={entity === 'drawings' ? 'drawings' : entity} entityId={id} projectId={projectId} canUpload={perms.size > 0} ctx={ctx} />}
    </>
  );
}
