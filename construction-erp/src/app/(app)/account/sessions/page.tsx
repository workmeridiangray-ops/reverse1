import { PageHeader, Card, Table, Td, fmtDateTime } from '@/components/ui';
import ActionForm, { ConfirmButton } from '@/components/ActionForm';
import { requireSession } from '@/lib/session';
import { withSystem } from '@/lib/db';
import { listSessions } from '@/lib/identity';
import { revokeSessionAction, revokeOthersAction } from '@/app/actions/auth';
export default async function Sessions() { const s = await requireSession(); const rows = await withSystem(q => listSessions(q, s.user.id));
  return (<><PageHeader title="Active sessions" sub="Devices currently signed in to your account." actions={<ConfirmButton action={revokeOthersAction} label="Sign out all other devices" confirmText="Sign out every other device?" className="btn" />} />
    <Table head={[{ label: 'Device' }, { label: 'Last active' }, { label: '' }]}>{rows.map((r: any) => <tr key={r.id}><Td>{(r.user_agent ?? 'Unknown').slice(0, 60)}{r.id === s.sessionId && <strong> (this device)</strong>}<div className="text-xs text-muted">{r.ip}</div></Td><Td>{fmtDateTime(r.last_seen_at)}</Td><Td><ConfirmButton action={revokeSessionAction} label="Sign out" confirmText="Sign this session out?" hidden={{ sid: r.id }} /></Td></tr>)}</Table></>); }
