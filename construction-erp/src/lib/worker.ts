import 'server-only';
import { withSystem, withTenant, many, one, type Q } from './db';
import { deliver } from './mail';
import { backoffSeconds, enqueue } from './jobs';
import { runSubscriptionSweep } from './domain/saas';
import { putObject } from './storage';
import { toCsv } from './engine';
import { makeZip } from './zip';
import { audit, notify } from './audit';

const EXPORT_TABLES: [string, string][] = [['boq_items', 'select code, description, unit, qty, rate_paise, source from boq_items where project_id=$1 order by code'], ['ra_bills', 'select bill_no, period_to, status, submitted_paise, certified_gross_paise, advance_recovery_paise, retention_paise, net_certified_paise from ra_bills where project_id=$1 order by bill_no'],
  ['invoices', 'select number, amount_paise, collected_paise, written_off_paise, status, due_date from invoices where project_id=$1 order by number'], ['receipts', 'select r.reference, r.amount_paise, r.received_on, r.method from receipts r where r.project_id=$1 order by received_on'],
  ['variations', 'select number, title, cost_delta_paise, time_delta_days, status from variations where project_id=$1 order by number'], ['drawings', `select d.number, d.title, r.rev, r.status from drawing_revisions r join drawings d on d.id=r.drawing_id where r.project_id=$1 order by d.number, r.rev`],
  ['rfis', 'select number, location, status, due_date, response from rfis where project_id=$1 order by number'], ['purchase_orders', 'select number, status, total_paise from purchase_orders where project_id=$1 order by number'],
  ['snags', 'select number, description, status from snags where project_id=$1 order by number'], ['daily_reports', 'select report_date, status from daily_reports where project_id=$1 order by report_date']];

async function exportProject(q: Q, orgId: string, projectId: string, by: string) {
  const files: { name: string; data: Buffer }[] = [];
  for (const [name, sql] of EXPORT_TABLES) { const rows = await many<any>(q, sql, [projectId]); const cols = rows[0] ? Object.keys(rows[0]).map(k => ({ key: k, label: k })) : [{ key: 'empty', label: 'no rows' }]; files.push({ name: `${name}.csv`, data: Buffer.from(toCsv(rows, cols)) }); }
  const aud = await many<any>(q, `select at, action, entity, entity_id, actor_role from audit_log where org_id=$1 and (entity_id = $2 or detail::text like '%'||$2||'%') order by id`, [orgId, projectId]);
  files.push({ name: 'audit_trail.csv', data: Buffer.from(toCsv(aud, ['at', 'action', 'entity', 'entity_id', 'actor_role'].map(k => ({ key: k, label: k })))) });
  const zip = makeZip(files); const obj = await putObject(orgId, zip);
  const f = await one<any>(q, `insert into files(org_id, project_id, name, mime, size_bytes, sha256, storage_key, kind, uploaded_by) values ($1,$2,$3,'application/zip',$4,$5,$6,'export',$7) returning id`, [orgId, projectId, `project-export-${new Date().toISOString().slice(0, 10)}.zip`, zip.length, obj.sha256, obj.key, by]);
  await notify(q, orgId, [by], 'Project export is ready', 'Download it from Handover & closure.', `/p/${projectId}/handover`);
  await audit(q, { orgId, actorId: by, action: 'export.ready', entity: 'files', entityId: f!.id });
}

export async function runCycle(): Promise<{ mail: number; jobs: number; failed: number }> {
  const stat = { mail: 0, jobs: 0, failed: 0 };
  await withSystem(q => enqueue(q, 'subscriptions.sweep', {}, { dedupeKey: `sweep:${new Date().toISOString().slice(0, 13)}` }));
  const mails = await withSystem(q => many<any>(q, `select * from email_outbox where status='queued' and attempts < 5 order by created_at limit 20`));
  for (const m of mails) {
    try { await deliver(m); await withSystem(q => q.query(`update email_outbox set status='sent', sent_at=now(), attempts=attempts+1 where id=$1`, [m.id])); stat.mail++; }
    catch (e) { await withSystem(q => q.query(`update email_outbox set attempts=attempts+1, last_error=$2, status = case when attempts+1 >= 5 then 'failed' else 'queued' end where id=$1`, [m.id, (e as Error).message.slice(0, 200)])); }
  }
  const jobs = await withSystem(q => many<any>(q, `update jobs set status='running', locked_at=now(), attempts=attempts+1 where id in (
      select id from jobs where (status='queued' and run_at <= now()) or (status='running' and locked_at < now() - interval '10 minutes') order by run_at limit 5 for update skip locked) returning *`));
  for (const j of jobs) {
    try {
      if (j.kind === 'subscriptions.sweep') await withSystem(q => runSubscriptionSweep(q));
      else if (j.kind === 'project.export') await withTenant({ userId: j.payload.requestedBy, orgId: j.org_id, role: 'system' }, q => exportProject(q, j.org_id, j.payload.projectId, j.payload.requestedBy));
      else throw new Error(`unknown job kind ${j.kind}`);
      await withSystem(q => q.query(`update jobs set status='done', finished_at=now(), last_error=null where id=$1`, [j.id])); stat.jobs++;
    } catch (e) {
      const dead = j.attempts >= j.max_attempts; stat.failed++;
      await withSystem(q => q.query(`update jobs set status=$2, last_error=$3, run_at = now() + ($4 || ' seconds')::interval, finished_at = case when $2='failed' then now() end where id=$1`, [j.id, dead ? 'failed' : 'queued', (e as Error).message.slice(0, 300), String(backoffSeconds(j.attempts))]));
    }
  }
  return stat;
}
