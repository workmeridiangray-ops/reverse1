import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Badge } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { TEMPLATES } from "@/lib/erp/import";
import { importAction } from "./actions";
export default async function Import() {
  const ctx = await requireTenant("masters.manage");
  const batches = await withTenantSystem(ctx.tenant.id, async (db) => (await db.query("select * from import_batches where tenant_id=$1 order by created_at desc limit 10", [ctx.tenant.id])).rows);
  return (<><PageHead title="Import from CSV" crumbs={[["Master data"], ["Import"]]} sub="Rows are checked first. If any row is invalid nothing is imported, and each error names its line." />
    <div className="card"><h2>Templates</h2><p>{Object.keys(TEMPLATES).map((k) => <a key={k} className="btn sm" style={{ marginRight: 8 }} href={`/app/import/template/${k}`}>{k.replace("_", " ")}.csv</a>)}</p></div>
    <div className="card"><ActionForm action={importAction} submit="Check file" guard={false}><div className="grid g2"><Field name="kind" label="What are you importing?" type="select">{Object.keys(TEMPLATES).map((k) => <option key={k} value={k}>{k.replace("_", " ")}</option>)}</Field><Field name="mode" label="Mode" type="select"><option value="preview">Preview only (nothing saved)</option><option value="commit">Import now</option></Field></div>
      <div className="field"><label className="f" htmlFor="file">CSV file (max 2 MB, 5,000 rows)</label><input id="file" name="file" type="file" accept=".csv,text/csv" required /></div></ActionForm></div>
    <div className="card"><h2>Recent imports</h2>{batches.length === 0 ? <p className="muted">None.</p> : batches.map((b: any) => <p key={b.id}>{new Date(b.created_at).toLocaleString("en-IN")} · {b.kind} · {b.filename} · {b.rows_ok}/{b.rows_total} ok {b.rows_failed > 0 && <Badge status="failed" label={`${b.rows_failed} failed`} />}</p>)}</div></>);
}
