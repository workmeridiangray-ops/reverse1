import { redirect } from 'next/navigation';
import Shell from '@/components/Shell';
import { requireSession, permSet } from '@/lib/session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  if (s.org.status === 'suspended' && s.ctx.role !== 'support') redirect('/suspended');
  if (['client', 'consultant', 'contractor'].includes(s.ctx.role)) redirect('/portal');
  return <Shell s={s} perms={await permSet(s)}>{children}</Shell>;
}
