import Link from 'next/link';
import { withSystem } from '@/lib/db';
import { currentPlans } from '@/lib/domain/saas';
import { formatINR } from '@/lib/rules/money';
export const metadata = { title: 'Pricing · Buildline' };
export const dynamic = 'force-dynamic';
export default async function Pricing() { const plans = await withSystem(q => currentPlans(q));
  return (<><h1>Simple plans in rupees</h1><p className="text-muted mt-2">Monthly or yearly. All prices exclude 18% GST. 14-day free trial, no card.</p>
    <div className="grid md:grid-cols-3 gap-5 mt-6">{plans.map((p: any) => <div key={p.id} className="card p-5"><h2>{p.name}</h2><p className="text-2xl font-semibold mt-2">{formatINR(p.price_month_paise)}<span className="text-sm text-muted"> /month</span></p><p className="text-sm text-muted">or {formatINR(p.price_year_paise)} /year</p>
      <table className="text-sm mt-4 w-full"><caption className="sr-only">{p.name} limits</caption><tbody><tr><th scope="row" className="text-left font-normal">Team members</th><td className="num">{p.limits.users}</td></tr><tr><th scope="row" className="text-left font-normal">Active projects</th><td className="num">{p.limits.projects}</td></tr><tr><th scope="row" className="text-left font-normal">Storage</th><td className="num">{p.limits.storage_mb / 1024} GB</td></tr><tr><th scope="row" className="text-left font-normal">Branches</th><td className="num">{p.limits.branches}</td></tr></tbody></table>
      <ul className="list-disc pl-5 text-sm mt-3">{p.features.map((f: string) => <li key={f}>{f}</li>)}</ul><Link className="btn btn-primary mt-4 w-full" href="/signup">Start free trial</Link></div>)}</div>
    <h2 className="mt-10 mb-2">Add-ons (sold separately)</h2><ul className="list-disc pl-5 text-muted"><li>Assisted setup and data migration</li><li>Repeat training sessions</li><li>Operational support packages</li></ul><p className="mt-6 text-sm">Need SSO, extra languages or a custom connector? <Link href="/contact">Talk to us</Link>.</p></>); }
