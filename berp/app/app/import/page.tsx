import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireCtx, can } from "@/lib/session";
import { Flash, PageHeader } from "@/components/ui/kit";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { TEMPLATES } from "@/lib/rules/csv";
import { importCsv, validateCsv } from "../actions2";

export const metadata: Metadata = { title: "Import data" };

export default async function Import({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; checked?: string; done?: string; kind?: string }> }) {
  const q = await searchParams; const ctx = await requireCtx();
  if (!can(ctx.role, "owner", "manager")) redirect("/app");
  return (
    <>
      <PageHeader title="Import data" sub="Upload a CSV for customers, suppliers or items. Files are checked first; if any row has a problem, nothing is imported." />
      <Flash ok={q.checked ? `All ${q.checked} rows are valid.` : q.done ? `Imported ${q.done} ${q.kind}.` : q.ok} error={q.error} />
      <form encType="multipart/form-data" className="card max-w-xl space-y-4 p-6">
        <label className="block text-sm font-medium">What are you importing?
          <select name="kind" className="input mt-1"><option value="customers">Customers</option><option value="suppliers">Suppliers</option><option value="items">Items and services</option></select></label>
        <label className="block text-sm font-medium">CSV file (UTF-8, up to 2,000 rows)<input type="file" name="file" accept=".csv,text/csv" required className="input mt-1 py-2" /></label>
        <div className="flex gap-2"><button className="btn" formAction={validateCsv}>Validate only</button><button className="btn btn-primary" formAction={importCsv}>Import</button></div>
      </form>
      <h2 className="mb-2 mt-8 font-semibold">Column templates</h2>
      <div className="grid gap-3 md:grid-cols-3">{Object.entries(TEMPLATES).map(([k, cols]) => <div key={k} className="card p-4"><p className="font-medium capitalize">{k}</p><p className="mt-1 font-mono text-xs">{cols.join(",")}</p></div>)}</div>
      <p className="mt-4 max-w-prose text-sm text-muted">Amounts are in rupees (e.g. 1250.50). Items need an existing <code>tax_code</code> such as GST18. Existing SKUs or names are rejected, not overwritten.</p>
    </>
  );
}
