import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { PageHead, Alert } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { barcodeSvg } from "@/lib/barcode";
import { sp1, type SP } from "@/lib/list";
export default async function Labels({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireTenant("inventory.view"); const sp = await searchParams; const sel = sp1(sp.item); const copies = Math.min(60, Math.max(1, parseInt(sp1(sp.copies) || "1", 10) || 1));
  const d = await withTenantSystem(ctx.tenant.id, async (db) => ({ items: (await db.query("select id, sku, name, barcode from items where tenant_id=$1 and kind='goods' and status='active' order by sku limit 1000", [ctx.tenant.id])).rows }));
  const item = d.items.find((i: any) => i.id === sel);
  let svg = "", err = "";
  if (item) { try { svg = barcodeSvg(item.barcode || item.sku); } catch (e: any) { err = e.message; } }
  return (<><PageHead title="Barcode labels" crumbs={[["Inventory"], ["Labels"]]} sub="Code 128 labels from the item barcode (or SKU). USB and Bluetooth scanners that type like a keyboard work with any search or quantity field." />
    <form className="toolbar no-print" method="get"><div><label className="f" htmlFor="item">Item</label><select id="item" name="item" defaultValue={sel}><option value="">Choose…</option>{d.items.map((i: any) => <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>)}</select></div><div><label className="f" htmlFor="copies">Copies (max 60)</label><input id="copies" name="copies" defaultValue={copies} inputMode="numeric" /></div><button className="btn">Preview</button>{svg && <PrintButton label="Print labels" />}</form>
    {err && <Alert tone="bad">{err}</Alert>}
    {svg && <div className="row" style={{ alignItems: "stretch" }}>{Array.from({ length: copies }).map((_, i) => <div key={i} className="card" style={{ width: 280, textAlign: "center", breakInside: "avoid" }}><strong>{item!.name}</strong><div dangerouslySetInnerHTML={{ __html: svg }} /><div className="small">{item!.barcode || item!.sku}</div></div>)}</div>}</>);
}
