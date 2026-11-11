import { plat } from "@/lib/server/db";
import { requirePlatform } from "@/lib/server/auth";
import { Page, DataTable, Filters, Pager, dt } from "@/components/ui";
import { PER, pg } from "@/lib/server/read";
export const metadata = { title: "Platform audit" };
export default async function P({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requirePlatform("support", "billing", "techops"); const sp = await searchParams; const page = pg(sp);
  const p: unknown[] = []; let w = "true"; if (sp.q) { p.push(`%${sp.q}%`); w = "(action ilike $1 or actor_label ilike $1 or entity ilike $1 or reason ilike $1)"; }
  const rows = (await plat(`select a.*, c.name company from audit_log a left join companies c on c.id=a.company_id where ${w} order by at desc limit ${PER} offset ${(page - 1) * PER}`, p)).rows; const total = Number((await plat(`select count(*) n from audit_log a where ${w}`, p)).rows[0].n);
  return <Page title="Audit log" sub="Critical events across all businesses (metadata only)."><Filters action="/admin/audit" q={sp.q} /><DataTable rows={rows} empty="Nothing." cols={[{ h: "When", r: (r: any) => dt(r.at) }, { h: "Business", r: (r: any) => r.company ?? "—", hideSm: true }, { h: "Actor", r: (r: any) => r.actor_label ?? r.user_id?.slice(0, 8) ?? "system", hideSm: true }, { h: "Action", r: (r: any) => r.action }, { h: "Reason", r: (r: any) => r.reason ?? "" }]} /><Pager page={page} total={total} per={PER} base={`/admin/audit?q=${sp.q ?? ""}`} /></Page>;
}
