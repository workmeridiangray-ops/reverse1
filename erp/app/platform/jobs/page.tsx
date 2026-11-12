import { withSystem } from "@/lib/db";
import { requirePlatform } from "@/lib/auth/session";
import { PageHead, Badge, Empty } from "@/components/ui";
import { StatusButton } from "@/components/StatusButton";
import { retryJobAction } from "../actions";
export default async function Jobs() {
  const c = await requirePlatform("tech", "support"); const can = ["owner", "tech"].includes(c.user.platformRole!);
  const rows = await withSystem(async (db) => (await db.query("select id, kind, status, attempts, max_attempts, last_error, run_at, created_at, tenant_id from jobs where status in ('failed','dead') or (status in ('queued','running') and run_at < now() - interval '10 minutes') order by created_at desc limit 100")).rows);
  return (<><PageHead title="Jobs & failures" sub="Payload contents are not shown. Retrying is safe: jobs are idempotent and deduplicated." />
    <div className="card flush">{rows.length === 0 ? <Empty title="No failed or stuck jobs" /> : <div className="tablewrap"><table className="stack-sm"><thead><tr><th>Kind</th><th>Status</th><th>Attempts</th><th>Last error</th><th>Created</th><th></th></tr></thead><tbody>
      {rows.map((j: any) => <tr key={j.id}><td data-label="Kind">{j.kind}</td><td data-label="Status"><Badge status={j.status} /></td><td data-label="Attempts">{j.attempts}/{j.max_attempts}</td><td data-label="Error">{j.last_error ?? "—"}</td><td data-label="Created">{new Date(j.created_at).toLocaleString("en-IN")}</td><td>{can && ["failed", "dead"].includes(j.status) && <StatusButton className="btn sm" action={retryJobAction.bind(null, j.id)} label="Retry" />}</td></tr>)}</tbody></table></div>}</div></>);
}
