import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SelectField, TextField } from "@/components/ui/Field";
import { DateTimeText, Money } from "@/components/ui/Format";
import { Alert, Card, DefinitionList, PageHeader } from "@/components/ui/Layout";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { Table, Td, Th } from "@/components/ui/Table";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { approvePo, receiveGoods, setSupplierBill } from "../../actions";

export const metadata: Metadata = { title: "Purchase order" };
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const session = await requireRole("admin");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { ok, error } = await searchParams;
  const supabase = await createClient();
  const { data: o } = await supabase.from("purchase_orders").select("*").eq("id", id).maybeSingle();
  if (!o) notFound();
  const [lines, items, supplier, locs, receipts, staff] = await Promise.all([
    supabase.from("po_lines").select("*").eq("po_id", id),
    supabase.from("store_items").select("id, name"),
    supabase.from("suppliers").select("name").eq("id", o.supplier_id).single(),
    supabase.from("store_locations").select("id, name, is_main").order("name"),
    supabase.from("goods_receipts").select("po_line_id, qty, delivery_note, received_at, received_by"),
    supabase.from("profiles").select("id, full_name"),
  ]);
  const inm = new Map((items.data ?? []).map((i) => [i.id, i.name])); const sn = new Map((staff.data ?? []).map((s) => [s.id, s.full_name]));
  const lineIds = new Set((lines.data ?? []).map((l) => l.id));
  const rcv = (receipts.data ?? []).filter((r) => lineIds.has(r.po_line_id));
  const cur = session.clinic.currency; const tz = session.clinic.timezone;
  const total = (lines.data ?? []).reduce((t, l) => t + Number(l.unit_price_minor) * l.qty, 0);
  const canReceive = o.status === "approved" || o.status === "part_received";
  return (
    <>
      <PageHeader eyebrow="Purchase order" title={o.number} description={<>{supplier.data?.name} · <Link href="/purchasing">All purchasing</Link></>} />
      <div className="mb-gutter flex flex-col gap-3">{error ? <Alert tone="danger" title="That didn't work">{error}</Alert> : null}{ok ? <Alert tone="ok" title={ok} /> : null}</div>
      <div className="grid gap-gutter xl:grid-cols-2">
        <Card title="Order"><DefinitionList items={[["Status", o.status.replace("_", " ")], ["Total", <Money key="t" minor={total} currency={cur} />], ["Created by", sn.get(o.created_by) ?? "—"], ["Approved by", o.approved_by ? sn.get(o.approved_by) ?? "—" : "Not yet"], ["Supplier bill reference", o.supplier_bill_ref ?? "—"]]} />
          {o.status === "draft" ? (o.created_by === session.userId ? <p className="mt-4 text-sm text-ink-500">Another admin must approve this order.</p> : <form action={approvePo} className="mt-4"><input type="hidden" name="po_id" value={id} /><SubmitButton>Approve order</SubmitButton></form>) : null}
          {o.status === "part_received" || o.status === "received" ? <form action={setSupplierBill} className="mt-4 flex items-end gap-3"><input type="hidden" name="po_id" value={id} /><TextField label="Supplier bill reference" id="sb-ref" name="ref" defaultValue={o.supplier_bill_ref ?? ""} hint="A reference only. Payment is handled in your accounts." /><SubmitButton size="sm" variant="secondary">Save</SubmitButton></form> : null}
        </Card>
        <Card title="Lines">
          <Table caption="Order lines"><thead><tr><Th>Item</Th><Th className="text-right">Ordered</Th><Th className="text-right">Received</Th><Th className="text-right">Unit price</Th></tr></thead>
            <tbody>{(lines.data ?? []).map((l) => (<tr key={l.id}><Td>{inm.get(l.item_id)}</Td><Td className="text-right font-mono">{l.qty}</Td><Td className="text-right font-mono">{l.received_qty}</Td><Td className="text-right"><Money minor={Number(l.unit_price_minor)} currency={cur} /></Td></tr>))}</tbody></Table>
        </Card>
        {canReceive ? (
          <Card title="Receive goods" className="xl:col-span-2">
            {(lines.data ?? []).filter((l) => l.received_qty < l.qty).map((l) => (
              <form key={l.id} action={receiveGoods} className="mb-4 grid items-end gap-3 md:grid-cols-[1fr_6rem_10rem_12rem_auto]"><input type="hidden" name="po_id" value={id} /><input type="hidden" name="line_id" value={l.id} />
                <span className="font-bold">{inm.get(l.item_id)} <span className="font-normal text-ink-500">({l.qty - l.received_qty} still due)</span></span>
                <TextField label="Qty" id={`rq-${l.id}`} name="qty" inputMode="numeric" /><TextField label="Delivery note" id={`dn-${l.id}`} name="delivery_note" />
                <SelectField label="Into" id={`lc-${l.id}`} name="location_id" defaultValue={(locs.data ?? []).find((x) => x.is_main)?.id}>{(locs.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</SelectField>
                <SubmitButton size="sm">Receive</SubmitButton></form>))}
          </Card>) : null}
        {rcv.length ? <Card title="Receipts" className="xl:col-span-2"><ul className="divide-y divide-line">{rcv.map((r, i) => <li key={i} className="py-2">{r.qty} received · {r.delivery_note} · {sn.get(r.received_by)} · <DateTimeText at={r.received_at} timeZone={tz} /></li>)}</ul></Card> : null}
      </div>
    </>
  );
}
