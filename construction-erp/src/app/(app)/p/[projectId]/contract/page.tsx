import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader, Card, DL, Money, Badge, Table, Td, Stat, Alert, fmtDate, Field } from '@/components/ui';
import ActionForm, { ConfirmButton } from '@/components/ActionForm';
import { requireSession, permSet } from '@/lib/session';
import { withTenant, many, one } from '@/lib/db';
import { projectOrNotFound } from '@/lib/page-helpers';
import { createContractAction, activateContractAction, recordAdvanceAction, releaseRetentionAction } from '@/app/actions/project';
import { ledgerBalance } from '@/lib/domain/contracts';
export const metadata = { title: 'Contract · Buildline' };
export default async function Contract({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params; const s = await requireSession(); const perms = await permSet(s);
  if (!perms.has('contract:view')) redirect('/denied');
  const d = await withTenant(s.ctx, async q => {
    await projectOrNotFound(q, projectId);
    const c = await one<any>(q, `select * from contracts where project_id = $1 order by status = 'active' desc, created_at desc limit 1`, [projectId]);
    return { c, led: c ? await ledgerBalance(q, c.id) : null, guarantees: c ? await many<any>(q, 'select * from contract_guarantees where contract_id = $1', [c.id]) : [], ms: c ? await many<any>(q, 'select * from contract_milestones where contract_id = $1 order by due_date', [c.id]) : [], am: c ? await many<any>(q, 'select * from contract_amendments where contract_id = $1 order by no', [c.id]) : [] };
  });
  const { c } = d;
  if (!c) return (
    <>
      <PageHeader title="Contract" sub="Create the contract record from the awarded BOQ. One agreed contract and billing model per project." />
      {perms.has('contract:create') ? <Card title="Draft the contract"><ActionForm action={createContractAction.bind(null, projectId)} submit="Save draft contract">
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Contract number" name="number" required><input id="number" name="number" className="input" required /></Field><Field label="Title" name="title" required><input id="title" name="title" className="input" required /></Field>
          <Field label="Mobilisation advance (basis points of value)" name="advance_bp" help="1000 = 10%" required><input id="advance_bp" name="advance_bp" className="input" defaultValue="1000" inputMode="numeric" required /></Field>
          <Field label="Advance recovery per bill (basis points of cumulative gross)" name="advance_recovery_bp" help="1000 = 10%" required><input id="advance_recovery_bp" name="advance_recovery_bp" className="input" defaultValue="1000" inputMode="numeric" required /></Field>
          <Field label="Retention (basis points)" name="retention_bp" help="500 = 5%" required><input id="retention_bp" name="retention_bp" className="input" defaultValue="500" inputMode="numeric" required /></Field>
          <Field label="Security deposit (basis points)" name="security_deposit_bp" required><input id="security_deposit_bp" name="security_deposit_bp" className="input" defaultValue="0" inputMode="numeric" required /></Field>
          <Field label="Payment terms (days)" name="payment_days" required><input id="payment_days" name="payment_days" className="input" defaultValue="30" inputMode="numeric" required /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Start" name="start_date"><input id="start_date" name="start_date" type="date" className="input" /></Field><Field label="End" name="end_date"><input id="end_date" name="end_date" type="date" className="input" /></Field></div>
        </div></ActionForm></Card> : <Alert kind="info">No contract has been recorded yet.</Alert>}
    </>
  );
  return (
    <>
      <PageHeader title={`${c.number} · ${c.title}`} sub={<Badge status={c.status} />} />
      {c.status === 'draft' && perms.has('contract:approve') && <div className="mb-6"><Alert kind="warn" title="Draft contract">Activating snapshots the BOQ, rates and billing rules as the agreed commercial basis. Later changes need an approved amendment or variation.<div className="mt-3"><ConfirmButton action={activateContractAction.bind(null, c.id)} label="Activate contract" confirmText="Activate this contract and snapshot the commercial basis?" className="btn btn-primary" /></div></Alert></div>}
      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        <Stat label="Contract value" value={<Money v={c.value_paise} />} sub={c.status === 'draft' ? 'Calculated on activation' : 'Includes approved amendments & variations'} />
        <Stat label="Advance outstanding" value={<Money v={d.led!.advanceOutstanding} />} sub={<>Paid <Money v={d.led!.advancePaid} /> · recovered <Money v={d.led!.advanceRecovered} /></>} />
        <Stat label="Retention held" value={<Money v={d.led!.retentionHeld} />} sub="Recorded separately from the advance and security deposit" />
      </div>
      <Card title="Billing rules" className="mb-6"><DL items={[['Advance', `${c.advance_bp / 100}% of contract value`], ['Advance recovery', `${c.advance_recovery_bp / 100}% of cumulative gross, capped at advance paid`], ['Retention', `${c.retention_bp / 100}% of cumulative gross`], ['Security deposit', `${c.security_deposit_bp / 100}%`], ['Payment terms', `${c.payment_days} days`], ['Period', `${fmtDate(c.start_date)} – ${fmtDate(c.end_date)}`], ['Approved', c.approved_at ? fmtDate(c.approved_at) : '—']]} /></Card>
      {c.status === 'active' && perms.has('contract:approve') && (
        <div className="grid lg:grid-cols-2 gap-6 mb-6">
          <Card title="Record advance received"><ActionForm action={recordAdvanceAction.bind(null, c.id)} submit="Record advance" resetOnSuccess><Field label="Amount (₹)" name="amount" required help={`Maximum in total: ${c.advance_bp / 100}% of contract value`}><input id="amount" name="amount" inputMode="decimal" className="input" required /></Field></ActionForm></Card>
          <Card title="Release retention"><ActionForm action={releaseRetentionAction.bind(null, c.id)} submit="Release retention" resetOnSuccess><Field label="Amount (₹)" name="amount" required><input id="amount" name="amount" inputMode="decimal" className="input" required /></Field><Field label="Reason / basis for release" name="reason" required><input id="reason" name="reason" className="input" required minLength={3} /></Field></ActionForm></Card>
        </div>
      )}
      <div className="grid lg:grid-cols-2 gap-6">
        <Card title="Milestones" actions={perms.has('contract:create') && <Link className="btn btn-sm" href={`/p/${projectId}/e/milestones/new`}>Add</Link>}><Table head={[{ label: 'Milestone' }, { label: 'Due' }, { label: 'Amount', num: true }, { label: 'Status' }]}>{d.ms.map((m: any) => <tr key={m.id}><Td><Link href={`/p/${projectId}/e/milestones/${m.id}`}>{m.name}</Link></Td><Td>{fmtDate(m.due_date)}</Td><Td num><Money v={m.amount_paise} /></Td><Td><Badge status={m.status} /></Td></tr>)}</Table></Card>
        <Card title="Guarantees" actions={perms.has('contract:create') && <Link className="btn btn-sm" href={`/p/${projectId}/e/guarantees/new`}>Add</Link>}><Table head={[{ label: 'Type' }, { label: 'Expiry' }, { label: 'Amount', num: true }, { label: 'Status' }]}>{d.guarantees.map((g: any) => <tr key={g.id}><Td><Link href={`/p/${projectId}/e/guarantees/${g.id}`}>{g.kind}</Link></Td><Td>{fmtDate(g.expiry)}</Td><Td num><Money v={g.amount_paise} /></Td><Td><Badge status={g.status} /></Td></tr>)}</Table></Card>
        <Card title="Amendments" actions={perms.has('contract:create') && <Link className="btn btn-sm" href={`/p/${projectId}/e/amendments/new`}>Add</Link>}><Table head={[{ label: 'No.' }, { label: 'Change' }, { label: 'Value', num: true }, { label: 'Status' }]}>{d.am.map((a: any) => <tr key={a.id}><Td><Link href={`/p/${projectId}/e/amendments/${a.id}`}>{a.no}</Link></Td><Td>{a.description}</Td><Td num><Money v={a.delta_paise} /></Td><Td><Badge status={a.status} /></Td></tr>)}</Table></Card>
        <Card title="Obligations & registers"><ul className="space-y-2"><li><Link href={`/p/${projectId}/e/obligations`}>Obligations register</Link></li><li><Link href={`/p/${projectId}/e/milestones`}>All milestones</Link></li><li><Link href={`/p/${projectId}/e/guarantees`}>All guarantees</Link></li></ul><p className="help mt-3">This is a register of evidence and approvals. It is not legal advice, claim adjudication or automated contract interpretation.</p></Card>
      </div>
    </>
  );
}
