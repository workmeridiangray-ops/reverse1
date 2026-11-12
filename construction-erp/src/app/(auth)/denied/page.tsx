import Link from 'next/link';
export const metadata = { title: 'Access denied · Buildline' };
export default function Denied() { return (<><h1>You don't have access to this</h1><p className="text-muted mt-2">Your role doesn't include this area. If you think that's a mistake, ask a workspace owner to adjust your access.</p><p className="mt-5 flex gap-3"><Link className="btn btn-primary" href="/dashboard">Back to dashboard</Link><Link className="btn" href="/workspaces">Switch workspace</Link></p></>); }
