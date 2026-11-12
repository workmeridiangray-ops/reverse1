import { notFound } from "next/navigation";
import { Alert } from "@/components/ui";
const DOCS: Record<string, [string, string[]]> = {
  terms: ["Terms of service", ["The service is provided to businesses under a subscription. Each company is responsible for the accuracy of the records it enters and for configuring tax and accounting rules with its own accountant.", "Subscriptions renew until cancelled. Cancelling keeps access until the end of the paid period.", "We may suspend accounts for non-payment (after the grace period) or misuse."]],
  privacy: ["Privacy policy", ["We process account details and the business records you enter in order to provide the service. Each company’s data is isolated from other companies.", "Support staff can only view a company’s records after the company approves a time-limited access request; all such access is logged.", "Company data can be exported at any time and is deleted after closure according to the retention period stated in your contract."]],
  refunds: ["Refund policy", ["Subscription fees are charged in advance. Refunds, where agreed, are issued to the original payment method and appear in your billing history."]],
  security: ["Security overview", ["Passwords are hashed with scrypt. Optional two-factor authentication is available to all users and mandatory for platform staff.", "All access is checked on the server; company data is separated by database row-level security.", "Uploads are limited by type and size. Sensitive actions are recorded in an append-only audit log."]],
};
export default async function Legal({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params; const d = DOCS[slug]; if (!d) notFound();
  return (<div className="wrap section narrow"><h1>{d[0]}</h1>
    <Alert tone="warn">Draft for legal review: this text is a plain-language summary and must be replaced by counsel-approved wording before commercial launch.</Alert>
    {d[1].map((p, i) => <p key={i}>{p}</p>)}</div>);
}
