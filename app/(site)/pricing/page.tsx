import Link from "next/link";
import { buttonClass } from "@/components/ui/Button";
import { Card } from "@/components/ui/Layout";
import { Money } from "@/components/ui/Format";
import { tx } from "@/lib/server/db";

export const metadata = { title: "Pricing" };
export const dynamic = "force-dynamic";

export default async function Pricing() {
  const plans = await tx({}, (db) => db.q<{ code: string; name: string; price_month_minor: number; price_year_minor: number; max_projects: number; max_users: number; storage_mb: number }>(
    "SELECT code,name,price_month_minor,price_year_minor,max_projects,max_users,storage_mb FROM plans WHERE active ORDER BY price_month_minor"));
  return (
    <div className="mx-auto max-w-page px-4 pt-14">
      <h1 className="text-display font-bold">Pricing</h1>
      <p className="mt-2 max-w-prose text-lg text-ink-700">Every plan includes the full project workflow and client portals. Amounts are in INR, exclusive of applicable taxes. 14-day free trial, no card required.</p>
      <div className="mt-8 grid gap-6 md:grid-cols-3">
        {plans.map((p) => (
          <Card key={p.code} title={p.name}>
            <p className="text-heading font-bold"><Money minor={p.price_month_minor} /> <span className="text-base font-normal text-ink-500">/ month</span></p>
            <p className="text-sm text-ink-500">or <Money minor={p.price_year_minor} /> / year</p>
            <ul className="mt-4 space-y-1 text-ink-700">
              <li>{p.max_projects} active projects</li><li>{p.max_users} users (internal and portal)</li><li>{Math.round(p.storage_mb / 1024)} GB document storage</li>
            </ul>
            <Link href={`/signup?plan=${p.code}`} className={`${buttonClass("primary")} mt-6 w-full`}>Start free trial</Link>
          </Card>
        ))}
      </div>
      <h2 className="mt-12 text-title font-bold">Optional services</h2>
      <p className="mt-2 max-w-prose text-ink-700">Assisted setup and data migration, on-site training and extra storage are sold separately. <Link href="/contact">Contact us</Link> for a quote.</p>
    </div>
  );
}
