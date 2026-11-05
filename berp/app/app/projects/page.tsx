import type { Metadata } from "next";
import Link from "next/link";
import { requireCtx, can } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Empty, Field, Flash, Money, PageHeader, Status, Table, TextInput } from "@/components/ui/kit";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { createProject } from "../actions2";

export const metadata: Metadata = { title: "Projects" };

export default async function Projects({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const q = await searchParams; const ctx = await requireCtx(); const sb = await createClient();
  const [{ data: ps }, { data: costs }, { data: customers }] = await Promise.all([
    sb.from("projects").select("id,number,name,status,budget_paise,customers(name)").order("created_at", { ascending: false }),
    sb.from("project_costs").select("project_id,labour_paise,expense_paise"),
    sb.from("customers").select("id,name").eq("active", true).order("name"),
  ]);
  const cost = (id: string) => { const c = (costs ?? []).find((x: any) => x.project_id === id) as any; return c ? Number(c.labour_paise) + Number(c.expense_paise) : null; };
  return (
    <>
      <PageHeader title="Projects" sub="Budget, approved time and expenses, and milestone billing." />
      <Flash ok={q.ok} error={q.error} />
      {ps?.length ? (
        <Table head={["Project", "Name", "Customer", "Budget", "Cost to date", "Status"]} numeric={[3, 4]}>
          {ps.map((p: any) => <tr key={p.id}><td className="td font-mono"><Link className="text-brand underline" href={`/app/projects/${p.id}`}>{p.number}</Link></td><td className="td font-medium">{p.name}</td><td className="td">{p.customers?.name ?? "—"}</td>
            <td className="td num"><Money paise={Number(p.budget_paise)} /></td><td className="td num">{cost(p.id) == null ? "Restricted" : <Money paise={cost(p.id)!} />}</td><td className="td"><Status value={p.status} /></td></tr>)}
        </Table>
      ) : <Empty title="No projects yet" hint="Create a project to track budget, time, expenses and milestone invoices." />}
      {can(ctx.role, "owner", "manager") && (
        <form action={createProject} className="card mt-6 grid gap-4 p-6 sm:grid-cols-3"><h2 className="font-semibold sm:col-span-3">New project</h2>
          <Field label="Name" name="name"><TextInput name="name" required minLength={2} /></Field>
          <Field label="Customer to bill" name="customer"><select id="customer" name="customer" className="input"><option value="">None</option>{(customers ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Budget (₹)" name="budget"><TextInput name="budget" inputMode="decimal" placeholder="500000" /></Field>
          <div className="sm:col-span-3"><SubmitButton>Create project</SubmitButton></div></form>
      )}
    </>
  );
}
