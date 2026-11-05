import { LeadForm } from "../LeadForm";
export const metadata = { title: "Request a demo" };
export default function Page() {
  return (
    <div className="mx-auto max-w-page px-4 pt-14">
      <h1 className="text-display font-bold">Request a demo</h1>
      <p className="mb-8 mt-2 max-w-prose text-lg text-ink-700">Tell us about your projects and we will reply by email. We never share your details.</p>
      <LeadForm kind="demo" />
    </div>
  );
}
