import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Empty } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { reorderSuggestions } from "@/lib/erp/stock";
import { reorderAction } from "../actions";
import { formatQty, inputQty } from "@/lib/money";
export default async function Reorder() {
  const ctx = await requireTenant("inventory.view");
  const rows = await withTenantSystem(ctx.tenant.id, (db) => reorderSuggestions(db, ctx.tenant.id));
  return (<><PageHead title="Reorder suggestions" crumbs={[["Inventory"], ["Reorder"]]} sub="Items whose available + in transit + on order is at or below the reorder level set on the item." />
    <div className="card">{rows.length === 0 ? <Empty title="Nothing to reorder">Set a reorder level on items to get suggestions.</Empty> :
      <ActionForm action={reorderAction} submit="Create purchase request from entered quantities" guard={false}><div className="tablewrap"><table><thead><tr><th>Item</th><th className="num">Available</th><th className="num">In transit</th><th className="num">On order</th><th className="num">Level</th><th>Order qty</th></tr></thead><tbody>
        {rows.map((r: any) => <tr key={r.id}><td>{r.sku} — {r.name}</td><td className="num">{formatQty(r.available)}</td><td className="num">{formatQty(r.in_transit)}</td><td className="num">{formatQty(r.on_order)}</td><td className="num">{formatQty(r.reorder_level_qty)}</td>
          <td style={{ width: 150 }}><input aria-label={`Order quantity for ${r.name}`} name={`qty_${r.id}`} defaultValue={ctx.perms.has("procurement.create") ? inputQty(r.reorder_qty || Math.max(r.reorder_level_qty - r.available, 1000)) : ""} disabled={!ctx.perms.has("procurement.create")} /></td></tr>)}</tbody></table></div>
        {!ctx.perms.has("procurement.create") && <p className="muted small">You can view suggestions; purchasing staff create the request.</p>}</ActionForm>}</div></>);
}
