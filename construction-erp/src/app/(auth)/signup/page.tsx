import Link from 'next/link';
import ActionForm from '@/components/ActionForm';
import { Field } from '@/components/ui';
import { signupAction } from '@/app/actions/auth';
export const metadata = { title: 'Start your free trial · Buildline' };
export default function Signup() {
  return (
    <>
      <h1>Start your 14-day trial</h1>
      <p className="text-muted mt-1 mb-5">No card needed. Your company workspace is created for you.</p>
      <ActionForm action={signupAction} submit="Create workspace">
        <Field label="Your name" name="name" required><input id="name" name="name" className="input" autoComplete="name" required /></Field>
        <Field label="Work email" name="email" required><input id="email" name="email" type="email" className="input" autoComplete="email" required /></Field>
        <Field label="Company name" name="company" required><input id="company" name="company" className="input" autoComplete="organization" required /></Field>
        <Field label="Password" name="password" help="At least 10 characters, with letters and a number." required><input id="password" name="password" type="password" className="input" autoComplete="new-password" minLength={10} required /></Field>
        <label className="flex gap-2 items-start text-sm"><input type="checkbox" name="terms" className="mt-1 h-4 w-4" required /> <span>I agree to the <Link href="/legal/terms">Terms</Link> and <Link href="/legal/privacy">Privacy Policy</Link>.</span></label>
      </ActionForm>
      <p className="text-sm mt-5">Already have an account? <Link href="/login">Sign in</Link></p>
    </>
  );
}
