import Link from 'next/link';
import { Badge } from '@/components/ui';
import { requireSession, permSet } from '@/lib/session';
import { withTenant } from '@/lib/db';
import { projectOrNotFound } from '@/lib/page-helpers';

const TABS: { href: string; label: string; perm: string }[] = [
  { href: '', label: 'Overview', perm: 'project:view' }, { href: '/boq', label: 'BOQ & budget', perm: 'boq:view' }, { href: '/contract', label: 'Contract', perm: 'contract:view' },
  { href: '/schedule', label: 'Schedule', perm: 'planning:view' }, { href: '/drawings', label: 'Drawings & RFIs', perm: 'drawings:view' }, { href: '/procurement', label: 'Procurement', perm: 'procurement:view' },
  { href: '/stores', label: 'Stores', perm: 'stores:view' }, { href: '/reports', label: 'Site reports', perm: 'site:view' }, { href: '/subcontract', label: 'Subcontract', perm: 'subcontract:view' },
  { href: '/quality', label: 'Quality & safety', perm: 'quality:view' }, { href: '/billing', label: 'Client billing', perm: 'billing:view' }, { href: '/variations', label: 'Variations', perm: 'variations:view' },
  { href: '/handover', label: 'Handover & closure', perm: 'handover:view' }, { href: '/team', label: 'Team & authority', perm: 'project:view' },
];
export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const s = await requireSession(); const perms = await permSet(s);
  const p = await withTenant(s.ctx, q => projectOrNotFound(q, projectId));
  return (
    <>
      <div className="mb-4">
        <p className="text-sm text-muted"><Link href="/dashboard" className="text-muted">Dashboard</Link> / Project</p>
        <div className="flex flex-wrap items-center gap-3"><h1>{p.code} · {p.name}</h1><Badge status={p.status} /></div>
        {p.status === 'closed' && <p className="text-sm text-warn mt-1">This project is closed and read-only. You can still view records and download the export package.</p>}
      </div>
      <nav aria-label="Project sections" className="flex gap-1 overflow-x-auto border-b border-line mb-6 -mx-1 px-1">
        {TABS.filter(t => perms.has(t.perm)).map(t => <Link key={t.href} href={`/p/${projectId}${t.href}`} className="px-3 min-h-[44px] flex items-center whitespace-nowrap text-ink no-underline hover:bg-accent-soft rounded-t">{t.label}</Link>)}
      </nav>
      {children}
    </>
  );
}
