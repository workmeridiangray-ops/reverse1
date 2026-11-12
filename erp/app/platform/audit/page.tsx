import { withSystem } from "@/lib/db";
import { requirePlatform } from "@/lib/auth/session";
import { PageHead, Pager } from "@/components/ui";
import { Filters } from "@/components/Filters";
import { paging, like, sp1, pages, type SP } from "@/lib/list";
export default async function PAudit({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePlatform("support", "billing", "tech"); const sp = await searchParams; const q = sp1(sp.q); const { page, limit, offset } = paging(sp);
  const d = await withSystem(async (db) => { const a: any[] = []; let w = "true"; if (q) { a.push(like(q)); w = "(a.action ilike $1 or a.actor_label ilike $1 or t.name ilike $1)"; } const from = `from audit_log a left join tenants t on t.id=a.tenant_id where ${w}`;
    return { total: Number((await db.query(`select count(*) c ${from}`, a)).rows[0].c), rows: (await db.query(`select a.*, t.name tname ${from} order by a.id desc limit ${limit} offset ${offset}`, a)).rows }; });
  return (<><PageHead title="Audit log" sub="Append-only record of platform and company events." /><Filters action="/platform/audit" q={q} />
    <div className="card flush tablewrap"><table className="stack-sm"><thead><tr><th>When</th><th>Company</th><th>Actor</th><th>Action</th><th>Reason</th></tr></thead><tbody>{d.rows.map((r: any) => <tr key={r.id}><td data-label="When">{new Date(r.created_at).toLocaleString("en-IN")}</td><td data-label="Company">{r.tname ?? "—"}</td><td data-label="Actor">{r.actor_label ?? r.actor_user_id?.slice(0, 8) ?? "system"}</td><td data-label="Action">{r.action}</td><td data-label="Reason">{r.reason ?? ""}</td></tr>)}</tbody></table>
      <Pager page={page} pages={pages(d.total)} total={d.total} base="/platform/audit" params={{ q }} /></div></>);
}
