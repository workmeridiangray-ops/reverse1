import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Badge, Empty } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { addProjectAction } from "../ops-actions";
import { formatMoney } from "@/lib/money";
export default async function Projects() {
  const ctx = await requireTenant("projects.view"); const m = ctx.perms.has("projects.margins");
  const d = await withTenantSystem(ctx.tenant.id, async (db) => ({ rows: (await db.query(`select p.*, c.name customer, coalesce((select sum(amount_paise) from project_costs x where x.project_id=p.id),0) + coalesce((select sum(minutes*cost_rate_paise_per_hour/60) from time_entries t where t.project_id=p.id and t.status='approved'),0) actual from projects p left join customers c on c.id=p.customer_id and c.tenant_id=p.tenant_id where p.tenant_id=$1 order by p.created_at desc`, [ctx.tenant.id])).rows,
    custs: (await db.query("select id, name from customers where tenant_id=$1 and status='active' order by name limit 500", [ctx.tenant.id])).rows }));
  return (<><PageHead title="Projects" crumbs={[["Operations"], ["Projects"]]} sub={m ? "" : "Budgets and costs are hidden for your role."} />
    {ctx.perms.has("projects.manage") && !ctx.readOnlyReason && <details className="drawer"><summary>+ New project</summary><div><ActionForm action={addProjectAction} submit="Create project"><div className="grid g2"><Field name="code" label="Code" required /><Field name="name" label="Name" required /><Field name="customer_id" label="Customer" type="select"><option value="">—</option>{d.custs.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Field>{m && <Field name="budget" label="Budget (₹)" />}</div></ActionForm></div></details>}
    <div className="card flush">{d.rows.length === 0 ? <Empty title="No projects" /> : <div className="tablewrap"><table className="stack-sm"><thead><tr><th>Project</th><th>Customer</th><th>Status</th>{m && <><th className="num">Budget</th><th className="num">Actual cost</th></>}</tr></thead><tbody>
      {d.rows.map((p: any) => <tr key={p.id}><td data-label="Project"><Link href={`/app/projects/${p.id}`}>{p.code} — {p.name}</Link></td><td data-label="Customer">{p.customer ?? "—"}</td><td data-label="Status"><Badge status={p.status} />{m && p.budget_paise > 0 && p.actual > p.budget_paise && <> <span className="badge bad">over budget</span></>}</td>{m && <><td data-label="Budget" className="num">{formatMoney(p.budget_paise)}</td><td data-label="Actual" className="num">{formatMoney(p.actual)}</td></>}</tr>)}</tbody></table></div>}</div></>);
}
