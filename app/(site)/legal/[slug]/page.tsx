import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/Layout";
import { PRODUCT_NAME } from "@/lib/brand";

const PAGES: Record<string, { title: string; body: string[] }> = {
  terms: { title: "Terms of service", body: ["These terms govern use of the service by a business and its users.", "Subscription, trial, renewal, suspension and cancellation follow the plan shown at sign-up. Fees are in INR and exclusive of taxes.", "Customers own their project data and may export it at any time while the account is active and for a closure period."] },
  privacy: { title: "Privacy policy", body: ["We process account details, project records and uploaded files to provide the service.", "Each business's data is isolated from every other business. Platform staff cannot read customer documents without time-limited, audited approval.", "Contact us to access, correct or delete personal data."] },
  security: { title: "Security", body: ["Passwords are salted and hashed. Sessions can be revoked. Access is enforced on the server and in the database per business, project and role.", "Uploads are type-checked by content, size-limited and stored privately.", "Audit trails record sensitive changes and are append-only."] },
};
export function generateStaticParams() { return Object.keys(PAGES).map((slug) => ({ slug })); }
export default async function Legal({ params }: { params: Promise<{ slug: string }> }) {
  const p = PAGES[(await params).slug];
  if (!p) notFound();
  return (
    <div className="mx-auto max-w-prose px-4 pt-14">
      <h1 className="text-display font-bold">{p.title}</h1>
      <div className="mt-4"><Alert tone="warn" title="Draft text — not yet approved by counsel">{PRODUCT_NAME} must replace this summary with legally approved wording before launch.</Alert></div>
      <div className="mt-6 space-y-4 text-ink-700">{p.body.map((t) => <p key={t}>{t}</p>)}</div>
    </div>
  );
}
