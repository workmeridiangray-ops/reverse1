import type { Metadata } from "next";
import Link from "next/link";
export const metadata: Metadata = { title: "Add-ons and services" };
export default function AddOns() {
  const items: [string, string][] = [["Assisted setup", "We configure branches, masters, opening balances and approvals with you."], ["Training sessions", "Role-based sessions for sales, warehouse and finance teams, repeatable on request."], ["Operational support", "Defined channels, hours and response targets agreed per customer."], ["Data migration", "Mapping and loading of customers, suppliers, items and opening balances from CSV."], ["Enterprise SSO and extra languages", "Available on request; selected explicitly per contract."]];
  return (
    <div className="wrap section"><h1>Add-ons and services</h1><p className="muted narrow">Services are quoted separately; the software subscription never depends on them.</p>
      <div className="grid g2">{items.map(([t, d]) => <div className="card" key={t}><h3>{t}</h3><p className="muted">{d}</p></div>)}</div>
      <p style={{ marginTop: 24 }}><Link className="btn primary" href="/contact">Ask for a quote</Link></p></div>
  );
}
