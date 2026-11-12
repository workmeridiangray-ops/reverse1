import 'server-only';
import { redirect } from 'next/navigation';
import { getSession } from './session';
import type { Ctx } from './db';
export type PRole = 'owner' | 'billing' | 'support' | 'techops';
/** Platform areas and who may use them. Support cannot see billing; billing cannot see operations. */
export const AREAS: Record<string, PRole[]> = { businesses: ['owner', 'billing', 'support', 'techops'], billing: ['owner', 'billing'], ops: ['owner', 'techops', 'support'], staff: ['owner'] };
export async function requirePlatform(area: keyof typeof AREAS) {
  const s = await getSession();
  if (!s) redirect('/login?expired=1');
  if (!s.user.platformRole) redirect('/denied');
  if (!s.user.totpEnabled) redirect('/account/security?need2fa=1');
  if (!AREAS[area].includes(s.user.platformRole as PRole)) redirect('/denied');
  const ctx: Ctx = { userId: s.user.id, orgId: null, role: 'platform' };
  return { s, ctx, role: s.user.platformRole as PRole };
}
