import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCtx, can } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Empty, Money, PageHeader, Qty, Table } from "@/components/ui/kit";
import { REPORTS, loadReport } from "./defs";

export const metadata: Metadata = { title: "Reports" };

export default async function Reports({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const q = await searchParams; const ctx = await requireCtx();
  if (!can(ctx.role, "owner", "manager", "accountant", "viewer")) redirect("/app");
  const key = REPORTS.find((r) => r.key === q.r)?.key ?? "ar";
  const def = REPORTS.find((r) => r.key === key)!;
  const sb = await createClient();
  const rows = await loadReport(sb, key);
  const fresh = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  return (
    <>
      <PageHeader title="Reports" sub={`${def.title} — ${def.basis} Data as of ${fresh}.`} actions={<Link className="btn" href={`/app/reports/export?r=${key}`}>Download CSV</Link>} />
      <nav aria-label="Reports" className="mb-4 flex flex-wrap gap-2">{REPORTS.map((r) => <Link key={r.key} className={`btn ${r.key === key ? "btn-primary" : ""}`} href={`/app/reports?r=${r.key}`}>{r.title}</Link>)}</nav>
      {rows.length ? (
        <Table head={def.columns.map((c) => c.label)} numeric={def.columns.map((c, i) => (c.type === "money" || c.type === "qty" ? i : -1)).filter((i) => i >= 0)}>
          {rows.map((r, i) => <tr key={i}>{def.columns.map((c) => <td key={c.key} className={`td ${c.type === "money" || c.type === "qty" ? "num" : ""}`}>
            {c.type === "money" ? <Money paise={Number(r[c.key])} /> : c.type === "qty" ? <Qty v={r[c.key] as number} /> : String(r[c.key] ?? "—")}</td>)}</tr>)}
          {def.totalKey && <tr className="font-semibold"><td className="td" colSpan={def.columns.length - 1}>Total</td><td className="td num"><Money paise={rows.reduce((a, r) => a + Number(r[def.totalKey!]), 0)} /></td></tr>}
        </Table>
      ) : <Empty title="Nothing to report yet" hint="This report fills in as transactions are posted." />}
    </>
  );
}
