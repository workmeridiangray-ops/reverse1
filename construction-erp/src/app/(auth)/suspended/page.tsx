import Link from 'next/link';
export const metadata = { title: 'Workspace suspended · Buildline' };
export default function Suspended() { return (<><h1>This workspace is suspended</h1><p className="text-muted mt-2">Access has been paused, often because of a billing or policy issue. Your data is safe. Contact support to restore access.</p><p className="mt-5 flex gap-3"><Link className="btn btn-primary" href="/contact">Contact support</Link><Link className="btn" href="/workspaces">Switch workspace</Link></p></>); }
