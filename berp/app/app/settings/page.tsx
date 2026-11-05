import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireCtx, can } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Flash, Money, PageHeader, Status, Table } from "@/components/ui/kit";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { addBranch, addMember, addWarehouse, choosePlan, saveWorkspaceSettings, toggleMember } from "../actions";
import { createApiKey, revokeApiKey, startCheckout } from "../actions2";

export const metadata: Metadata = { title: "Settings" };
const ROLES = ["owner", "manager", "sales", "purchasing", "warehouse", "accountant", "viewer"];

export default async function Settings({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; newkey?: string }> }) {
  const q = await searchParams; const ctx = await requireCtx();
  if (!can(ctx.role, "owner", "manager")) redirect("/app");
  const sb = await createClient(); const owner = ctx.role === "owner";
  const [{ data: team }, { data: plans }, { data: br }, { data: wh }, { data: audit }, { data: t }, { data: keys }] = await Promise.all([
    sb.rpc("team"), sb.from("plans").select("*").eq("active", true).neq("code", "trial").order("price_monthly_paise"),
    sb.from("branches").select("*").order("code"), sb.from("warehouses").select("*, branches(code)").order("code"),
    sb.from("audit_log").select("at,action,table_name,changed_fields").order("at", { ascending: false }).limit(15),
    sb.from("tenants").select("*").eq("id", ctx.tenant.id).single(),
    owner ? sb.from("api_keys").select("id,name,prefix,created_at,revoked_at,last_used_at").order("created_at", { ascending: false }) : Promise.resolve({ data: [] as any[] }),
  ]);
  return (
    <>
      <PageHeader title="Settings" sub={`${ctx.tenant.name} · plan ${ctx.tenant.plan_code} · ${ctx.tenant.status}`} />
      <Flash ok={q.ok} error={q.error} />
      <h2 className="mb-2 font-semibold">Team</h2>
      <Table head={["Email", "Name", "Role", "Status", ""]}>
        {((team as any[]) ?? []).map((m) => <tr key={m.user_id}><td className="td">{m.email}</td><td className="td">{m.full_name || "—"}</td><td className="td">{m.role}</td><td className="td">{m.active ? "Active" : "Deactivated"}</td>
          <td className="td">{owner && m.user_id !== ctx.userId && <form action={toggleMember}><input type="hidden" name="user" value={m.user_id} /><input type="hidden" name="active" value={String(!m.active)} /><button className="btn">{m.active ? "Deactivate" : "Reactivate"}</button></form>}</td></tr>)}
      </Table>
      {owner && (
        <form action={addMember} className="card mt-3 flex flex-wrap items-end gap-3 p-4"><label className="text-sm">Email of existing account<input name="email" type="email" required className="input mt-1" /></label>
          <label className="text-sm">Role<select name="role" className="input mt-1">{ROLES.map((r) => <option key={r}>{r}</option>)}</select></label><SubmitButton>Add member</SubmitButton></form>
      )}
      {owner && (
        <section className="mt-8" aria-labelledby="plans"><h2 id="plans" className="mb-2 font-semibold">Plan</h2>
          <div className="grid gap-3 md:grid-cols-3">{(plans ?? []).map((p: any) => (
            <div key={p.code} className="card space-y-2 p-4"><p className="font-semibold">{p.name} {ctx.tenant.plan_code === p.code && ctx.tenant.status === "active" && <Status value="active" />}</p>
              <p className="text-sm"><Money paise={Number(p.price_monthly_paise)} />/month · {p.max_users} users · {p.max_branches} branches · {p.max_warehouses} warehouses</p>
              {ctx.tenant.status === "active" ? (
                <form action={choosePlan}><input type="hidden" name="plan" value={p.code} /><SubmitButton variant="plain">{ctx.tenant.plan_code === p.code ? "Current plan" : "Switch to this plan"}</SubmitButton></form>
              ) : (
                <form action={startCheckout} className="flex gap-2"><input type="hidden" name="plan" value={p.code} />
                  <select name="cycle" aria-label={`Billing cycle for ${p.name}`} className="input"><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select><SubmitButton>Subscribe</SubmitButton></form>)}
            </div>))}</div>
          <p className="mt-2 text-sm text-muted">Downgrades are blocked while usage exceeds the new plan. Payment is taken by the payment provider; your plan activates when it confirms the charge.</p></section>
      )}
      <h2 className="mb-2 mt-8 font-semibold">Branches and warehouses</h2>
      <Table head={["Code", "Name", "Kind"]}>{[...(br ?? []).map((b: any) => ({ ...b, kind: "Branch" })), ...(wh ?? []).map((w: any) => ({ ...w, kind: `Warehouse @ ${w.branches?.code}` }))].map((r: any) => <tr key={r.id}><td className="td font-mono">{r.code}</td><td className="td">{r.name}</td><td className="td">{r.kind}</td></tr>)}</Table>
      {owner && (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <form action={addBranch} className="card flex flex-wrap items-end gap-2 p-4"><input name="code" required placeholder="Code" aria-label="Branch code" className="input w-28" /><input name="name" required placeholder="Branch name" aria-label="Branch name" className="input flex-1" /><SubmitButton variant="plain">Add branch</SubmitButton></form>
          <form action={addWarehouse} className="card flex flex-wrap items-end gap-2 p-4"><select name="branch" aria-label="Branch" className="input w-32">{(br ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.code}</option>)}</select><input name="code" required placeholder="Code" aria-label="Warehouse code" className="input w-28" /><input name="name" required placeholder="Warehouse name" aria-label="Warehouse name" className="input flex-1" /><SubmitButton variant="plain">Add warehouse</SubmitButton></form>
        </div>
      )}
      {owner && t && (
        <form action={saveWorkspaceSettings} className="card mt-8 grid gap-4 p-6 sm:grid-cols-2"><h2 className="font-semibold sm:col-span-2">Workspace rules</h2>
          <label className="text-sm font-medium">Company name<input name="name" defaultValue={t.name} required className="input mt-1" /></label>
          <label className="text-sm font-medium">Supplier bill tolerance (%)<input name="tolerance" defaultValue={t.bill_tolerance_bp / 100} inputMode="decimal" className="input mt-1" /></label>
          <label className="flex items-center gap-2 text-sm font-medium sm:col-span-2"><input type="checkbox" name="credit_check" defaultChecked={t.credit_check} className="h-5 w-5" /> Enforce customer credit limits on order confirmation</label>
          <div className="sm:col-span-2"><SubmitButton>Save</SubmitButton></div></form>
      )}
      {owner && (
        <section className="mt-8" aria-labelledby="keys"><h2 id="keys" className="mb-2 font-semibold">API keys (read-only)</h2>
          {q.newkey && <div role="status" className="mb-3 rounded-md border border-warn bg-warn-bg p-4 text-warn"><p className="font-semibold">Copy this key now — it will not be shown again.</p><code className="mt-1 block break-all text-ink">{q.newkey}</code></div>}
          <Table head={["Name", "Prefix", "Created", "Last used", ""]}>{(keys ?? []).map((k: any) => <tr key={k.id}><td className="td">{k.name}</td><td className="td font-mono">{k.prefix}…</td><td className="td">{String(k.created_at).slice(0, 10)}</td><td className="td">{k.last_used_at ? String(k.last_used_at).slice(0, 16).replace("T", " ") : "never"}</td>
            <td className="td">{k.revoked_at ? "Revoked" : <form action={revokeApiKey}><input type="hidden" name="id" value={k.id} /><button className="btn btn-danger">Revoke</button></form>}</td></tr>)}{!keys?.length && <tr><td className="td text-muted" colSpan={5}>No keys.</td></tr>}</Table>
          <form action={createApiKey} className="card mt-3 flex flex-wrap items-end gap-2 p-4"><label className="text-sm">Key name<input name="name" required minLength={2} className="input mt-1" placeholder="BI dashboard" /></label><SubmitButton>Create key</SubmitButton></form></section>
      )}
      <h2 className="mb-2 mt-8 font-semibold">Audit trail (latest)</h2>
      <Table head={["When", "Action", "Record type", "Fields changed"]}>{(audit ?? []).map((a: any, i: number) => <tr key={i}><td className="td">{String(a.at).slice(0, 19).replace("T", " ")}</td><td className="td">{a.action}</td><td className="td">{a.table_name}</td><td className="td">{(a.changed_fields ?? []).join(", ") || "—"}</td></tr>)}</Table>
    </>
  );
}
