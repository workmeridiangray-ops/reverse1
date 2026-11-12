import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { env } from "@/lib/env";
import { Alert } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { StatusButton } from "@/components/StatusButton";
import { testPayAction } from "./actions";
export const dynamic = "force-dynamic";
export default async function TestCheckout({ searchParams }: { searchParams: Promise<{ invoice?: string }> }) {
  if (env.billingProvider !== "test") notFound();
  const ctx = await requireTenant("billing.manage"); const id = (await searchParams).invoice ?? "";
  const inv = /^[0-9a-f-]{36}$/.test(id) ? await withTenantSystem(ctx.tenant.id, async (db) => (await db.query("select * from platform_invoices where id=$1 and tenant_id=$2", [id, ctx.tenant.id])).rows[0]) : null;
  if (!inv) notFound();
  return (<div className="authbox"><div className="card"><h1>Test payment provider</h1><Alert tone="warn">Simulated provider for development and QA — no real money moves. Production uses Razorpay.</Alert>
    <p>{inv.description}<br /><strong>{formatMoney(inv.total_paise)}</strong> incl. GST</p>
    <div className="row"><StatusButton className="btn primary" action={testPayAction.bind(null, id, "success")} label="Pay with test card (success)" /><StatusButton className="btn" action={testPayAction.bind(null, id, "fail")} label="Decline (insufficient funds)" /></div>
    <p className="small"><a href="/app/settings/billing">Back to billing</a></p></div></div>);
}
