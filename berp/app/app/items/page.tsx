import type { Metadata } from "next";
import { requireCtx, can } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Empty, Field, Flash, Money, PageHeader, Table, TextInput } from "@/components/ui/kit";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { saveItem, setActive } from "../actions";

export const metadata: Metadata = { title: "Items" };

export default async function Items({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const q = await searchParams; const ctx = await requireCtx(); const sb = await createClient();
  const [{ data }, { data: taxes }] = await Promise.all([
    sb.from("items").select("*, tax_codes(code)").order("sku").limit(300),
    sb.from("tax_codes").select("id,code,rate_bp").eq("active", true).order("rate_bp"),
  ]);
  const edit = can(ctx.role, "owner", "manager", "sales");
  const showCost = can(ctx.role, "owner", "manager", "accountant");
  return (
    <>
      <PageHeader title="Items and services" />
      <Flash ok={q.ok} error={q.error} />
      {data?.length ? (
        <Table head={["SKU", "Name", "Type", "Unit", "Sale price", ...(showCost ? ["Cost"] : []), "Tax", "Status", ""]} numeric={[4, ...(showCost ? [5] : [])]}>
          {data.map((i: any) => (
            <tr key={i.id}><td className="td font-mono">{i.sku}</td><td className="td font-medium">{i.name}</td><td className="td">{i.kind}</td><td className="td">{i.unit}</td>
              <td className="td num"><Money paise={Number(i.sale_price_paise)} /></td>{showCost && <td className="td num"><Money paise={Number(i.cost_paise)} /></td>}
              <td className="td">{i.tax_codes?.code ?? "—"}</td><td className="td">{i.active ? "Active" : "Retired"}</td>
              <td className="td">{edit && <form action={setActive}><input type="hidden" name="table" value="items" /><input type="hidden" name="back" value="/app/items" /><input type="hidden" name="id" value={i.id} /><input type="hidden" name="active" value={String(!i.active)} /><button className="btn">{i.active ? "Retire" : "Reactivate"}</button></form>}</td></tr>
          ))}
        </Table>
      ) : <Empty title="No items yet" hint="Add stock items and services you sell." />}
      {edit && (
        <form action={saveItem} className="card mt-6 grid gap-4 p-6 sm:grid-cols-2 lg:grid-cols-3">
          <h2 className="font-semibold sm:col-span-full">Add item</h2>
          <Field label="SKU" name="sku" hint="Letters, numbers, . _ -"><TextInput name="sku" required pattern="[A-Za-z0-9._\-]{1,40}" /></Field>
          <Field label="Name" name="name"><TextInput name="name" required /></Field>
          <Field label="Type" name="kind"><select id="kind" name="kind" className="input"><option value="stock">Stock item</option><option value="service">Service</option></select></Field>
          <Field label="Unit" name="unit"><TextInput name="unit" defaultValue="nos" /></Field>
          <Field label="Sale price (₹)" name="price"><TextInput name="price" inputMode="decimal" placeholder="1000.00" /></Field>
          <Field label="Cost (₹)" name="cost"><TextInput name="cost" inputMode="decimal" placeholder="600.00" /></Field>
          <Field label="Tax" name="tax_code_id"><select id="tax_code_id" name="tax_code_id" className="input"><option value="">None</option>{(taxes ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.code} ({t.rate_bp / 100}%)</option>)}</select></Field>
          <Field label="Reorder level" name="reorder"><TextInput name="reorder" inputMode="decimal" defaultValue="0" /></Field>
          <div className="sm:col-span-full"><SubmitButton>Save item</SubmitButton></div>
        </form>
      )}
    </>
  );
}
