import { Page, Note } from "@/components/ui";
import Link from "next/link";
import { currentPlanVersions } from "@/lib/server/billing";
import { formatINR } from "@/lib/domain/money";
export const metadata = { title: "Pricing" };
export const dynamic = "force-dynamic";
export default async function P() {
  const plans = await currentPlanVersions();
  return <div className="mx-auto max-w-6xl"><Page title="Pricing" sub="Monthly or yearly (yearly = 10 months). Prices in INR, excluding GST. 14-day free trial, no card needed.">
    <div className="grid gap-4 md:grid-cols-3">{plans.map((p: any, i: number) => (
      <div key={p.code} className={`card p-6 ${i === 1 ? "border-brand ring-1 ring-brand" : ""}`}>
        <h2 className="text-lg font-semibold">{p.name}</h2>
        <p className="mt-3 text-3xl font-semibold">{formatINR(p.price_monthly_paise)}<span className="text-sm font-normal text-muted"> /month</span></p>
        <p className="text-sm text-muted">or {formatINR(p.price_yearly_paise)} /year</p>
        <ul className="mt-4 space-y-1.5 text-sm"><li>Up to <b>{p.max_users}</b> users</li><li><b>{p.max_plants}</b> plant{p.max_plants > 1 ? "s" : ""}</li><li>Up to <b>{Number(p.max_items).toLocaleString("en-IN")}</b> items</li><li>All modules, portals and exports</li></ul>
        <Link href="/signup" className={`mt-5 w-full ${i === 1 ? "btn-primary" : "btn-secondary"}`}>Start free trial</Link>
      </div>))}</div>
    <h2 className="mt-10 text-lg font-semibold">Compare</h2>
    <div className="card mt-3 overflow-x-auto"><table className="w-full min-w-[480px] text-sm"><thead className="border-b border-line bg-canvas"><tr><th className="th">Feature</th>{plans.map((p: any) => <th key={p.code} className="th">{p.name}</th>)}</tr></thead><tbody className="divide-y divide-line">
      {[["Users", "max_users"], ["Plants", "max_plants"], ["Items", "max_items"]].map(([l, k]) => <tr key={k}><td className="td">{l}</td>{plans.map((p: any) => <td key={p.code} className="td">{Number(p[k!]).toLocaleString("en-IN")}</td>)}</tr>)}
      {["MRP & planning", "Traceability & recall", "Customer / supplier portals", "CSV import & export"].map((f) => <tr key={f}><td className="td">{f}</td>{plans.map((p: any) => <td key={p.code} className="td">✓</td>)}</tr>)}</tbody></table></div>
    <div className="mt-6"><Note>Need assisted setup, training, or enterprise single sign-on? See <Link className="underline" href="/addons">add-ons</Link> or <Link className="underline" href="/contact">contact us</Link>.</Note></div>
  </Page></div>;
}
