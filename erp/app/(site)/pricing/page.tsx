import type { Metadata } from "next";
import Link from "next/link";
import { withSystem } from "@/lib/db";
import { currentPlans } from "@/lib/billing";
import { formatMoney } from "@/lib/money";
export const metadata: Metadata = { title: "Pricing" };
export const dynamic = "force-dynamic";
export default async function Pricing() {
  const plans = await withSystem((db) => currentPlans(db));
  return (
    <div className="wrap section">
      <h1>Pricing</h1><p className="muted">All plans include a 14-day free trial. Prices in INR, exclusive of GST (18%). Yearly billing is shown per year.</p>
      <div className="grid g3">
        {plans.map((p: any, i: number) => (
          <div key={p.id} className={`card plan ${i === 1 ? "featured" : ""}`}>
            <h2>{p.name}</h2>
            <div className="price">{formatMoney(p.price_monthly_paise).replace(".00", "")}<span className="small muted"> / month</span></div>
            <p className="small muted">or {formatMoney(p.price_yearly_paise).replace(".00", "")} / year</p>
            <ul><li>{p.max_users} users</li><li>{p.max_branches} branch{p.max_branches > 1 ? "es" : ""}</li><li>{Math.round(p.max_storage_mb / 1024)} GB document storage</li>{p.features.map((f: string) => <li key={f}>{f}</li>)}</ul>
            <Link className={`btn ${i === 1 ? "primary" : ""}`} href={`/signup?plan=${p.key}`}>Start free trial</Link>
          </div>))}
      </div>
      <h2 style={{ marginTop: 32 }}>Comparison</h2>
      <div className="card flush tablewrap"><table><thead><tr><th>Capability</th>{plans.map((p: any) => <th key={p.id}>{p.name}</th>)}</tr></thead><tbody>
        <tr><td>Users</td>{plans.map((p: any) => <td key={p.id}>{p.max_users}</td>)}</tr>
        <tr><td>Branches</td>{plans.map((p: any) => <td key={p.id}>{p.max_branches}</td>)}</tr>
        <tr><td>Storage</td>{plans.map((p: any) => <td key={p.id}>{Math.round(p.max_storage_mb / 1024)} GB</td>)}</tr>
        <tr><td>Core ERP modules</td>{plans.map((p: any) => <td key={p.id}>Included</td>)}</tr>
        <tr><td>Manufacturing / payroll / e-invoicing</td>{plans.map((p: any) => <td key={p.id}>Extension</td>)}</tr>
      </tbody></table></div>
      <p className="small muted" style={{ marginTop: 16 }}>Downgrades take effect at the end of the billing period and are blocked until users and branches fit the smaller plan. Upgrades are charged pro rata for the rest of the period.</p>
    </div>
  );
}
