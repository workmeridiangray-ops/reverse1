import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Badge } from "@/components/ui";
import { trialBalance } from "@/lib/erp/finance";
import { formatMoney } from "@/lib/money";
export default async function Accounts() {
  const ctx = await requireTenant("finance.view");
  const rows = await withTenantSystem(ctx.tenant.id, (db) => trialBalance(db, ctx.tenant.id, "9999-12-31"));
  return (<><PageHead title="Chart of accounts" crumbs={[["Finance"], ["Accounts"]]} sub="Posting rules map each document to these accounts. The structure is fixed to keep accounting semantics safe; new accounts need technical review." />
    <div className="card flush tablewrap"><table className="stack-sm"><thead><tr><th>Code</th><th>Name</th><th>Type</th><th className="num">Balance</th></tr></thead><tbody>
      {rows.map((a) => { const bal = ["asset", "expense"].includes(a.type) ? a.debit - a.credit : a.credit - a.debit; return <tr key={a.id}><td data-label="Code">{a.code}</td><td data-label="Name"><Link href={`/app/finance/accounts/${a.id}`}>{a.name}</Link></td><td data-label="Type"><Badge status="draft" label={a.type} /></td><td data-label="Balance" className="num">{formatMoney(bal)}</td></tr>; })}</tbody></table></div></>);
}
