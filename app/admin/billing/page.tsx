import { plat } from "@/lib/server/db";
import { requirePlatform } from "@/lib/server/auth";
import { Page, Card, DataTable, Badge, Field, Grid, Hidden, date, dt } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { newPlanVersion, refundInvoice, saveCoupon, toggleCoupon } from "../actions";
import { formatINR } from "@/lib/domain/money";
export const metadata = { title: "Plans & invoices" };
export default async function P({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requirePlatform("billing"); const sp = await searchParams;
  const plans = (await plat("select p.id, p.name from plans p order by p.name")).rows;
  const vers = (await plat("select v.*, p.name from plan_versions v join plans p on p.id=v.plan_id order by p.name, v.version desc")).rows;
  const invs = (await plat(`select i.*, c.name company from platform_invoices i join companies c on c.id=i.company_id ${sp.status ? "where i.status=$1" : ""} order by i.created_at desc limit 60`, sp.status ? [sp.status] : [])).rows;
  const coupons = (await plat("select * from coupons order by created_at desc")).rows;
  return <Page title="Plans, invoices & coupons" sub="Plan changes create a new effective-dated version; invoices keep the version they were issued under.">
    <Card title="Plan versions"><DataTable rows={vers} cols={[{ h: "Plan", r: (r: any) => `${r.name} v${r.version}` }, { h: "From", r: (r: any) => date(r.effective_from) }, { h: "Monthly", r: (r: any) => formatINR(r.price_monthly_paise), num: true }, { h: "Yearly", r: (r: any) => formatINR(r.price_yearly_paise), num: true }, { h: "Users/Plants/Items", r: (r: any) => `${r.max_users}/${r.max_plants}/${r.max_items}`, hideSm: true }]} />
      <ActionForm action={newPlanVersion} submit="Schedule new version" className="mt-3"><Grid cols={4}><Field label="Plan" name="plan" required options={plans.map((p: any) => ({ value: p.id, label: p.name }))} /><Field label="Effective from" name="effective" type="date" required /><Field label="Monthly (₹)" name="monthly" required /><Field label="Yearly (₹)" name="yearly" required /><Field label="Max users" name="users" type="number" required /><Field label="Max plants" name="plants" type="number" required /><Field label="Max items" name="items" type="number" required /></Grid></ActionForm></Card>
    <h2 className="mb-2 mt-6 font-semibold">Invoices & payments</h2>
    <form className="mb-3 flex gap-2"><select name="status" defaultValue={sp.status ?? ""} className="input w-44" aria-label="Status"><option value="">All</option>{["pending", "paid", "failed", "refunded", "disputed"].map((s) => <option key={s}>{s}</option>)}</select><button className="btn-secondary">Filter</button></form>
    <DataTable rows={invs} empty="No invoices." cols={[{ h: "Invoice", r: (r: any) => r.number }, { h: "Business", r: (r: any) => r.company }, { h: "Total", r: (r: any) => formatINR(Number(r.amount_paise) + Number(r.tax_paise)), num: true }, { h: "Status", r: (r: any) => <Badge s={r.status} /> }, { h: "Provider ref", r: (r: any) => <code className="text-xs">{r.provider_ref ?? "—"}</code>, hideSm: true }, { h: "Reconciliation", r: (r: any) => <code className="text-xs">{r.reconciliation_ref?.startsWith("{") ? "—" : (r.reconciliation_ref ?? "—")}</code>, hideSm: true },
      { h: "Refund", r: (r: any) => r.status === "paid" ? <details><summary className="cursor-pointer text-brand">Refund</summary><ActionForm action={refundInvoice} submit="Record refund" small danger className="mt-2 w-56"><Hidden name="id" value={r.id} /><Field label="Amount (₹)" name="amount" required /><Field label="Reason" name="reason" required /></ActionForm></details> : r.refunded_paise > 0 ? formatINR(r.refunded_paise) : null }]} />
    <Card title="Coupons" className="mt-6"><DataTable rows={coupons} empty="None." cols={[{ h: "Code", r: (r: any) => r.code }, { h: "Off", r: (r: any) => `${r.percent_off}%`, num: true }, { h: "Active", r: (r: any) => <Badge s={r.active ? "active" : "obsolete"} label={r.active ? "active" : "off"} /> }, { h: "", r: (r: any) => <ActionForm action={toggleCoupon} submit="Toggle" small secondary><Hidden name="id" value={r.id} /></ActionForm> }]} />
      <ActionForm action={saveCoupon} submit="Save coupon" className="mt-3" resetOnOk><Grid><Field label="Code" name="code" required /><Field label="Percent off" name="percent" type="number" required /></Grid></ActionForm></Card></Page>;
}
void dt;
