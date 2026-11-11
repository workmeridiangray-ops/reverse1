import type { Metadata } from "next";
import { requireCtx, can } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Empty, Field, Flash, PageHeader, Status, Table, TextInput } from "@/components/ui/kit";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { addEmployee, approveLeave, rejectLeave, linkEmployee, offboard, requestLeave } from "../actions2";

export const metadata: Metadata = { title: "People" };

export default async function People({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const q = await searchParams; const ctx = await requireCtx(); const sb = await createClient();
  const mgr = can(ctx.role, "owner", "manager");
  const [{ data: emps }, { data: leave }, { data: branches }] = await Promise.all([
    sb.from("employees").select("*, branches(code)").order("code"),
    sb.from("leave_requests").select("*, employees(full_name, user_id)").order("created_at", { ascending: false }).limit(50),
    sb.from("branches").select("id,code").eq("active", true),
  ]);
  const mine = (emps ?? []).find((e: any) => e.user_id === ctx.userId);
  return (
    <>
      <PageHeader title="People" sub={mgr ? "Employee records are visible to owners and managers only." : "Your record and leave requests."} />
      <Flash ok={q.ok} error={q.error} />
      {(emps?.length ?? 0) > 0 ? (
        <Table head={["Code", "Name", "Title", "Branch", "Joined", "Login", "Status", ""]}>
          {(emps ?? []).map((e: any) => (
            <tr key={e.id}><td className="td font-mono">{e.code}</td><td className="td font-medium">{e.full_name}</td><td className="td">{e.job_title || "—"}</td><td className="td">{e.branches?.code ?? "—"}</td><td className="td">{e.joined_on}</td>
              <td className="td">{e.user_id ? "Linked" : mgr ? (
                <form action={linkEmployee} className="flex gap-1"><input type="hidden" name="id" value={e.id} /><input name="email" type="email" required placeholder="member email" aria-label={`Link login for ${e.full_name}`} className="input w-44" /><button className="btn">Link</button></form>) : "—"}</td>
              <td className="td">{e.left_on ? `Left ${e.left_on}` : "Active"}</td>
              <td className="td">{can(ctx.role, "owner") && !e.left_on && e.user_id !== ctx.userId && (
                <form action={offboard} className="flex gap-1"><input type="hidden" name="id" value={e.id} /><input name="day" type="date" required aria-label="Last day" defaultValue={new Date().toISOString().slice(0, 10)} className="input w-40" /><button className="btn btn-danger">Offboard</button></form>)}</td></tr>))}
        </Table>
      ) : <Empty title="No employee records" hint={mgr ? "Add your team below." : "Ask a manager to create your employee record and link your login."} />}
      {mgr && (
        <form action={addEmployee} className="card mt-4 grid gap-4 p-6 sm:grid-cols-3"><h2 className="font-semibold sm:col-span-3">Add employee</h2>
          <Field label="Code" name="code"><TextInput name="code" required /></Field><Field label="Full name" name="name"><TextInput name="name" required minLength={2} /></Field><Field label="Job title" name="title"><TextInput name="title" /></Field>
          <Field label="Email" name="email"><TextInput name="email" type="email" /></Field><Field label="Phone" name="phone"><TextInput name="phone" inputMode="tel" /></Field>
          <Field label="Branch" name="branch"><select id="branch" name="branch" className="input"><option value="">—</option>{(branches ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.code}</option>)}</select></Field>
          <div className="sm:col-span-3"><SubmitButton>Add employee</SubmitButton></div></form>
      )}
      <h2 className="mb-2 mt-8 font-semibold">Leave</h2>
      <Table head={["Employee", "From", "To", "Type", "Reason", "Status", ""]}>
        {(leave ?? []).map((l: any) => <tr key={l.id}><td className="td">{l.employees?.full_name}</td><td className="td">{l.from_date}</td><td className="td">{l.to_date}</td><td className="td">{l.kind}</td><td className="td">{l.reason || "—"}</td><td className="td"><Status value={l.status} />{l.decision_reason && <span className="ml-2 text-xs text-muted">{l.decision_reason}</span>}</td>
          <td className="td">{mgr && l.status === "pending" && l.employees?.user_id !== ctx.userId && (
            <form className="flex flex-wrap gap-1"><input type="hidden" name="id" value={l.id} /><input name="reason" placeholder="Reason (to reject)" aria-label="Reason" className="input w-36" /><button className="btn btn-primary" formAction={approveLeave}>Approve</button><button className="btn btn-danger" formAction={rejectLeave}>Reject</button></form>)}</td></tr>)}
        {!leave?.length && <tr><td className="td text-muted" colSpan={7}>No leave requests.</td></tr>}
      </Table>
      {mine && !mine.left_on && (
        <form action={requestLeave} className="card mt-3 flex flex-wrap items-end gap-2 p-4"><input name="from" type="date" required aria-label="From" className="input w-40" /><input name="to" type="date" required aria-label="To" className="input w-40" />
          <select name="kind" aria-label="Type" className="input w-32"><option>casual</option><option>sick</option><option>earned</option><option>unpaid</option></select><input name="reason" placeholder="Reason" aria-label="Reason" className="input flex-1" /><SubmitButton variant="plain">Request leave</SubmitButton></form>
      )}
    </>
  );
}
