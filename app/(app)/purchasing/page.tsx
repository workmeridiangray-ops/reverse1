import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { DateTimeText, Money } from "@/components/ui/Format";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { addSupplier, createPo, decideRequest, requestPurchase } from "./actions";

export const metadata: Metadata = { title: "Purchasing" };
export const dynamic = "force-dynamic";
const ST = { requested: { tone: "warn", icon: "hourglass", label: "Awaiting approval" }, approved: { tone: "ok", icon: "check", label: "Approved" }, rejected: { tone: "neutral", icon: "x", label: "Rejected" }, ordered: { tone: "info", icon: "flag", label: "On an order" } } as const;

export default async function Purchasing({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const session = await requireSession();
  if (session.role === "patient") return null;
  const { ok, error } = await searchParams;
  const supabase = await createClient();
  const admin = session.role === "admin";
  const [reqs, items, staff, suppliers, orders] = await Promise.all([
    supabase.from("purchase_requests").select("*").order("requested_at", { ascending: false }).limit(100),
    supabase.from("store_items").select("id, name, unit").eq("active", true).order("name"),
    supabase.from("profiles").select("id, full_name"),
    admin ? supabase.from("suppliers").select("id, name").eq("active", true) : Promise.resolve({ data: [] as never[] }),
    admin ? supabase.from("purchase_orders").select("id, number, status, created_at").order("created_at", { ascending: false }).limit(20) : Promise.resolve({ data: [] as never[] }),
  ]);
  const inm = new Map((items.data ?? []).map((i) => [i.id, i]));
  const sn = new Map((staff.data ?? []).map((s) => [s.id, s.full_name]));
  const cur = session.clinic.currency; const tz = session.clinic.timezone;
  const approved = (reqs.data ?? []).filter((r) => r.status === "approved");
  return (
    <>
      <PageHeader eyebrow={session.clinic.name} title="Purchasing" description={admin ? "Approve requests, raise orders, receive goods." : "Ask for stock you need. An administrator approves."} />
      <div className="mb-gutter flex flex-col gap-3">{error ? <Alert tone="danger" title="That didn't work">{error}</Alert> : null}{ok ? <Alert tone="ok" title={ok} /> : null}</div>
      <div className="grid gap-gutter xl:grid-cols-[1fr_24rem]">
        <div className="flex flex-col gap-gutter">
          <Card title={admin ? "All requests" : "My requests"}>
            {(reqs.data ?? []).length === 0 ? <EmptyState title="No requests yet" /> : (
              <ul className="divide-y divide-line">{(reqs.data ?? []).map((r) => (
                <li key={r.id} className="py-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-bold">{r.qty} × {inm.get(r.item_id)?.name}</span><Badge visual={ST[r.status as keyof typeof ST]} size="sm" /></div>
                  <p className="text-sm text-ink-700">{r.reason}</p><p className="text-sm text-ink-500">{sn.get(r.requested_by)} · <DateTimeText at={r.requested_at} timeZone={tz} /> · est. <Money minor={Number(r.est_unit_price_minor) * r.qty} currency={cur} />{r.decision_note ? ` · ${r.decision_note}` : ""}</p>
                  {admin && r.status === "requested" ? (r.requested_by === session.userId ? <p className="text-sm text-ink-500">Another admin must decide.</p> : (
                    <form action={decideRequest} className="mt-2 flex flex-wrap items-end gap-2"><input type="hidden" name="request_id" value={r.id} /><TextField label="Note (needed to reject)" id={`n-${r.id}`} name="note" optional />
                      <button name="decision" value="approve" className="min-h-touch rounded border border-brand-700 bg-brand-700 px-3 font-bold text-white">Approve</button><button name="decision" value="reject" className="min-h-touch rounded border border-ink-500 px-3 font-bold">Reject</button></form>)) : null}</li>))}</ul>)}
          </Card>
          {admin ? (
            <>
              <Card title="Raise an order from approved requests">
                {approved.length === 0 ? <p className="text-ink-700">No approved requests waiting.</p> : (
                  <form action={createPo} className="grid gap-4">
                    <fieldset><legend className="mb-2 font-bold">Requests to include</legend>{approved.map((r) => (<label key={r.id} className="flex min-h-touch items-center gap-3"><input type="checkbox" name="request_ids" value={r.id} className="h-5 w-5" />{r.qty} × {inm.get(r.item_id)?.name}</label>))}</fieldset>
                    <SelectField label="Supplier" name="supplier_id" id="po-sup"><option value="">Choose…</option>{(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</SelectField>
                    <SubmitButton>Create draft order</SubmitButton></form>)}
              </Card>
              <Card title="Orders">{(orders.data ?? []).length === 0 ? <EmptyState title="No orders yet" /> : <ul className="divide-y divide-line">{(orders.data ?? []).map((o) => <li key={o.id} className="py-2"><Link href={`/purchasing/orders/${o.id}`} className="font-bold">{o.number}</Link> · {o.status.replace("_", " ")}</li>)}</ul>}</Card>
            </>) : null}
        </div>
        <div className="flex flex-col gap-gutter">
          <Card title="Request stock">
            <form action={requestPurchase} className="grid gap-4">
              <SelectField label="Item" name="item_id" id="rq-item"><option value="">Choose…</option>{(items.data ?? []).map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}</SelectField>
              <TextField label="Quantity" name="qty" id="rq-qty" inputMode="numeric" /><TextField label="Estimated unit price" name="price" id="rq-price" inputMode="decimal" optional />
              <TextAreaField label="Why is it needed?" name="reason" id="rq-reason" /><SubmitButton>Send request</SubmitButton></form>
          </Card>
          {admin ? <Card title="Add a supplier"><form action={addSupplier} className="grid gap-4"><TextField label="Name" name="name" id="sp-name" /><TextField label="Contact" name="contact" id="sp-contact" optional /><SubmitButton variant="secondary">Add supplier</SubmitButton></form></Card> : null}
        </div>
      </div>
    </>
  );
}
