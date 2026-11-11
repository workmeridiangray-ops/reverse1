import { notFound } from "next/navigation";
import { Page, Note } from "@/components/ui";
const docs: Record<string, [string, string[]]> = {
  terms: ["Terms of service", ["Forgeline is provided as a subscription service to businesses. You are responsible for the accuracy of data you enter and for the actions of users you invite.", "We may suspend accounts for non-payment after the grace period or for misuse. Data export remains available for 30 days after cancellation.", "Prices are in INR and exclude applicable taxes. Plan changes and proration are described at checkout."]],
  privacy: ["Privacy policy", ["We process account details (name, email), the business data you enter, and technical logs (IP, user agent) needed to secure the service.", "Each company’s data is isolated from other companies. Platform support staff can access your data only through a time-limited, audited access grant that you approve.", "You can export your data and request closure from Settings."]],
  refunds: ["Refund policy", ["Subscription charges are non-refundable except where required by law or approved by us in writing. Refunds, when approved, are returned to the original payment method."]],
  security: ["Security overview", ["Passwords are stored with scrypt; sessions are server-side and revocable; two-factor authentication is available; all access to company data is checked on the server and enforced again by the database.", "Uploads are type- and size-checked and stored privately; downloads are authorised per request."]],
};
export default async function P({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params; const d = docs[doc]; if (!d) notFound();
  return <div className="mx-auto max-w-3xl"><Page title={d[0]}><Note tone="warn">Draft text supplied with the software. Your legal counsel must review and approve this page before launch.</Note><div className="space-y-3 text-sm">{d[1].map((p) => <p key={p}>{p}</p>)}</div></Page></div>;
}
