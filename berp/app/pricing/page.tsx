import Link from "next/link";
import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/site";
import { createClient } from "@/lib/supabase/server";
import { formatInr } from "@/lib/rules/money";

export const metadata: Metadata = { title: "Pricing" };

export default async function Pricing() {
  const sb = await createClient();
  const { data: plans } = await sb.from("plans").select("*").eq("active", true).neq("code", "trial").order("price_monthly_paise");
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto max-w-page px-4 py-14">
        <h1 className="text-3xl font-semibold tracking-tight">Pricing</h1>
        <p className="mt-2 text-muted">Every plan starts with a 14-day trial. Yearly billing is two months free. Prices exclude GST.</p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {(plans ?? []).map((p: any) => (
            <section key={p.code} className="card p-6" aria-labelledby={`plan-${p.code}`}>
              <h2 id={`plan-${p.code}`} className="text-lg font-semibold">{p.name}</h2>
              <p className="mt-2 text-3xl font-semibold">{formatInr(p.price_monthly_paise)}<span className="text-base font-normal text-muted"> / month</span></p>
              <p className="text-sm text-muted">or {formatInr(p.price_yearly_paise)} / year</p>
              <ul className="mt-4 space-y-1 text-sm"><li>{p.max_users} users</li><li>{p.max_branches} branch{p.max_branches > 1 ? "es" : ""}</li><li>{p.max_warehouses} warehouses</li></ul>
              <Link href="/signup" className="btn btn-primary mt-5 w-full">Start trial</Link>
            </section>
          ))}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
