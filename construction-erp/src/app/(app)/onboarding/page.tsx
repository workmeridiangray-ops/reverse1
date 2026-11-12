import Link from 'next/link';
import { PageHeader, Card } from '@/components/ui';
import ActionForm from '@/components/ActionForm';
import { requireSession } from '@/lib/session';
import { withTenant } from '@/lib/db';
import { onboardingSteps } from '@/lib/onboarding';
import { activateAction } from '@/app/actions/settings';
export default async function Onboarding() { const s = await requireSession(); const steps = await withTenant(s.ctx, q => onboardingSteps(q, s.org.id));
  return (<><PageHeader title="Welcome checklist" sub="Progress is saved automatically as you complete each step." /><Card><ul className="divide-y divide-line">{steps.map(x => <li key={x.key} className="py-3 flex justify-between items-center"><span>{x.done ? '✔' : '○'} <Link href={x.href}>{x.label}</Link></span><span className="text-sm text-muted">{x.done ? 'Done' : 'To do'}</span></li>)}</ul>
    <div className="mt-4"><ActionForm action={activateAction} submit="Mark setup complete"><p className="text-sm text-muted">You can finish the remaining steps later.</p></ActionForm></div></Card></>); }
