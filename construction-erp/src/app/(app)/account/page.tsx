import { PageHeader, Card, Field } from '@/components/ui';
import ActionForm from '@/components/ActionForm';
import { requireSession } from '@/lib/session';
import { profileAction } from '@/app/actions/auth';
export default async function Account() { const s = await requireSession(); return (<><PageHeader title="Profile" /><Card><ActionForm action={profileAction} submit="Save"><Field label="Name" name="name"><input id="name" name="name" className="input" defaultValue={s.user.name} required /></Field><Field label="Email" name="email" help="Email changes go through support so your account stays secure."><input id="email" className="input" value={s.user.email} readOnly /></Field></ActionForm></Card></>); }
