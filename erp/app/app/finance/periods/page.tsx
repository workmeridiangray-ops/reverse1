import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Badge } from "@/components/ui";
import { StatusButton } from "@/components/StatusButton";
import { ActionForm, Field } from "@/components/ActionForm";
import { closePeriodAction, reopenPeriodAction } from "../actions";
export default async function Periods() {
  const ctx = await requireTenant("finance.view");
  const rows = await withTenantSystem(ctx.tenant.id, async (db) => (await db.query("select * from fin_periods where tenant_id=$1 order by starts_on", [ctx.tenant.id])).rows);
  const can = ctx.perms.has("finance.period") && !ctx.readOnlyReason; const lastClosed = [...rows].reverse().find((r: any) => r.status === "closed");
  return (<><PageHead title="Financial periods" crumbs={[["Finance"], ["Periods"]]} sub="Closing a period locks it: no document can post into it. Close in order; reopening needs a reason and is audited." />
    <div className="card flush tablewrap"><table className="stack-sm"><thead><tr><th>Period</th><th>From</th><th>To</th><th>Status</th><th></th></tr></thead><tbody>
      {rows.map((p: any) => <tr key={p.id}><td data-label="Period">{p.label}</td><td data-label="From">{p.starts_on}</td><td data-label="To">{p.ends_on}</td><td data-label="Status"><Badge status={p.status === "closed" ? "void" : "active"} label={p.status} /></td>
        <td>{can && p.status === "open" && <StatusButton className="btn sm" action={closePeriodAction.bind(null, p.id)} label="Close period" confirm={`Close ${p.label}? Nothing will be able to post into it.`} />}
          {can && p.status === "closed" && lastClosed?.id === p.id && <details><summary className="btn sm">Reopen</summary><ActionForm action={reopenPeriodAction.bind(null, p.id)} submit="Reopen period"><Field name="reason" label="Reason" required /></ActionForm></details>}</td></tr>)}</tbody></table></div></>);
}
