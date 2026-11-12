import ActionForm from '@/components/ActionForm';
import { Field } from '@/components/ui';
import { leadAction } from '@/app/actions/site';
export const metadata = { title: 'Book a demo · Buildline' };
export default function Demo() { return (<div className="max-w-lg"><h1>Book a demo</h1><p className="text-muted mt-2 mb-5">Tell us about your projects and we’ll walk you through the workflow that matters to you.</p><ActionForm action={leadAction.bind(null, 'demo')} submit="Request demo" resetOnSuccess>
  <div className="hidden" aria-hidden><input name="website" tabIndex={-1} autoComplete="off" /></div>
  <Field label="Your name" name="name" required><input id="name" name="name" className="input" required /></Field><Field label="Work email" name="email" required><input id="email" name="email" type="email" className="input" required /></Field><Field label="Company" name="company"><input id="company" name="company" className="input" /></Field><Field label="Phone" name="phone"><input id="phone" name="phone" className="input" /></Field><Field label="What would you like to see?" name="message"><textarea id="message" name="message" rows={3} className="input" /></Field></ActionForm></div>); }
