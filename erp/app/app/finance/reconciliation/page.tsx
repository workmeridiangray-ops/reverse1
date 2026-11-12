import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Badge } from "@/components/ui";
import { reconciliation } from "@/lib/erp/finance";
import { formatMoney } from "@/lib/money";
export default async function Recon() {
  const ctx = await requireTenant("finance.view");
  const rows = await withTenantSystem(ctx.tenant.id, (db) => reconciliation(db, ctx.tenant.id));
  const count = (c: string) => c.includes("(count)");
  return (<><PageHead title="Reconciliation" crumbs={[["Finance"], ["Reconciliation"]]} sub={`Operational records against the ledger, live as of ${new Date().toLocaleString("en-IN")}.`} />
    <div className="card flush tablewrap"><table className="stack-sm"><thead><tr><th>Check</th><th className="num">Ledger</th><th className="num">Sub-ledger</th><th className="num">Difference</th><th>Result</th></tr></thead><tbody>
      {rows.map((r) => <tr key={r.check}><td data-label="Check">{r.check}</td><td data-label="Ledger" className="num">{count(r.check) ? r.ledger : formatMoney(r.ledger)}</td><td data-label="Sub-ledger" className="num">{count(r.check) ? r.subledger : formatMoney(r.subledger)}</td><td data-label="Difference" className="num">{count(r.check) ? r.diff : formatMoney(r.diff)}</td><td data-label="Result">{r.diff === 0 ? <Badge status="posted" label="Agrees" /> : <Badge status="exception" label="Investigate" />}</td></tr>)}</tbody></table></div></>);
}
