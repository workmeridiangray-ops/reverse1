import type { Metadata } from "next";
import { requireCtx, can } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Empty, Field, Flash, LinkBtn, PageHeader, Qty, Table, TextInput } from "@/components/ui/kit";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { adjustStock } from "../actions";
import { createTransfer, receiveTransfer } from "../actions2";

export const metadata: Metadata = { title: "Inventory" };

export default async function Inventory({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; ledger?: string }> }) {
  const q = await searchParams; const ctx = await requireCtx(); const sb = await createClient();
  const [{ data: levels }, { data: items }, { data: whs }, { data: moves }, { data: transfers }] = await Promise.all([
    sb.from("stock_levels").select("*").order("sku").limit(500),
    sb.from("items").select("id,sku,name").eq("kind", "stock").eq("active", true).order("sku"),
    sb.from("warehouses").select("id,name").eq("active", true),
    sb.from("stock_movements").select("id,qty,kind,reason,created_at,ref_type, items(sku), warehouses(name)").order("created_at", { ascending: false }).limit(q.ledger ? 200 : 15),
    sb.from("stock_transfers").select("id,number,status,created_at, from:warehouses!stock_transfers_tenant_id_from_warehouse_id_fkey(name), to:warehouses!stock_transfers_tenant_id_to_warehouse_id_fkey(name)").order("created_at", { ascending: false }).limit(10),
  ]);
  const adj = can(ctx.role, "owner", "manager", "warehouse");
  return (
    <>
      <PageHeader title="Inventory" sub="On hand, reserved and available are tracked separately. Movements are permanent; corrections are new movements." actions={<><LinkBtn href="/app/inventory/lots">Lots &amp; serials</LinkBtn><LinkBtn href="/app/inventory/labels">Print labels</LinkBtn><LinkBtn href="/app/scan">Scan</LinkBtn></>} />
      <Flash ok={q.ok} error={q.error} />
      {levels?.length ? (
        <Table head={["SKU", "Item", "Warehouse", "On hand", "Reserved", "Available", "Reorder at"]} numeric={[3, 4, 5, 6]}>
          {levels.map((s: any) => { const av = Number(s.on_hand) - Number(s.reserved); const low = Number(s.reorder_level) > 0 && av <= Number(s.reorder_level);
            return <tr key={`${s.item_id}${s.warehouse_id}`}><td className="td font-mono">{s.sku}</td><td className="td">{s.item_name}</td><td className="td">{s.warehouse_name}</td>
              <td className="td num"><Qty v={s.on_hand} /></td><td className="td num"><Qty v={s.reserved} /></td><td className={`td num font-semibold ${low ? "text-danger" : ""}`}><Qty v={av} />{low && <span className="ml-1 text-xs">low</span>}</td><td className="td num"><Qty v={s.reorder_level} /></td></tr>; })}
        </Table>
      ) : <Empty title="No stock items" hint="Add a stock item, then receive goods or adjust an opening balance." />}
      {adj && (
        <form action={adjustStock} className="card mt-6 grid gap-4 p-6 sm:grid-cols-2 lg:grid-cols-4">
          <h2 className="font-semibold sm:col-span-full">Stock adjustment / opening balance</h2>
          <Field label="Item" name="item"><select id="item" name="item" required className="input">{(items ?? []).map((i: any) => <option key={i.id} value={i.id}>{i.sku} · {i.name}</option>)}</select></Field>
          <Field label="Warehouse" name="warehouse"><select id="warehouse" name="warehouse" required className="input">{(whs ?? []).map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
          <Field label="Change (+/−)" name="delta" hint="e.g. 25 or -3"><TextInput name="delta" required inputMode="decimal" /></Field>
          <Field label="Reason" name="reason"><TextInput name="reason" required minLength={3} placeholder="Cycle count, damage…" /></Field>
          <Field label="Lot / serial (tracked items)" name="lot"><TextInput name="lot" placeholder="Required for batch/serial items" /></Field>
          <Field label="Expiry (new lots)" name="expiry"><TextInput name="expiry" type="date" /></Field>
          <div className="sm:col-span-full"><SubmitButton>Post adjustment</SubmitButton></div>
        </form>
      )}
      <h2 className="mb-2 mt-8 font-semibold">Warehouse transfers</h2>
      <Table head={["Transfer", "From", "To", "Status", ""]}>
        {(transfers ?? []).map((t: any) => <tr key={t.id}><td className="td font-mono">{t.number}</td><td className="td">{t.from?.name}</td><td className="td">{t.to?.name}</td><td className="td">{t.status === "in_transit" ? "In transit" : "Received"}</td>
          <td className="td">{t.status === "in_transit" && adj && <form action={receiveTransfer}><input type="hidden" name="id" value={t.id} /><button className="btn">Receive</button></form>}</td></tr>)}
        {!transfers?.length && <tr><td className="td text-muted" colSpan={5}>No transfers.</td></tr>}
      </Table>
      {adj && (whs?.length ?? 0) > 1 && (
        <form action={createTransfer} className="card mt-3 grid gap-3 p-5 sm:grid-cols-2"><h3 className="font-semibold sm:col-span-2">New transfer</h3>
          <label className="text-sm">From<select name="from" className="input mt-1">{(whs ?? []).map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
          <label className="text-sm">To<select name="to" className="input mt-1">{(whs ?? []).map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
          {[0, 1, 2].map((i) => <div key={i} className="grid grid-cols-[1fr_7rem] gap-2 sm:col-span-2"><select name={`ti_${i}`} aria-label={`Line ${i + 1} item`} className="input"><option value="">—</option>{(items ?? []).map((it: any) => <option key={it.id} value={it.id}>{it.sku} · {it.name}</option>)}</select><input name={`tq_${i}`} inputMode="decimal" placeholder="Qty" aria-label={`Line ${i + 1} quantity`} className="input" /></div>)}
          <div className="sm:col-span-2"><SubmitButton>Send transfer</SubmitButton></div></form>)}
      <h2 className="mb-2 mt-8 font-semibold">Stock ledger {q.ledger ? "" : "(latest)"}</h2>
      <Table head={["When", "Item", "Warehouse", "Type", "Qty", "Note"]} numeric={[4]}>
        {(moves ?? []).map((m: any) => <tr key={m.id}><td className="td">{String(m.created_at).slice(0, 16).replace("T", " ")}</td><td className="td font-mono">{m.items?.sku}</td><td className="td">{m.warehouses?.name}</td><td className="td">{m.kind}</td><td className="td num"><Qty v={m.qty} /></td><td className="td">{m.reason ?? m.ref_type}</td></tr>)}
      </Table>
      {!q.ledger && <p className="mt-3"><a className="text-brand underline" href="/app/inventory?ledger=1">Show full ledger</a></p>}
    </>
  );
}
