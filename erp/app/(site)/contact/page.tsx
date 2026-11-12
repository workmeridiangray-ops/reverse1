import { ActionForm, Field } from "@/components/ActionForm";
import { contactFormAction } from "@/lib/site/actions";
export const metadata = { title: "Contact" };
export default function Contact() {
  return (<div className="wrap section narrow"><h1>Contact us</h1><p className="muted">Sales, support or a question about an extension.</p>
    <div className="card"><ActionForm action={contactFormAction} submit="Send message" resetOnSuccess>
      <div className="grid g2"><Field name="name" label="Your name" required /><Field name="email" label="Email" type="email" required /></div>
      <Field name="company" label="Company" /><Field name="message" label="Message" type="textarea" required />
      <div style={{ position: "absolute", left: -9999 }} aria-hidden><input name="website" tabIndex={-1} autoComplete="off" /></div>
    </ActionForm></div></div>);
}
