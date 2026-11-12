import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Badge, Empty } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { decideAction, delegateAction } from "./actions";
import { formatMoney } from "@/lib/money";
const LINK: Record<string, string> = { quote: "/app/sales/quotes", purchase_order: "/app/procurement/orders", purchase_request: "/app/procurement/requests", supplier_bill: "/app/procurement/bills", expense: "/app/finance/expenses", stock_adjustment: "/app/inventory/counts" };
export default async function Approvals() {
  const ctx = await requireTenant("approvals.decide");
  const d = await withTenantSystem(ctx.tenant.id, async (db) => ({
    pending: (await db.query(`select a.*, u.name requester from approval_requests a join users u on u.id=a.requested_by where a.tenant_id=$1 and a.status='pending' and (a.approver_permission = any($2) or a.delegated_to=$3) order by a.created_at`, [ctx.tenant.id, [...ctx.perms], ctx.user.id])).rows,
    mine: (await db.query("select * from approval_requests where tenant_id=$1 and requested_by=$2 order by created_at desc limit 15", [ctx.tenant.id, ctx.user.id])).rows,
    done: (await db.query("select a.*, u.name decider from approval_requests a left join users u on u.id=a.decided_by where a.tenant_id=$1 and a.status in ('approved','rejected') order by a.decided_at desc limit 15", [ctx.tenant.id])).rows,
    people: (await db.query("select u.id, u.name from memberships m join users u on u.id=m.user_id where m.tenant_id=$1 and m.status='active' and m.user_id <> $2 order by u.name", [ctx.tenant.id, ctx.user.id])).rows }));
  return (<><PageHead title="Approval inbox" crumbs={[["Approvals"]]} sub="Review the amount and impact, then approve or reject. Rejections need a reason." />
    {d.pending.length === 0 ? <div className="card"><Empty title="Nothing waiting">You’re all caught up.</Empty></div> : d.pending.map((a: any) => (
      <div className="card" key={a.id}><div className="row between"><h3><Link href={`${LINK[a.entity_type] ?? "/app"}/${["quote", "purchase_order", "purchase_request", "supplier_bill"].includes(a.entity_type) ? a.entity_id : ""}`}>{a.entity_ref}</Link> <span className="muted small">· {a.entity_type.replace("_", " ")}</span></h3><strong>{formatMoney(a.amount_paise)}</strong></div>
        <p className="muted small">Requested by {a.requester} on {new Date(a.created_at).toLocaleString("en-IN")}{a.delegated_to === ctx.user.id && " · delegated to you"}</p>
        <dl className="kv">{Object.entries(a.impact ?? {}).filter(([, v]) => typeof v !== "object").map(([k, v]) => <div key={k} style={{ display: "contents" }}><dt>{k.replace(/_/g, " ")}</dt><dd>{/(total|cost|commitment|value|expense|amount)/.test(k) && typeof v === "number" ? formatMoney(v) : String(v)}</dd></div>)}</dl>
        {a.requested_by === ctx.user.id ? <p className="muted">You requested this, so someone else must decide it.</p> : <div className="grid g2">
          <ActionForm action={decideAction.bind(null, a.id, true)} submit="Approve"><Field name="reason" label="Comment (optional)" /></ActionForm>
          <ActionForm action={decideAction.bind(null, a.id, false)} submit="Reject" danger><Field name="reason" label="Reason for rejection" required /></ActionForm></div>}
        {a.requested_by !== ctx.user.id && <details><summary className="small">Delegate…</summary><ActionForm action={delegateAction.bind(null, a.id)} submit="Delegate"><Field name="to" label="Colleague" type="select"><option value="">Choose…</option>{d.people.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</Field></ActionForm></details>}
      </div>))}
    <div className="grid g2"><div className="card"><h3>Your requests</h3>{d.mine.length === 0 ? <p className="muted">None.</p> : d.mine.map((a: any) => <p key={a.id}>{a.entity_ref} <Badge status={a.status} />{a.reason && <span className="muted small"> — {a.reason}</span>}</p>)}</div>
      <div className="card"><h3>Recent decisions</h3>{d.done.length === 0 ? <p className="muted">None.</p> : d.done.map((a: any) => <p key={a.id}>{a.entity_ref} <Badge status={a.status} /> <span className="muted small">by {a.decider}{a.reason && ` — ${a.reason}`}</span></p>)}</div></div></>);
}
