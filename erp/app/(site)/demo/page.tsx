import { ActionForm, Field } from "@/components/ActionForm";
import { demoAction } from "@/lib/site/actions";
export const metadata = { title: "Request a demo" };
export default function Demo() {
  return (<div className="wrap section narrow"><h1>Request a demo</h1><p className="muted">Tell us about your business and what you want to see. A person replies within one business day.</p>
    <div className="card"><ActionForm action={demoAction} submit="Request demo" resetOnSuccess>
      <div className="grid g2"><Field name="name" label="Your name" required /><Field name="email" label="Work email" type="email" required /></div>
      <div className="grid g2"><Field name="company" label="Company" /><Field name="phone" label="Phone (optional)" type="tel" /></div>
      <Field name="message" label="What would you like to see?" type="textarea" required placeholder="e.g. multi-branch stock transfers and credit control" />
      <div style={{ position: "absolute", left: -9999 }} aria-hidden><input name="website" tabIndex={-1} autoComplete="off" /></div>
    </ActionForm></div></div>);
}
