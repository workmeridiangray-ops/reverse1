import Link from 'next/link';
import { withSystem } from '@/lib/db';
import { verifyEmail } from '@/lib/identity';
import { Alert } from '@/components/ui';
export const metadata = { title: 'Verify email · Buildline' };
export default async function Verify({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const r = token ? await withSystem(q => verifyEmail(q, token)) : 'invalid';
  return (
    <>
      <h1>{r === 'ok' ? 'Email confirmed' : 'We could not confirm your email'}</h1>
      <div className="mt-4 space-y-4">
        {r === 'ok' && <><Alert kind="ok">Your email is verified. You can sign in now.</Alert><Link className="btn btn-primary" href="/login">Sign in</Link></>}
        {r === 'expired' && <><Alert kind="warn">This link has expired.</Alert><Link className="btn" href="/verify/sent">Send me a new link</Link></>}
        {r === 'invalid' && <><Alert kind="bad">This link is not valid or was already used. If you have already verified, just sign in.</Alert><div className="flex gap-2"><Link className="btn btn-primary" href="/login">Sign in</Link><Link className="btn" href="/verify/sent">Send a new link</Link></div></>}
      </div>
    </>
  );
}
