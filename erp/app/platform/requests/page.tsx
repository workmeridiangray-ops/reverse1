import { withSystem } from "@/lib/db";
import { requirePlatform } from "@/lib/auth/session";
import { PageHead, Badge, Empty } from "@/components/ui";
import { StatusButton } from "@/components/StatusButton";
import { requestStatusAction } from "../actions";
export default async function Requests() {
  await requirePlatform("support"); const rows = await withSystem(async (db) => (await db.query("select * from contact_requests order by (status='new') desc, created_at desc limit 100")).rows);
  return (<><PageHead title="Demo & contact requests" /><div className="card">{rows.length === 0 ? <Empty title="No requests" /> : rows.map((r: any) => <div key={r.id} style={{ borderBottom: "1px solid var(--border)", padding: "8px 0" }}><p><strong>{r.name}</strong> &lt;{r.email}&gt; {r.company && `· ${r.company}`} <Badge status={r.status === "new" ? "pending" : r.status === "closed" ? "done" : "info"} label={`${r.kind} · ${r.status}`} /></p><p className="muted" style={{ whiteSpace: "pre-wrap" }}>{r.message}</p>
    {r.status !== "closed" && <span className="row">{r.status === "new" && <StatusButton className="btn sm" action={requestStatusAction.bind(null, r.id, "contacted")} label="Mark contacted" />}<StatusButton className="btn sm" action={requestStatusAction.bind(null, r.id, "closed")} label="Close" /></span>}</div>)}</div></>);
}
