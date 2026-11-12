import { type Q, many } from './db';
/** One queue of everything waiting on this person. Filtered by what they are allowed to act on. */
export async function decisions(q: Q, perms: Set<string>, userId: string) {
  const parts: string[] = [];
  const add = (cond: boolean, sql: string) => { if (cond) parts.push(sql); };
  add(perms.has('procurement:approve'), `select 'Material request' kind, m.number ref, m.project_id, m.id::text id, 'material_requests' ent, 'Approve or reject' act, m.updated_at at from material_requests m where m.status = 'submitted'`);
  add(perms.has('procurement:approve'), `select 'Purchase order', m.number, m.project_id, m.id::text, 'purchase_orders', 'Approve', m.updated_at from purchase_orders m where m.status = 'draft'`);
  add(perms.has('subcontract:approve') || perms.has('subcontract:edit'), `select 'Measurement sheet', m.number, m.project_id, m.id::text, 'measurement_sheets', case m.status when 'prepared' then 'Jointly verify' else 'Approve' end, m.updated_at from measurement_sheets m where m.status in ('prepared','verified')`);
  add(perms.has('subcontract:approve'), `select 'Subcontract bill', m.number, m.project_id, m.id::text, 'sub_bills', 'Approve', m.updated_at from sub_bills m where m.status = 'draft'`);
  add(perms.has('site:approve') || perms.has('site:edit'), `select 'Daily report', m.report_date::text, m.project_id, m.id::text, 'daily_reports', 'Review & verify', m.updated_at from daily_reports m where m.status = 'submitted'`);
  add(perms.has('quality:approve') || perms.has('quality:edit'), `select 'Inspection', m.number, m.project_id, m.id::text, 'inspections', 'Record outcome', m.updated_at from inspections m where m.status = 'requested'`);
  add(perms.has('quality:edit'), `select 'Corrective action', n.number, a.project_id, n.id::text, 'ncrs', 'Verify the correction', a.updated_at from corrective_actions a join ncrs n on n.id = a.ncr_id where a.status = 'done'`);
  add(perms.has('billing:edit'), `select 'Measurement entry', concat(b.location,' ', b.measured_on), b.project_id, b.id::text, 'measurement_book', 'Verify', b.updated_at from measurement_book b where b.status = 'draft'`);
  add(perms.has('billing:approve') || perms.has('billing:edit'), `select 'Running bill (awaiting client)', concat('Bill ', b.bill_no), b.project_id, b.id::text, 'ra_bills', 'Follow up / record certificate', b.updated_at from ra_bills b where b.status = 'submitted'`);
  add(perms.has('billing:edit'), `select 'Certified bill to invoice', concat('Bill ', b.bill_no), b.project_id, b.id::text, 'ra_bills', 'Raise invoice', b.updated_at from ra_bills b where b.status = 'certified'`);
  add(perms.has('variations:edit'), `select 'Variation (awaiting decision)', v.number, v.project_id, v.id::text, 'variations', 'Follow up / record decision', v.updated_at from variations v where v.status = 'submitted'`);
  add(perms.has('variations:edit'), `select 'Approved variation to apply', v.number, v.project_id, v.id::text, 'variations', 'Apply to BOQ', v.updated_at from variations v where v.status = 'approved' and not v.applied`);
  add(perms.has('rfi:view'), `select 'RFI overdue', r.number, r.project_id, r.id::text, 'rfis', 'Chase response', r.updated_at from rfis r where r.status = 'open' and r.due_date < current_date`);
  add(perms.has('handover:edit'), `select 'Snag to verify', s.number, s.project_id, s.id::text, 'snags', 'Verify rectification', s.updated_at from snags s where s.status = 'rectified'`);
  if (!parts.length) return [];
  return many<any>(q, `select i.*, p.name project_name, p.code project_code from (${parts.join(' union all ')}) i join projects p on p.id = i.project_id order by i.at asc limit 200`);
}
