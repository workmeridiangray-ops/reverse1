import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx, can } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Flash, Money, PageHeader, Status, Table } from "@/components/ui/kit";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { addMilestone, billMilestone, closeProject, decideEntry, logExpense, logTime } from "../../actions2";

export const metadata: Metadata = { title: "Project" };

export default async function Project({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id } = await params; const q = await searchParams; const ctx = await requireCtx(); const sb = await createClient();
  const { data: p } = await sb.from("projects").select("*, customers(name)").eq("id", id).maybeSingle();
  if (!p) notFound();
  const mgr = can(ctx.role, "owner", "manager");
  const [{ data: ms }, { data: time }, { data: exp }, { data: cost }, { data: svc }, { data: whs }] = await Promise.all([
    sb.from("project_milestones").select("*").eq("project_id", id).order("amount_paise"),
    sb.from("project_time").select("*").eq("project_id", id).order("work_date", { ascending: false }),
    sb.from("project_expenses").select("*").eq("project_id", id).order("spent_on", { ascending: false }),
    sb.from("project_costs").select("*").eq("project_id", id).maybeSingle(),
    sb.from("items").select("id,sku,name").eq("kind", "service").eq("active", true),
    sb.from("warehouses").select("id,name").eq("active", true).limit(1),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const open = p.status === "open";
  const Decide = ({ kind, row }: { kind: string; row: any }) => row.status === "submitted" && mgr && row.user_id !== ctx.userId ? (
    <form action={decideEntry} className="flex flex-wrap items-center gap-2"><input type="hidden" name="project" value={id} /><input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={row.id} />
      {kind === "time" && <input name="rate" inputMode="decimal" placeholder="₹/hour cost" aria-label="Cost rate per hour" className="input w-28" />}
      <input name="reason" placeholder="Reason (to reject)" aria-label="Reason" className="input w-40" />
      <button className="btn btn-primary" name="decision" value="approve">Approve</button><button className="btn btn-danger" name="decision" value="reject">Reject</button></form>) : null;
  return (
    <>
      <PageHeader title={`${p.number} · ${p.name}`} sub={`${p.customers?.name ?? "No customer"} · budget ${(Number(p.budget_paise) / 100).toLocaleString("en-IN")}`} actions={<Status value={p.status} />} />
      <Flash ok={q.ok} error={q.error} />
      {cost ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-4">
          {[["Budget", cost.budget_paise], ["Labour (approved)", cost.labour_paise], ["Expenses (approved)", cost.expense_paise], ["Billed to customer", cost.billed_paise]].map(([l, v]: any) => <div key={l} className="card p-4"><p className="text-sm text-muted">{l}</p><p className="text-xl font-semibold"><Money paise={Number(v)} /></p></div>)}
          <div className="card p-4 sm:col-span-4"><p className="text-sm text-muted">Remaining budget after approved cost</p><p className="text-xl font-semibold"><Money paise={Number(cost.budget_paise) - Number(cost.labour_paise) - Number(cost.expense_paise)} /></p></div>
        </div>) : <p className="mb-6 text-sm text-muted">Cost summary is restricted to owners, managers and accountants.</p>}

      <h2 className="mb-2 font-semibold">Milestones</h2>
      <Table head={["Milestone", "Amount", "Invoice", ""]} numeric={[1]}>
        {(ms ?? []).map((m: any) => <tr key={m.id}><td className="td">{m.name}</td><td className="td num"><Money paise={Number(m.amount_paise)} /></td><td className="td">{m.invoice_id ? <Link className="text-brand underline" href={`/app/invoices/${m.invoice_id}`}>View invoice</Link> : "Not billed"}</td>
          <td className="td">{!m.invoice_id && can(ctx.role, "owner", "manager", "accountant") && p.customer_id && (
            <form action={billMilestone} className="flex flex-wrap gap-2"><input type="hidden" name="project" value={id} /><input type="hidden" name="id" value={m.id} /><input type="hidden" name="warehouse" value={whs?.[0]?.id ?? ""} />
              <select name="item" required aria-label="Service item to bill" className="input w-48">{(svc ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.sku} · {s.name}</option>)}</select><SubmitButton variant="plain">Invoice</SubmitButton></form>)}</td></tr>)}
        {!ms?.length && <tr><td className="td text-muted" colSpan={4}>No milestones.</td></tr>}
      </Table>
      {mgr && open && <form action={addMilestone} className="card mt-3 flex flex-wrap items-end gap-2 p-4"><input type="hidden" name="project" value={id} /><input name="name" required placeholder="Milestone name" aria-label="Milestone name" className="input w-56" /><input name="amount" required inputMode="decimal" placeholder="Amount ₹ (before GST)" aria-label="Amount" className="input w-48" /><SubmitButton variant="plain">Add milestone</SubmitButton></form>}

      <h2 className="mb-2 mt-8 font-semibold">Time</h2>
      <Table head={["Date", "Hours", "Note", "Status", ""]} numeric={[1]}>
        {(time ?? []).map((t: any) => <tr key={t.id}><td className="td">{t.work_date}</td><td className="td num">{t.hours}</td><td className="td">{t.note}</td><td className="td"><Status value={t.status} />{t.decision_reason && <span className="ml-2 text-xs text-muted">{t.decision_reason}</span>}</td><td className="td"><Decide kind="time" row={t} /></td></tr>)}
        {!time?.length && <tr><td className="td text-muted" colSpan={5}>No time logged.</td></tr>}
      </Table>
      {open && <form action={logTime} className="card mt-3 flex flex-wrap items-end gap-2 p-4"><input type="hidden" name="project" value={id} /><input name="date" type="date" required defaultValue={today} aria-label="Date" className="input w-40" /><input name="hours" required inputMode="decimal" placeholder="Hours" aria-label="Hours" className="input w-24" /><input name="note" placeholder="What did you do?" aria-label="Note" className="input flex-1" /><SubmitButton variant="plain">Log time</SubmitButton></form>}

      <h2 className="mb-2 mt-8 font-semibold">Expenses</h2>
      <Table head={["Date", "Description", "Amount", "Status", ""]} numeric={[2]}>
        {(exp ?? []).map((e: any) => <tr key={e.id}><td className="td">{e.spent_on}</td><td className="td">{e.description}</td><td className="td num"><Money paise={Number(e.amount_paise)} /></td><td className="td"><Status value={e.status} />{e.decision_reason && <span className="ml-2 text-xs text-muted">{e.decision_reason}</span>}</td><td className="td"><Decide kind="expense" row={e} /></td></tr>)}
        {!exp?.length && <tr><td className="td text-muted" colSpan={5}>No expenses.</td></tr>}
      </Table>
      {open && <form action={logExpense} className="card mt-3 flex flex-wrap items-end gap-2 p-4"><input type="hidden" name="project" value={id} /><input name="date" type="date" required defaultValue={today} aria-label="Date" className="input w-40" /><input name="description" required placeholder="Description" aria-label="Description" className="input flex-1" /><input name="amount" required inputMode="decimal" placeholder="Amount ₹" aria-label="Amount" className="input w-32" /><SubmitButton variant="plain">Submit expense</SubmitButton></form>}
      {mgr && open && <form action={closeProject} className="mt-8"><input type="hidden" name="project" value={id} /><SubmitButton variant="danger">Close project</SubmitButton></form>}
    </>
  );
}
