import { withSystem } from "@/lib/db";
import { requirePlatform } from "@/lib/auth/session";
import { PageHead, Badge } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { newPlanVersionAction } from "../actions";
import { formatMoney } from "@/lib/money";
export default async function Plans() {
  await requirePlatform("billing");
  const d = await withSystem(async (db) => ({ plans: (await db.query("select * from plans order by key")).rows, vers: (await db.query("select pv.*, (select count(*) from subscriptions s where s.plan_version_id=pv.id and s.status in ('trialing','active','past_due')) subs from plan_versions pv order by plan_id, version desc")).rows }));
  return (<><PageHead title="Plans & versions" sub="Publishing a new version applies to new sales and plan changes only; existing subscribers keep their version and historical invoices are unchanged." />
    {d.plans.map((p: any) => (<div className="card" key={p.id}><h2>{p.name}</h2><div className="tablewrap"><table><thead><tr><th>Version</th><th className="num">Monthly</th><th className="num">Yearly</th><th className="num">Users</th><th className="num">Branches</th><th className="num">Storage MB</th><th className="num">Subscribers</th><th>State</th></tr></thead><tbody>
      {d.vers.filter((v: any) => v.plan_id === p.id).map((v: any) => <tr key={v.id}><td>v{v.version}</td><td className="num">{formatMoney(v.price_monthly_paise)}</td><td className="num">{formatMoney(v.price_yearly_paise)}</td><td className="num">{v.max_users}</td><td className="num">{v.max_branches}</td><td className="num">{v.max_storage_mb}</td><td className="num">{v.subs}</td><td>{v.retired_at ? <Badge status="draft" label="superseded" /> : <Badge status="active" label="current" />}</td></tr>)}</tbody></table></div>
      <details><summary className="btn sm">Publish new version</summary><ActionForm action={newPlanVersionAction.bind(null, p.id)} submit="Publish version"><div className="grid g3"><Field name="monthly" label="Monthly ₹" required /><Field name="yearly" label="Yearly ₹" required /><Field name="users" label="Max users" defaultValue="25" /><Field name="branches" label="Max branches" defaultValue="5" /><Field name="storage" label="Storage MB" defaultValue="10240" /></div></ActionForm></details></div>))}</>);
}
