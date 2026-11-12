import ActionForm from '@/components/ActionForm';
import { Field } from '@/components/ui';
import { leadAction } from '@/app/actions/site';
export const metadata = { title: 'Contact · Buildline' };
export default function Contact() { return (<div className="max-w-lg"><h1>Contact us</h1><p className="text-muted mt-2 mb-5">Questions, support or sales — we reply by email.</p><ActionForm action={leadAction.bind(null, 'contact')} submit="Send message" resetOnSuccess>
  <div className="hidden" aria-hidden><input name="website" tabIndex={-1} autoComplete="off" /></div>
  <Field label="Your name" name="name" required><input id="name" name="name" className="input" required /></Field><Field label="Email" name="email" required><input id="email" name="email" type="email" className="input" required /></Field><Field label="Message" name="message" required><textarea id="message" name="message" rows={5} className="input" required /></Field></ActionForm></div>); }
