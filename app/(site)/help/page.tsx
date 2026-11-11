import { Page } from "@/components/ui";
import Link from "next/link";
export const metadata = { title: "Help" };
const faq: [string, string][] = [
  ["How do I start?", "Sign up, verify your email and follow the welcome checklist: company details, plants and locations, items, BOMs and routings. You can load demo data into a trial workspace to explore first."],
  ["Why can’t I issue stock?", "The batch is probably in quarantine (awaiting inspection) or the location has insufficient balance. The error message names which."],
  ["How do I fix a wrong stock posting?", "Stock postings are never edited. A user with adjustment authority posts a reversal with a reason; both rows stay in the ledger."],
  ["Why did MRP suggest an order I didn’t expect?", "Open the planning run: every suggestion lists the demand lines, stock and lot-size rule behind it."],
  ["I forgot my password", "Use ‘Forgot password’ on the sign-in page. Reset links last one hour and sign out all devices."],
  ["I was invited but the link says expired or revoked", "Ask your company owner to send a new invitation; a new one cancels the old link."],
  ["What happens if a payment fails?", "You keep access for a 7-day grace period and can retry from Settings → Billing."],
];
export default function P() { return <div className="mx-auto max-w-3xl"><Page title="Help centre" sub="Answers to common questions.">
  <div className="space-y-3">{faq.map(([q, a]) => <details key={q} className="card p-4"><summary className="cursor-pointer font-medium">{q}</summary><p className="mt-2 text-sm text-muted">{a}</p></details>)}</div>
  <p className="mt-6 text-sm text-muted">Still stuck? <Link className="text-brand underline" href="/contact">Contact support</Link>. Signed-in users can raise a ticket under Help in the app.</p></Page></div>; }
