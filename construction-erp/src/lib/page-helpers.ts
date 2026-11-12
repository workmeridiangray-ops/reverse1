import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { ENTITIES, type E } from './entities';
import { requireSession, permSet } from './session';
import { withTenant, one, many, type Q } from './db';
import { refOptions } from './engine';

export async function entityPage(entity: string, projectId: string | null) {
  const e = ENTITIES[entity]; if (!e) notFound();
  if (e.scoped !== (projectId !== null)) notFound();
  const s = await requireSession(); const perms = await permSet(s);
  if (!perms.has(`${e.module}:view`)) redirect('/denied');
  return { e, s, perms };
}
export async function optionsFor(q: Q, e: E, projectId: string | null) {
  const out: Record<string, { id: string; label: string }[]> = {};
  for (const f of e.fields.filter(f => f.t === 'ref' && !f.hideForm && !f.ro)) out[f.n] = await refOptions(q, f, projectId);
  return out;
}
export async function projectOrNotFound(q: Q, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const p = await one<any>(q, 'select * from projects where id = $1', [id]);
  if (!p) notFound();      // other tenants' projects look identical to missing ones
  return p;
}
