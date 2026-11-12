import { redirect, notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Alert } from "@/components/ui";
import { createCheckout } from "@/lib/billing/provider";
import { RazorpayCheckout } from "@/components/RazorpayCheckout";
import { formatMoney } from "@/lib/money";
import { env } from "@/lib/env";
export const dynamic = "force-dynamic";
export default async function Checkout({ params }: { params: Promise<{ invoice: string }> }) {
  const { invoice } = await params; if (!/^[0-9a-f-]{36}$/.test(invoice)) notFound();
  const ctx = await requireTenant("billing.manage");
  const inv = await withTenantSystem(ctx.tenant.id, async (db) => (await db.query("select * from platform_invoices where id=$1 and tenant_id=$2", [invoice, ctx.tenant.id])).rows[0]);
  if (!inv) notFound();
  if (inv.status === "paid") return <><PageHead title="Already paid" /><Alert tone="ok">Invoice {inv.number} is paid.</Alert></>;
  if (inv.total_paise === 0) return <Alert tone="info">Nothing to pay — account credit covered this invoice. <a href="/app/settings/billing">Back</a></Alert>;
  let co; try { co = await createCheckout({ id: inv.id, number: inv.number, totalPaise: inv.total_paise, tenantName: ctx.tenant.name, email: ctx.user.email }); }
  catch (e: any) { return <><PageHead title="Checkout" /><Alert tone="bad">Payments are unavailable right now: {e.message}. Nothing was charged. Try again later or contact support.</Alert></>; }
  if (co.kind === "redirect") redirect(co.url);
  return (<><PageHead title="Pay invoice" crumbs={[["Billing", "/app/settings/billing"], ["Checkout"]]} sub={`${inv.number} — ${formatMoney(inv.total_paise)} incl. GST`} />
    <div className="card"><p>{inv.description}</p>{env.billingProvider === "razorpay" && <RazorpayCheckout {...co} invoiceId={inv.id} />}</div></>);
}
