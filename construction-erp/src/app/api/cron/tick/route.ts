import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { runCycle } from '@/lib/worker';
import { safeEqual } from '@/lib/crypto';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
/** Called by the worker loop or a platform cron. Protected by CRON_SECRET. */
export async function POST(req: Request) {
  const secret = env.cronSecret; const got = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '');
  if (!secret || !safeEqual(got, secret)) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  return NextResponse.json(await runCycle());
}
