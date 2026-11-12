import { PageHeader, Card } from '@/components/ui';
import ActionForm from '@/components/ActionForm';
import { requireSession } from '@/lib/session';
import { withSystem, one } from '@/lib/db';
import { notifPrefsAction } from '@/app/actions/auth';
export default async function Prefs() { const s = await requireSession(); const u = await withSystem(q => one<any>(q, 'select notify_prefs p from users where id=$1', [s.user.id])); const p = u!.p;
  const C = ({ n, l, d }: any) => <label className="flex items-center gap-2 min-h-[44px]"><input type="checkbox" name={n} defaultChecked={p[n]} className="h-5 w-5" /> {l} <span className="text-xs text-muted">{d}</span></label>;
  return (<><PageHeader title="Notification preferences" /><Card><ActionForm action={notifPrefsAction} submit="Save"><C n="email_approvals" l="Email me when something needs my approval" /><C n="email_billing" l="Email me about billing and payments" /><C n="email_digest" l="Daily digest" /><p className="help">In-app notifications are always on.</p></ActionForm></Card></>); }
