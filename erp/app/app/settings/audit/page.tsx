import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Empty, Pager } from "@/components/ui";
import { Filters } from "@/components/Filters";
import { paging, like, sp1, pages, type SP } from "@/lib/list";
export default async function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireTenant("audit.view"); const sp = await searchParams; const q = sp1(sp.q); const { page, limit, offset } = paging(sp);
  const d = await withTenantSystem(ctx.tenant.id, async (db) => {
    const a: any[] = [ctx.tenant.id]; let w = "a.tenant_id=$1"; if (q) { a.push(like(q)); w += ` and (a.action ilike $2 or a.entity_type ilike $2 or a.reason ilike $2 or u.name ilike $2)`; }
    const from = `from audit_log a left join users u on u.id=a.actor_user_id where ${w}`;
    return { total: Number((await db.query(`select count(*) c ${from}`, a)).rows[0].c), rows: (await db.query(`select a.*, u.name actor ${from} order by a.id desc limit ${limit} offset ${offset}`, a)).rows };
  });
  return (<><PageHead title="Audit trail" crumbs={[["Company"], ["Audit"]]} sub="Append-only. Even administrators cannot edit or delete entries.">{ctx.perms.has("reports.export") && <a className="btn" href="/app/export/audit">Download CSV</a>}</PageHead>
    <Filters action="/app/settings/audit" q={q} />
    <div className="card flush">{d.rows.length === 0 ? <Empty title="No entries" /> : <div className="tablewrap"><table className="stack-sm"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Reason</th></tr></thead><tbody>
      {d.rows.map((r: any) => <tr key={r.id}><td data-label="When">{new Date(r.created_at).toLocaleString("en-IN")}</td><td data-label="Who">{r.actor ?? r.actor_label ?? "system"}</td><td data-label="Action">{r.action}</td><td data-label="Record">{r.entity_type} {r.entity_id?.slice(0, 8)}</td><td data-label="Reason">{r.reason ?? ""}</td></tr>)}</tbody></table></div>}
      <Pager page={page} pages={pages(d.total)} total={d.total} base="/app/settings/audit" params={{ q }} /></div></>);
}
