import type { Metadata } from "next";
import { Badge } from "@/components/ui/Badge";
import { CheckboxField, SelectField, TextField } from "@/components/ui/Field";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { Table, Td, Th } from "@/components/ui/Table";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { addItem, addLocation, countStock, issueStock, transferStock } from "../purchasing/actions";

export const metadata: Metadata = { title: "Stores" };
export const dynamic = "force-dynamic";

export default async function Stores({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const session = await requireRole("admin", "nurse", "lab", "pharmacist");
  const { ok, error } = await searchParams;
  const supabase = await createClient();
  const [items, locs, bal] = await Promise.all([
    supabase.from("store_items").select("id, name, unit, reorder_level").eq("active", true).order("name"),
    supabase.from("store_locations").select("id, name, is_main").order("name"),
    supabase.from("store_balances").select("item_id, location_id, qty"),
  ]);
  const total = (id: string) => (bal.data ?? []).filter((b) => b.item_id === id).reduce((t, b) => t + b.qty, 0);
  const at = (i: string, l: string) => (bal.data ?? []).find((b) => b.item_id === i && b.location_id === l)?.qty ?? 0;
  const itemOpts = (items.data ?? []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>);
  const locOpts = (locs.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>);
  const admin = session.role === "admin";
  return (
    <>
      <PageHeader eyebrow={session.clinic.name} title="Stores" description="Consumables by location. Medicines are managed in Pharmacy." />
      <div className="mb-gutter flex flex-col gap-3">{error ? <Alert tone="danger" title="That didn't work">{error}</Alert> : null}{ok ? <Alert tone="ok" title={ok} /> : null}</div>
      <div className="grid gap-gutter xl:grid-cols-[1fr_24rem]">
        <Card title="Stock on hand">
          {(items.data ?? []).length === 0 ? <EmptyState title="No items yet" /> : (
            <Table caption="Stock by location"><thead><tr><Th>Item</Th>{(locs.data ?? []).map((l) => <Th key={l.id} className="text-right">{l.name}</Th>)}<Th className="text-right">Total</Th><Th>Level</Th></tr></thead>
              <tbody>{(items.data ?? []).map((i) => { const t = total(i.id); const low = t <= i.reorder_level; return (<tr key={i.id}><Td className="font-bold">{i.name}</Td>
                {(locs.data ?? []).map((l) => <Td key={l.id} className="text-right font-mono">{at(i.id, l.id)}</Td>)}<Td className="text-right font-mono">{t}</Td>
                <Td><Badge visual={low ? { tone: "warn", icon: "alert", label: "Reorder" } : { tone: "ok", icon: "check", label: "OK" }} size="sm" /></Td></tr>); })}</tbody></Table>)}
        </Card>
        <div className="flex flex-col gap-gutter">
          <Card title="Issue to a department"><form action={issueStock} className="grid gap-3"><SelectField label="Item" id="is-item" name="item_id">{itemOpts}</SelectField><SelectField label="From" id="is-from" name="location_id">{locOpts}</SelectField><TextField label="Quantity" id="is-qty" name="qty" inputMode="numeric" /><TextField label="To department" id="is-to" name="to" /><SubmitButton>Issue</SubmitButton></form></Card>
          <Card title="Transfer between locations"><form action={transferStock} className="grid gap-3"><SelectField label="Item" id="tr-item" name="item_id">{itemOpts}</SelectField><SelectField label="From" id="tr-from" name="from_id">{locOpts}</SelectField><SelectField label="To" id="tr-to" name="to_id">{locOpts}</SelectField><TextField label="Quantity" id="tr-qty" name="qty" inputMode="numeric" /><SubmitButton variant="secondary">Transfer</SubmitButton></form></Card>
          <Card title="Stock count"><form action={countStock} className="grid gap-3"><SelectField label="Item" id="ct-item" name="item_id">{itemOpts}</SelectField><SelectField label="Location" id="ct-loc" name="location_id">{locOpts}</SelectField><TextField label="Counted" id="ct-n" name="counted" inputMode="numeric" /><TextField label="Reason for any difference" id="ct-reason" name="reason" optional /><SubmitButton variant="secondary">Record count</SubmitButton></form></Card>
          {admin ? (<><Card title="Add an item"><form action={addItem} className="grid gap-3"><TextField label="Name" id="ai-name" name="name" /><TextField label="Unit" id="ai-unit" name="unit" defaultValue="each" /><TextField label="Reorder level" id="ai-re" name="reorder" defaultValue="0" inputMode="numeric" /><SubmitButton variant="secondary">Add item</SubmitButton></form></Card>
            <Card title="Add a location"><form action={addLocation} className="grid gap-3"><TextField label="Name" id="al-name" name="name" /><CheckboxField label="This is the main store" name="main" id="al-main" /><SubmitButton variant="secondary">Add location</SubmitButton></form></Card></>) : null}
        </div>
      </div>
    </>
  );
}
