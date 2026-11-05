import Link from "next/link";
import { Card } from "@/components/ui/Layout";
export const metadata = { title: "Help" };
const Q: Array<[string, string]> = [
  ["How do I invite my team or a client?", "Open Team → Invite. Choose a role and, for client or consultant roles, the projects they may see. The invitation link expires after 7 days and can be revoked."],
  ["Why can't I bill more than the BOQ quantity?", "Cumulative certified quantity cannot exceed contract quantity. Raise a variation, get it approved, and the extra quantity becomes billable at the original rate."],
  ["What is the difference between claimed, certified and invoiced?", "Claimed is what the contractor submits from verified measurements. Certified is what the client or consultant accepts. Invoiced is the net payable after retention and recoveries. Collected is what has been received."],
  ["I forgot my password.", "Use the reset link on the sign-in page. The link is valid for one hour and signs out all other devices when used."],
  ["How do I export my data?", "Owners can export BOQ and bills as CSV from each project, and request a closure export under Settings."],
];
export default function Help() {
  return (
    <div className="mx-auto max-w-page px-4 pt-14">
      <h1 className="text-display font-bold">Help centre</h1>
      <div className="mt-8 space-y-4">{Q.map(([q, a]) => <Card key={q} title={q}><p className="text-ink-700">{a}</p></Card>)}</div>
      <p className="mt-8">Still stuck? <Link href="/contact">Contact support</Link>.</p>
    </div>
  );
}
