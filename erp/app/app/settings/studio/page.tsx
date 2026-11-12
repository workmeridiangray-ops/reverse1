import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Badge, Alert } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { StatusButton } from "@/components/StatusButton";
import { PERMISSIONS } from "@/lib/perms";
import { addRuleAction, retireRuleAction, addCustomFieldAction, retireFieldAction, numberingAction } from "../actions";
import { formatMoney } from "@/lib/money";
const TYPES = ["quote", "purchase_request", "purchase_order", "expense", "stock_adjustment"];
export default async function Studio() {
  const ctx = await requireTenant("config.manage");
  const d = await withTenantSystem(ctx.tenant.id, async (db) => ({ rules: (await db.query("select * from approval_rules where tenant_id=$1 order by status, entity_type, min_amount_paise", [ctx.tenant.id])).rows,
    fields: (await db.query("select * from custom_fields where tenant_id=$1 order by entity, key", [ctx.tenant.id])).rows, seq: (await db.query("select * from number_sequences where tenant_id=$1 order by key", [ctx.tenant.id])).rows }));
  return (<><PageHead title="Approval & configuration studio" crumbs={[["Company"], ["Studio"]]} sub="Bounded settings: amount thresholds, custom fields and numbering. Accounting semantics and logic cannot be redefined here." />
    <Alert tone="info">Changes apply to <strong>new</strong> submissions from the moment you publish. Requests already waiting keep the routing they were submitted with.</Alert>
    <div className="card"><h2>Approval rules</h2><div className="tablewrap"><table className="stack-sm"><thead><tr><th>Document</th><th className="num">From amount</th><th>Approver needs</th><th>Status</th><th></th></tr></thead><tbody>
      {d.rules.map((r: any) => <tr key={r.id}><td data-label="Document">{r.entity_type.replace("_", " ")}</td><td data-label="From" className="num">{formatMoney(r.min_amount_paise)}</td><td data-label="Approver">{PERMISSIONS[r.approver_permission] ?? r.approver_permission}</td><td data-label="Status"><Badge status={r.status} /></td><td>{r.status === "active" && <StatusButton className="btn sm" action={retireRuleAction.bind(null, r.id)} label="Retire" />}</td></tr>)}</tbody></table></div>
      <p className="small muted">The highest threshold at or below the amount applies. Supplier-bill exceptions and journals always follow fixed controls.</p>
      <ActionForm action={addRuleAction} submit="Publish rule" resetOnSuccess><div className="grid g3"><Field name="entity_type" label="Document" type="select">{TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}</Field><Field name="min_amount" label="Applies from (₹)" defaultValue="50000" /><Field name="permission" label="Approver permission" type="select"><option value="sales.approve">Approve quotations</option><option value="procurement.approve">Approve purchasing</option><option value="finance.approve">Approve finance items</option><option value="inventory.adjust">Adjust stock</option></Field></div></ActionForm></div>
    <div className="card"><h2>Custom fields</h2>{d.fields.length === 0 ? <p className="muted">None yet.</p> : <ul>{d.fields.map((f: any) => <li key={f.id}>{f.entity}: <strong>{f.label}</strong> ({f.key}, {f.kind}) <Badge status={f.status} /> {f.status === "active" && <StatusButton className="btn sm ghost" action={retireFieldAction.bind(null, f.id)} label="Hide" />}</li>)}</ul>}
      <ActionForm action={addCustomFieldAction} submit="Add field" resetOnSuccess><div className="grid g4"><Field name="entity" label="On" type="select"><option value="customers">Customers</option><option value="suppliers">Suppliers</option><option value="items">Items</option></Field><Field name="key" label="Key" placeholder="region_code" /><Field name="label" label="Label" /><Field name="kind" label="Type" type="select"><option value="text">Text</option><option value="number">Number</option><option value="date">Date</option></Field></div></ActionForm></div>
    <div className="card"><h2>Document numbering</h2><ActionForm action={numberingAction} submit="Save prefixes"><div className="grid g4">{d.seq.map((s: any) => <Field key={s.key} name={`pfx_${s.key}`} label={`${s.key.replace(/_/g, " ")} (next ${s.next_no})`} defaultValue={s.prefix} />)}</div></ActionForm></div></>);
}
