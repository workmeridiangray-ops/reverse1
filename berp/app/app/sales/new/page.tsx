import type { Metadata } from "next";
import { requireCtx, can } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Field, Flash, PageHeader } from "@/components/ui/kit";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { createOrder } from "../../actions";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "New sales order" };

export default async function NewOrder({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const q = await searchParams; const ctx = await requireCtx();
  if (!can(ctx.role, "owner", "manager", "sales")) redirect("/app/sales?error=" + encodeURIComponent("Your role cannot create orders"));
  const sb = await createClient();
  const [{ data: customers }, { data: whs }, { data: items }] = await Promise.all([
    sb.from("customers").select("id,name").eq("active", true).order("name"),
    sb.from("warehouses").select("id,name").eq("active", true).order("name"),
    sb.from("items").select("id,sku,name,unit,sale_price_paise").eq("active", true).order("sku"),
  ]);
  return (
    <>
      <PageHeader title="New sales order" sub="Prices and tax come from the item master. Stock is reserved when you confirm." />
      <Flash error={q.error} />
      <form action={createOrder} className="card space-y-6 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Customer" name="customer"><select id="customer" name="customer" required className="input"><option value="">Select…</option>{(customers ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Ship from" name="warehouse"><select id="warehouse" name="warehouse" required className="input">{(whs ?? []).map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
        </div>
        <fieldset>
          <legend className="mb-2 font-semibold">Lines</legend>
          <div className="space-y-2">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_8rem_8rem]">
                <select name={`item_${i}`} aria-label={`Line ${i + 1} item`} className="input"><option value="">{i === 0 ? "Select item…" : "—"}</option>{(items ?? []).map((it: any) => <option key={it.id} value={it.id}>{it.sku} · {it.name} ({it.unit})</option>)}</select>
                <input name={`qty_${i}`} aria-label={`Line ${i + 1} quantity`} className="input" inputMode="decimal" placeholder="Qty" />
                <input name={`disc_${i}`} aria-label={`Line ${i + 1} discount percent`} className="input" inputMode="decimal" placeholder="Disc %" />
              </div>
            ))}
          </div>
        </fieldset>
        <Field label="Notes" name="notes"><textarea id="notes" name="notes" rows={2} className="input py-2" /></Field>
        <SubmitButton>Create draft order</SubmitButton>
      </form>
    </>
  );
}
