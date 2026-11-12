import Link from "next/link";
export const metadata = { title: "Help" };
const FAQ: [string, string][] = [
  ["How do I start?", "Create a company from the sign-up page. The welcome checklist walks you through business details, branches, masters, team invitations and a plan."],
  ["Can one login belong to several companies?", "Yes. After signing in you choose a company and can switch from the top bar. Data never mixes between companies."],
  ["What happens when my trial ends?", "Your data stays. The workspace becomes read-only until you choose a plan; exports remain available."],
  ["What if a payment fails?", "You keep full access for a 7-day grace period and can retry under Settings → Billing. After that the workspace becomes read-only."],
  ["How do I reverse a wrong posting?", "Posted documents are never edited. Use Reverse (with a reason) on the journal, receipt or credit note; the original and the reversal both stay on record."],
  ["How do I get my data out?", "Settings → Data lets owners export every master and transaction as CSV and request company closure."],
  ["I lost my authenticator device.", "Use one of your recovery codes on the two-factor screen, then set up the app again under Profile → Security."],
];
export default function Help() {
  return (<div className="wrap section narrow"><h1>Help</h1>{FAQ.map(([q, a]) => <details className="drawer" key={q}><summary>{q}</summary><div><p>{a}</p></div></details>)}
    <p>Still stuck? <Link href="/contact">Contact support</Link>.</p></div>);
}
