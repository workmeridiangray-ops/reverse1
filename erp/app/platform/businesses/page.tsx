import Link from "next/link";
import { withSystem } from "@/lib/db";
import { requirePlatform } from "@/lib/auth/session";
import { PageHead, Badge, Pager, Empty } from "@/components/ui";
import { Filters } from "@/components/Filters";
import { paging, like, sp1, pages, type SP } from "@/lib/list";
export default async function Businesses({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePlatform(); const sp = await searchParams; const q = sp1(sp.q), status = sp1(sp.status); const { page, limit, offset } = paging(sp);
  const d = await withSystem(async (db) => { const a: any[] = []; const w = ["true"]; if (q) { a.push(like(q)); w.push(`(t.name ilike $${a.length} or t.slug ilike $${a.length})`); } if (status) { a.push(status); w.push(`t.status=$${a.length}`); }
    return { total: Number((await db.query(`select count(*) c from tenants t where ${w.join(" and ")}`, a)).rows[0].c), rows: (await db.query(`select t.*, p.name plan, s.status sub_status, (select count(*) from memberships m where m.tenant_id=t.id and m.status='active') users from tenants t left join subscriptions s on s.tenant_id=t.id and s.status in ('trialing','active','past_due') left join plan_versions pv on pv.id=s.plan_version_id left join plans p on p.id=pv.plan_id where ${w.join(" and ")} order by t.created_at desc limit ${limit} offset ${offset}`, a)).rows }; });
  return (<><PageHead title="Businesses" /><Filters action="/platform/businesses" q={q} status={status} statuses={["trial", "active", "past_due", "suspended", "cancelled", "closed"]} />
    <div className="card flush">{d.rows.length === 0 ? <Empty title="No companies match" /> : <div className="tablewrap"><table className="stack-sm"><thead><tr><th>Company</th><th>Status</th><th>Plan</th><th className="num">Users</th><th>Created</th></tr></thead><tbody>
      {d.rows.map((t: any) => <tr key={t.id}><td data-label="Company"><Link href={`/platform/businesses/${t.id}`}>{t.name}</Link></td><td data-label="Status"><Badge status={t.status} /></td><td data-label="Plan">{t.plan ?? "—"} {t.sub_status && <span className="muted small">({t.sub_status})</span>}</td><td data-label="Users" className="num">{t.users}</td><td data-label="Created">{new Date(t.created_at).toLocaleDateString("en-IN")}</td></tr>)}</tbody></table></div>}
      <Pager page={page} pages={pages(d.total)} total={d.total} base="/platform/businesses" params={{ q, status }} /></div></>);
}
