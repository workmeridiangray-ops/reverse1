'use server';
import type { FormState } from '@/components/ActionForm';
import { withSystem, one } from '@/lib/db';
import { str, opt, guard } from '@/lib/form';
import { checkEmail } from '@/lib/identity';
import { headers } from 'next/headers';
export async function leadAction(kind: 'demo' | 'contact', _: FormState, fd: FormData): Promise<FormState> {
  return guard(async () => {
    if (str(fd, 'website')) return { ok: true, message: 'Thanks!' };               // honeypot
    const email = str(fd, 'email'); try { checkEmail(email); } catch { return { error: 'Enter a valid email address.' }; }
    if (str(fd, 'name').length < 2 || str(fd, 'message').length < 5 && kind === 'contact') return { error: 'Please fill in your name and message.' };
    const ip = ((await headers()).get('x-forwarded-for') ?? '').split(',')[0].trim() || null;
    await withSystem(async q => {
      const n = await one<any>(q, `select count(*) n from login_attempts where ip = $1 and email like 'lead:%' and at > now() - interval '1 hour'`, [ip]);
      if (Number(n!.n) >= 8) throw Object.assign(new Error('Too many submissions. Please try again later.'), { name: 'RuleError' });
      await q.query(`insert into login_attempts(email, ip, ok) values ($1,$2,true)`, ['lead:' + email, ip]);
      await q.query('insert into leads(kind, name, email, company, phone, message) values ($1,$2,$3,$4,$5,$6)', [kind, str(fd, 'name'), email.toLowerCase(), opt(fd, 'company'), opt(fd, 'phone'), opt(fd, 'message')]);
      if (kind === 'contact') await q.query(`insert into support_tickets(subject, body, priority) values ($1,$2,'normal')`, [`Contact: ${str(fd, 'name')} <${email}>`, str(fd, 'message')]);
    });
    return { ok: true, message: kind === 'demo' ? 'Thanks — we will contact you within one business day to schedule your demo.' : 'Message received. We will reply by email.' };
  });
}
