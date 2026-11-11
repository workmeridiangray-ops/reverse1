import { Page } from "@/components/ui";
import Link from "next/link";
export const metadata = { title: "Add-ons" };
const a: [string, string][] = [["Assisted setup & migration", "We load your items, BOMs and opening stock from agreed CSV formats and reconcile them with you."], ["Training", "Role-based sessions for planners, stores, shop-floor and quality."], ["Enterprise SSO", "SAML / custom identity provider — scoped per customer."], ["Integrations", "Accounting export formats, PLC/IoT, handheld apps: scoped individually."]];
export default function P() { return <div className="mx-auto max-w-6xl"><Page title="Add-ons & services" sub="Sold separately; none is required to use the product.">
  <div className="grid gap-4 sm:grid-cols-2">{a.map(([t, d]) => <div key={t} className="card p-5"><h2 className="font-semibold">{t}</h2><p className="mt-2 text-sm text-muted">{d}</p></div>)}</div>
  <p className="mt-6"><Link href="/contact" className="btn-primary">Ask about an add-on</Link></p></Page></div>; }
