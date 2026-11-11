import { notFound } from "next/navigation";
import Script from "next/script";
import { requireCompany } from "@/lib/server/auth";
import { plat } from "@/lib/server/db";
import { provider } from "@/lib/server/billing";
import { Page, Card, Note } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { sandboxPayAction } from "../../../../actions2";
import { formatINR } from "@/lib/domain/money";
import { Hidden } from "@/components/ui";
import { PayButton } from "@/components/PayButton";
export const dynamic = "force-dynamic";
export default async function P({ params }: { params: Promise<{ id: string }> }) {
  const a = await requireCompany("admin.billing", { allowSuspended: true }); const { id } = await params; if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const inv = (await plat("select * from platform_invoices where id=$1 and company_id=$2", [id, a.company.id])).rows[0]; if (!inv) notFound();
  const total = Number(inv.amount_paise) + Number(inv.tax_paise);
  return <Page title={`Pay ${inv.number}`} crumbs={[["Billing", "/app/settings/billing"], ["Pay"]]} sub={inv.description}>
    <Card><dl className="space-y-1 text-sm"><div className="flex justify-between"><dt>Amount</dt><dd className="num">{formatINR(inv.amount_paise)}</dd></div><div className="flex justify-between"><dt>GST (18%)</dt><dd className="num">{formatINR(inv.tax_paise)}</dd></div><div className="flex justify-between border-t border-line pt-1 font-semibold"><dt>Total</dt><dd className="num">{formatINR(total)}</dd></div></dl>
      {inv.status === "paid" ? <Note tone="ok">This invoice is paid.</Note> : provider() === "razorpay" ? <><Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" /><PayButton orderId={inv.provider_ref} amount={total} keyId={process.env.RAZORPAY_KEY_ID!} name={a.company.name} email={a.user.email} /></>
      : provider() === "sandbox" ? <><Note tone="warn">Sandbox payment mode — no real money moves. Use to rehearse payment outcomes.</Note><div className="flex flex-wrap gap-3"><ActionForm action={sandboxPayAction} submit="Simulate successful payment"><Hidden name="id" value={inv.id} /><input type="hidden" name="outcome" value="ok" /></ActionForm><ActionForm action={sandboxPayAction} submit="Simulate failed payment" danger><Hidden name="id" value={inv.id} /><input type="hidden" name="outcome" value="fail" /></ActionForm></div></>
      : <Note tone="warn">Online payment is not configured. Contact support.</Note>}</Card></Page>;
}
