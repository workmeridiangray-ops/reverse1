import { requireCompany } from "@/lib/server/auth";
import { rd } from "@/lib/server/read";
import { Page, Card, Field } from "@/components/ui";
import { code39Svg, code39Valid } from "@/lib/domain/code39";
export const metadata = { title: "Labels" };
function Label({ code, line1, line2 }: { code: string; line1: string; line2?: string }) {
  if (!code39Valid(code.toUpperCase())) return <div className="card p-3 text-sm text-danger">{code}: contains characters a Code 39 label cannot hold (use A–Z, 0–9, - . space).</div>;
  const { svg, width } = code39Svg(code);
  return <div className="card break-inside-avoid p-3"><svg viewBox={`0 0 ${width} 56`} role="img" aria-label={`Barcode ${code}`} className="h-16 w-full" preserveAspectRatio="none" dangerouslySetInnerHTML={{ __html: svg }} /><div className="mt-1 text-center font-mono text-sm">{code}</div><div className="text-center text-xs">{line1}</div>{line2 && <div className="text-center text-xs text-muted">{line2}</div>}</div>;
}
export default async function P({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const a = await requireCompany("inv.read"); const sp = await searchParams;
  const d = await rd(a, async (c) => ({ items: (await c.query("select code, name from items where active order by code limit 60")).rows, batches: (await c.query("select b.code, i.code ic from batches b join items i on i.id=b.item_id order by b.created_at desc limit 60")).rows }));
  const show = sp.type === "batches" ? "batches" : "items";
  return <Page title="Barcode labels" sub="Code 39 labels for items and batches. Scan with a keyboard-wedge scanner or a phone camera app into the search box (top bar): an exact code opens the record. Print this page (Ctrl/Cmd+P).">
    <form className="mb-4 flex gap-2 print:hidden"><Field label="Labels for" name="type" defaultValue={show} options={[{ value: "items", label: "Items" }, { value: "batches", label: "Batches" }]} required /><button className="btn-secondary mt-6">Show</button></form>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3">{show === "items" ? d.items.map((i: any) => <Label key={i.code} code={i.code} line1={i.name} />) : d.batches.map((b: any) => <Label key={b.code + b.ic} code={b.code} line1={`Batch of ${b.ic}`} />)}</div>
    <Card className="mt-4 print:hidden"><p className="text-sm text-muted">One agreed format: Code 39, uppercase letters, digits and - . space. Codes containing other characters are flagged instead of printed wrongly.</p></Card></Page>;
}
