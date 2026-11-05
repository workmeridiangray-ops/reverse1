import type { Metadata } from "next";
import { requireCtx, can } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Empty, Field, Flash, Money, PageHeader, Table, TextInput } from "@/components/ui/kit";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { saveCustomer, setActive } from "../actions";

export const metadata: Metadata = { title: "Customers" };

export default async function Customers({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; q?: string }> }) {
  const q = await searchParams; const ctx = await requireCtx(); const sb = await createClient();
  let query = sb.from("customers").select("*").order("name");
  if (q.q) query = query.ilike("name", `%${q.q.replace(/[%_]/g, "")}%`);
  const { data } = await query.limit(200);
  const edit = can(ctx.role, "owner", "manager", "sales");
  return (
    <>
      <PageHeader title="Customers" />
      <Flash ok={q.ok} error={q.error} />
      <form className="mb-4 flex gap-2" role="search"><input className="input max-w-xs" name="q" defaultValue={q.q} placeholder="Search customers" aria-label="Search customers" /><button className="btn">Search</button></form>
      {data?.length ? (
        <Table head={["Name", "Contact", "GSTIN", "Credit limit", "Status", ""]} numeric={[3]}>
          {data.map((c: any) => (
            <tr key={c.id}><td className="td font-medium">{c.name}</td><td className="td">{c.email ?? c.phone ?? "—"}</td><td className="td">{c.gstin ?? "—"}</td>
              <td className="td num">{c.credit_limit_paise == null ? "No limit" : <Money paise={Number(c.credit_limit_paise)} />}</td>
              <td className="td">{c.active ? "Active" : "Retired"}</td>
              <td className="td">{edit && <form action={setActive}><input type="hidden" name="table" value="customers" /><input type="hidden" name="back" value="/app/customers" /><input type="hidden" name="id" value={c.id} /><input type="hidden" name="active" value={String(!c.active)} /><button className="btn">{c.active ? "Retire" : "Reactivate"}</button></form>}</td></tr>
          ))}
        </Table>
      ) : <Empty title="No customers yet" hint="Add your first customer to start taking orders." />}
      {edit && (
        <form action={saveCustomer} className="card mt-6 grid gap-4 p-6 sm:grid-cols-2">
          <h2 className="font-semibold sm:col-span-2">Add customer</h2>
          <Field label="Name" name="name"><TextInput name="name" required /></Field>
          <Field label="Email" name="email"><TextInput name="email" type="email" /></Field>
          <Field label="Phone" name="phone"><TextInput name="phone" inputMode="tel" /></Field>
          <Field label="GSTIN" name="gstin"><TextInput name="gstin" maxLength={15} /></Field>
          <Field label="Credit limit (₹)" name="credit_limit" hint="Leave empty for no limit."><TextInput name="credit_limit" inputMode="decimal" placeholder="50000.00" /></Field>
          <div className="sm:col-span-2"><SubmitButton>Save customer</SubmitButton></div>
        </form>
      )}
    </>
  );
}
