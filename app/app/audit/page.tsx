import { requireCompany } from "@/lib/server/auth";
import { plat } from "@/lib/server/db";
import { Page, DataTable, Filters, Pager, LinkBtn, dt } from "@/components/ui";
import { PER, pg } from "@/lib/server/read";
export const metadata = { title: "Audit trail" };
export default async function P({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const a = await requireCompany("audit.read"); const sp = await searchParams; const page = pg(sp);
  const p: unknown[] = [a.company.id]; let w = "company_id=$1"; if (sp.q) { p.push(`%${sp.q}%`); w += " and (action ilike $2 or actor_label ilike $2 or entity ilike $2 or reason ilike $2)"; }
  const rows = (await plat(`select * from audit_log where ${w} order by at desc limit ${PER} offset ${(page - 1) * PER}`, p)).rows; const total = Number((await plat(`select count(*) n from audit_log where ${w}`, p)).rows[0].n);
  return <Page title="Audit trail" sub="Append-only record of sensitive changes: who, what, when and why." actions={<LinkBtn href="/api/export/audit">Export CSV</LinkBtn>}>
    <Filters action="/app/audit" q={sp.q} /><DataTable rows={rows} empty="Nothing recorded." cols={[{ h: "When", r: (r: any) => dt(r.at) }, { h: "Who", r: (r: any) => r.actor_label ?? "system", hideSm: true }, { h: "Action", r: (r: any) => r.action }, { h: "Record", r: (r: any) => r.entity ?? "—", hideSm: true }, { h: "Reason / detail", r: (r: any) => r.reason ?? (Object.keys(r.detail ?? {}).length ? JSON.stringify(r.detail).slice(0, 80) : "") }]} />
    <Pager page={page} total={total} per={PER} base={`/app/audit?q=${sp.q ?? ""}`} /></Page>;
}
