import { notFound } from 'next/navigation';
import { PageHeader, Card, DL, Badge, Field, Alert, fmtDate } from '@/components/ui';
import ActionForm from '@/components/ActionForm';
import { requireSession } from '@/lib/session';
import { withTenant, one } from '@/lib/db';
import { portalRfi } from '@/app/actions/portal';
export default async function PortalRfi({ params }: { params: Promise<{ pid: string; id: string }> }) { const { pid, id } = await params; const s = await requireSession();
  const r = await withTenant(s.ctx, async q => /^[0-9a-f-]{36}$/.test(id) ? one<any>(q, `select r.*, (select d.number || ' rev ' || x.rev from drawing_revisions x join drawings d on d.id = x.drawing_id where x.id = r.drawing_revision_id) drawing from rfis r where r.id=$1 and r.project_id=$2`, [id, pid]) : null);
  if (!r) notFound();
  return (<><PageHeader title={`${r.number} · ${r.location}`} sub={<Badge status={r.status} />} crumbs={[{ href: `/portal/${pid}`, label: 'Project' }, { label: r.number }]} />
    <Card className="mb-6"><DL items={[['Drawing', r.drawing], ['Location', r.location], ['Question', r.question], ['Decision required', r.decision_required], ['Response due', fmtDate(r.due_date)], ['Response', r.response]]} /></Card>
    {r.status === 'open' ? <Card title="Your response"><ActionForm action={portalRfi.bind(null, id)} submit="Send response"><Field label="Response" name="answer"><textarea id="answer" name="answer" rows={4} className="input" required minLength={3} /></Field></ActionForm></Card> : <Alert kind="info">This RFI has been answered.</Alert>}</>); }
