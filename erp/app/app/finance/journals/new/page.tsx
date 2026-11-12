import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { journalAction } from "../../actions";
export default async function NewJournal() {
  const ctx = await requireTenant("finance.journal");
  const accts = await withTenantSystem(ctx.tenant.id, async (db) => (await db.query("select id, code||' — '||name n from accounts where tenant_id=$1 and status='active' order by code", [ctx.tenant.id])).rows);
  return (<><PageHead title="New manual journal" crumbs={[["Finance"], ["Journals", "/app/finance/journals"], ["New"]]} sub="Saved as a draft. Debits must equal credits. A different approver posts it." />
    <ActionForm action={journalAction} submit="Save draft journal"><div className="card"><div className="grid g2"><Field name="entry_date" label="Date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /><Field name="memo" label="Description" required /></div>
      <div className="tablewrap"><table><thead><tr><th>Account</th><th className="num">Debit (₹)</th><th className="num">Credit (₹)</th></tr></thead><tbody>
        {Array.from({ length: 6 }).map((_, i) => <tr key={i}><td><select aria-label={`Line ${i + 1} account`} name={`acct_${i}`} defaultValue=""><option value="">—</option>{accts.map((a: any) => <option key={a.id} value={a.id}>{a.n}</option>)}</select></td><td><input aria-label={`Line ${i + 1} debit`} name={`dr_${i}`} inputMode="decimal" /></td><td><input aria-label={`Line ${i + 1} credit`} name={`cr_${i}`} inputMode="decimal" /></td></tr>)}</tbody></table></div></div></ActionForm></>);
}
