import type { Metadata } from "next";
import { requireCtx, can } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Empty, Field, Flash, PageHeader, Table, TextInput } from "@/components/ui/kit";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { saveSupplier, setActive } from "../actions";

export const metadata: Metadata = { title: "Suppliers" };

export default async function Suppliers({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const q = await searchParams; const ctx = await requireCtx(); const sb = await createClient();
  const { data } = await sb.from("suppliers").select("*").order("name").limit(200);
  const edit = can(ctx.role, "owner", "manager", "purchasing");
  return (
    <>
      <PageHeader title="Suppliers" />
      <Flash ok={q.ok} error={q.error} />
      {data?.length ? (
        <Table head={["Name", "Contact", "GSTIN", "Status", ""]}>
          {data.map((c: any) => (
            <tr key={c.id}><td className="td font-medium">{c.name}</td><td className="td">{c.email ?? c.phone ?? "—"}</td><td className="td">{c.gstin ?? "—"}</td><td className="td">{c.active ? "Active" : "Retired"}</td>
              <td className="td">{edit && <form action={setActive}><input type="hidden" name="table" value="suppliers" /><input type="hidden" name="back" value="/app/suppliers" /><input type="hidden" name="id" value={c.id} /><input type="hidden" name="active" value={String(!c.active)} /><button className="btn">{c.active ? "Retire" : "Reactivate"}</button></form>}</td></tr>
          ))}
        </Table>
      ) : <Empty title="No suppliers yet" hint="Add a supplier before approving purchase requests." />}
      {edit && (
        <form action={saveSupplier} className="card mt-6 grid gap-4 p-6 sm:grid-cols-2">
          <h2 className="font-semibold sm:col-span-2">Add supplier</h2>
          <Field label="Name" name="name"><TextInput name="name" required /></Field>
          <Field label="Email" name="email"><TextInput name="email" type="email" /></Field>
          <Field label="Phone" name="phone"><TextInput name="phone" inputMode="tel" /></Field>
          <Field label="GSTIN" name="gstin"><TextInput name="gstin" maxLength={15} /></Field>
          <div className="sm:col-span-2"><SubmitButton>Save supplier</SubmitButton></div>
        </form>
      )}
    </>
  );
}
