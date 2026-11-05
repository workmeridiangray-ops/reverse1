import type { Metadata } from "next";
import { requireCtx, can } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Empty, Field, Flash, Money, PageHeader, Status, Table, TextInput } from "@/components/ui/kit";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { assignAsset, closeWorkOrder, disposeAsset, openWorkOrder, registerAsset } from "../actions2";

export const metadata: Metadata = { title: "Assets & maintenance" };

export default async function Assets({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const q = await searchParams; const ctx = await requireCtx(); const sb = await createClient();
  const mgr = can(ctx.role, "owner", "manager"); const ops = can(ctx.role, "owner", "manager", "warehouse");
  const [{ data: assets }, { data: wos }, { data: whs }, { data: spares }] = await Promise.all([
    sb.from("assets").select("*, warehouses(name)").order("tag"),
    sb.from("work_orders").select("*, assets(tag,name)").order("opened_at", { ascending: false }).limit(30),
    sb.from("warehouses").select("id,name").eq("active", true),
    sb.from("items").select("id,sku,name").eq("kind", "stock").eq("active", true),
  ]);
  const { data: emps } = mgr ? await sb.from("employees").select("id,full_name").is("left_on", null) : { data: [] as any[] };
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title="Assets & maintenance" />
      <Flash ok={q.ok} error={q.error} />
      {assets?.length ? (
        <Table head={["Tag", "Asset", "Location", "Warranty", "Next service", "Cost", "Status", ""]} numeric={[5]}>
          {assets.map((a: any) => (
            <tr key={a.id}><td className="td font-mono">{a.tag}</td><td className="td font-medium">{a.name}<div className="text-xs text-muted">{a.category}</div></td><td className="td">{a.warehouses?.name ?? "—"}</td>
              <td className="td">{a.warranty_until ? <span className={a.warranty_until < today ? "text-danger" : ""}>{a.warranty_until}{a.warranty_until < today && " (expired)"}</span> : "—"}</td>
              <td className="td">{a.next_service_on ? <span className={a.next_service_on <= today ? "font-semibold text-danger" : ""}>{a.next_service_on}</span> : "—"}</td>
              <td className="td num"><Money paise={Number(a.purchase_cost_paise)} /></td><td className="td"><Status value={a.status === "active" ? "active" : a.status === "under_repair" ? "partially_dispatched" : "cancelled"} /> <span className="text-xs">{a.status.replace("_", " ")}</span></td>
              <td className="td">{a.status !== "disposed" && (
                <div className="space-y-1">
                  {ops && <form action={openWorkOrder} className="flex gap-1"><input type="hidden" name="id" value={a.id} /><select name="kind" aria-label="Kind" className="input w-28"><option value="breakdown">Breakdown</option><option value="scheduled">Service</option></select><input name="description" required minLength={3} placeholder="Describe" aria-label="Description" className="input w-36" /><button className="btn">Open WO</button></form>}
                  {mgr && <form action={assignAsset} className="flex gap-1"><input type="hidden" name="id" value={a.id} /><select name="employee" aria-label="Assign to" className="input w-44" defaultValue={a.assigned_employee_id ?? ""}><option value="">Unassigned</option>{(emps ?? []).map((e: any) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</select><button className="btn">Assign</button></form>}
                  {can(ctx.role, "owner") && <form action={disposeAsset} className="flex gap-1"><input type="hidden" name="id" value={a.id} /><input name="reason" required minLength={5} placeholder="Disposal reason" aria-label="Disposal reason" className="input w-36" /><button className="btn btn-danger">Dispose</button></form>}
                </div>)}</td></tr>))}
        </Table>
      ) : <Empty title="No assets registered" hint="Register equipment to track warranty, servicing and repairs." />}
      <h2 className="mb-2 mt-8 font-semibold">Work orders</h2>
      <Table head={["Order", "Asset", "Type", "Description", "Status", "Close-out"]}>
        {(wos ?? []).map((w: any) => <tr key={w.id}><td className="td font-mono">{w.number}</td><td className="td">{w.assets?.tag} · {w.assets?.name}</td><td className="td">{w.kind}</td><td className="td">{w.description}</td><td className="td"><Status value={w.status === "done" ? "invoiced" : "open"} /> {w.status}</td>
          <td className="td">{w.status === "open" && ops ? (
            <form action={closeWorkOrder} className="grid max-w-md grid-cols-2 gap-1"><input type="hidden" name="id" value={w.id} /><input name="report" required minLength={3} placeholder="Service report" aria-label="Service report" className="input col-span-2" />
              <select name="spare" aria-label="Spare used" className="input"><option value="">No spare</option>{(spares ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.sku}</option>)}</select><input name="qty" inputMode="decimal" placeholder="Spare qty" aria-label="Spare quantity" className="input" />
              <select name="warehouse" aria-label="Take spare from" className="input">{(whs ?? []).map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select><input name="labour" inputMode="decimal" placeholder="Labour ₹" aria-label="Labour cost" className="input" />
              <div className="col-span-2"><SubmitButton variant="plain">Close work order</SubmitButton></div></form>) : w.report}</td></tr>)}
        {!wos?.length && <tr><td className="td text-muted" colSpan={6}>No work orders.</td></tr>}
      </Table>
      {mgr && (
        <form action={registerAsset} className="card mt-6 grid gap-4 p-6 sm:grid-cols-3"><h2 className="font-semibold sm:col-span-3">Register asset</h2>
          <Field label="Tag" name="tag"><TextInput name="tag" required /></Field><Field label="Name" name="name"><TextInput name="name" required minLength={2} /></Field><Field label="Category" name="category"><TextInput name="category" /></Field>
          <Field label="Location" name="warehouse"><select id="warehouse" name="warehouse" className="input"><option value="">—</option>{(whs ?? []).map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
          <Field label="Purchase cost (₹)" name="cost"><TextInput name="cost" inputMode="decimal" /></Field><Field label="Warranty until" name="warranty"><TextInput name="warranty" type="date" /></Field>
          <Field label="Service every (days)" name="every"><TextInput name="every" inputMode="numeric" /></Field>
          <div className="sm:col-span-3"><SubmitButton>Register asset</SubmitButton></div></form>
      )}
    </>
  );
}
