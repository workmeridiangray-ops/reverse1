import type { Metadata } from "next";
import { requireCtx, can } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Flash, Money, PageHeader, Table } from "@/components/ui/kit";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { closePeriod, manualJournal, reverseJournal } from "../actions";

export const metadata: Metadata = { title: "Finance" };

export default async function Finance({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const q = await searchParams; const ctx = await requireCtx();
  if (!can(ctx.role, "owner", "manager", "accountant", "viewer")) redirect("/app");
  const sb = await createClient();
  const [{ data: tb }, { data: je }, { data: lock }, { data: accts }] = await Promise.all([
    sb.from("trial_balance").select("*").order("code"),
    sb.from("journal_entries").select("id,number,entry_date,memo,source_type,reverses_id, journal_lines(debit_paise,credit_paise)").order("created_at", { ascending: false }).limit(25),
    sb.from("period_locks").select("locked_through").maybeSingle(),
    sb.from("accounts").select("code,name").eq("active", true).order("code"),
  ]);
  const dr = (tb ?? []).reduce((a: number, r: any) => a + Number(r.debit_paise), 0), cr = (tb ?? []).reduce((a: number, r: any) => a + Number(r.credit_paise), 0);
  const post = can(ctx.role, "owner", "accountant");
  const income = (tb ?? []).filter((r: any) => r.type === "income").reduce((a: number, r: any) => a - Number(r.balance_paise), 0);
  const expense = (tb ?? []).filter((r: any) => r.type === "expense").reduce((a: number, r: any) => a + Number(r.balance_paise), 0);
  return (
    <>
      <PageHeader title="Finance" sub={lock ? `Books are closed through ${lock.locked_through}.` : "No period is closed yet."} />
      <Flash ok={q.ok} error={q.error} />
      <h2 className="mb-2 font-semibold">Trial balance</h2>
      <Table head={["Code", "Account", "Type", "Debit", "Credit", "Balance (Dr+ / Cr−)"]} numeric={[3, 4, 5]}>
        {(tb ?? []).map((r: any) => <tr key={r.account_id}><td className="td font-mono">{r.code}</td><td className="td">{r.name}</td><td className="td">{r.type}</td><td className="td num"><Money paise={Number(r.debit_paise)} /></td><td className="td num"><Money paise={Number(r.credit_paise)} /></td><td className="td num"><Money paise={Number(r.balance_paise)} /></td></tr>)}
        <tr className="font-semibold"><td className="td" colSpan={3}>Totals {dr === cr ? "(balanced)" : "(OUT OF BALANCE)"}</td><td className="td num"><Money paise={dr} /></td><td className="td num"><Money paise={cr} /></td><td className="td" /></tr>
      </Table>
      <p className="mt-3 text-sm">Profit and loss to date: income <Money paise={income} /> − expenses <Money paise={expense} /> = <strong><Money paise={income - expense} /></strong>. Margins use moving item cost at dispatch.</p>
      <h2 className="mb-2 mt-8 font-semibold">Recent journal entries</h2>
      <Table head={["Entry", "Date", "Source", "Memo", "Amount", ""]} numeric={[4]}>
        {(je ?? []).map((e: any) => <tr key={e.id}><td className="td font-mono">{e.number}</td><td className="td">{e.entry_date}</td><td className="td">{e.source_type}{e.reverses_id ? " (reversal)" : ""}</td><td className="td">{e.memo}</td>
          <td className="td num"><Money paise={(e.journal_lines ?? []).reduce((a: number, l: any) => a + Number(l.debit_paise), 0)} /></td>
          <td className="td">{post && e.source_type === "manual" && !e.reverses_id && (
            <form action={reverseJournal} className="flex gap-2"><input type="hidden" name="id" value={e.id} /><input name="reason" required minLength={5} placeholder="Reason" aria-label={`Reason to reverse ${e.number}`} className="input" /><SubmitButton variant="plain">Reverse</SubmitButton></form>)}</td></tr>)}
      </Table>
      {post && (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <form action={manualJournal} className="card space-y-3 p-5"><h2 className="font-semibold">Manual journal</h2>
            <input name="date" type="date" required className="input" aria-label="Date" defaultValue={new Date().toISOString().slice(0, 10)} /><input name="memo" required minLength={3} placeholder="Memo" aria-label="Memo" className="input" />
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="grid grid-cols-[1fr_6rem_6rem] gap-2"><select name={`acc_${i}`} className="input" aria-label={`Line ${i + 1} account`}><option value="">—</option>{(accts ?? []).map((a: any) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}</select>
                <input name={`dr_${i}`} className="input" inputMode="decimal" placeholder="Debit" aria-label={`Line ${i + 1} debit`} /><input name={`cr_${i}`} className="input" inputMode="decimal" placeholder="Credit" aria-label={`Line ${i + 1} credit`} /></div>))}
            <SubmitButton>Post journal</SubmitButton></form>
          <form action={closePeriod} className="card space-y-3 p-5"><h2 className="font-semibold">Close period</h2><p className="text-sm text-muted">Nothing can be posted on or before this date afterwards. This cannot be undone from the app.</p>
            <input name="through" type="date" required className="input" aria-label="Close through" /><SubmitButton variant="danger">Close period</SubmitButton></form>
        </div>
      )}
    </>
  );
}
