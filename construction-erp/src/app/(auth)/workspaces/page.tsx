import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { switchWorkspaceAction, logoutAction } from '@/app/actions/auth';
export const metadata = { title: 'Choose workspace · Buildline' };
export default async function Workspaces() {
  const s = await getSession(); if (!s) redirect('/login');
  return (<><h1>Choose a workspace</h1><p className="text-muted mt-1 mb-4">You belong to {s.memberships.length} workspace{s.memberships.length === 1 ? '' : 's'}.</p>
    <ul className="space-y-2">{s.memberships.map(m => <li key={m.orgId}><form action={switchWorkspaceAction}><input type="hidden" name="org" value={m.orgId} /><button className="btn w-full justify-between"><span>{m.orgName}</span><span className="text-muted text-xs">{m.role}</span></button></form></li>)}</ul>
    {s.memberships.length === 0 && <p className="text-sm">You aren't a member of any workspace yet. Ask for an invitation, or <Link href="/signup">create your own</Link>.</p>}
    {s.user.platformRole && <p className="mt-4"><Link href="/platform">Platform administration</Link></p>}
    <form action={logoutAction} className="mt-6"><button className="text-sm underline text-muted">Sign out</button></form></>);
}
