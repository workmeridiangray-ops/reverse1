import { ActionForm } from "@/components/ui/ActionForm";
import { Money } from "@/components/ui/Format";
import { Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { Stat } from "@/components/ui/Stat";
import { Table, Td, Th } from "@/components/ui/Table";
import { ProjectTabs } from "@/components/app/ProjectTabs";
import { requireCtx } from "@/lib/server/auth";
import { boqWithDeltas, getProject } from "@/lib/server/queries";
import { amountFor, percentOf } from "@/lib/rules/qty";
import { toMajorString } from "@/lib/rules/money";
import { saveBudget } from "./actions";

export const metadata = { title: "Budget" };
export default async function Budget({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await requireCtx("budget.view");
  const { p, boq, bl, committed } = await c.run(async (db) => ({
    p: await getProject(db, id), boq: await boqWithDeltas(db, id),
    bl: new Map((await db.q<{ boq_item_id: string; cost_rate_minor: number; contingency_bp: number }>("SELECT boq_item_id,cost_rate_minor,contingency_bp FROM budget_lines WHERE project_id=$1", [id])).map((b) => [b.boq_item_id, b])),
    committed: new Map((await db.q<{ boq_item_id: string; v: number }>("SELECT l.boq_item_id, sum(l.qty_milli*l.rate_minor/1000)::bigint v FROM po_lines l JOIN purchase_orders o ON o.id=l.po_id WHERE l.project_id=$1 AND o.status IN ('issued','part_received','received') AND l.boq_item_id IS NOT NULL GROUP BY 1", [id])).map((r) => [r.boq_item_id, Number(r.v)])),
  }));
  const rows = boq.map((b) => {
    const q = b.qty_milli + Number(b.delta); const x = bl.get(b.id);
    const tender = amountFor(q, b.rate_minor); const base = x ? amountFor(q, x.cost_rate_minor) : 0; const cont = x ? percentOf(base, x.contingency_bp) : 0;
    return { b, x, tender, base, cont, committed: committed.get(b.id) ?? 0 };
  });
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
  return (
    <>
      <PageHeader eyebrow={p.code} title="Baseline budget" description="Tender price, approved cost budget and committed purchasing are different numbers. This screen is internal and never shown to clients." />
      <ProjectTabs c={c} id={id} active="budget" />
      <section className="mb-6 grid gap-4 sm:grid-cols-4"><Stat label="Tender price" value={<Money minor={sum((r) => r.tender)} />} /><Stat label="Budget cost" value={<Money minor={sum((r) => r.base)} />} /><Stat label="Contingency" value={<Money minor={sum((r) => r.cont)} />} /><Stat label="Committed (issued POs)" value={<Money minor={sum((r) => r.committed)} />} hint="Only PO lines tied to a BOQ item" /></section>
      {rows.length === 0 ? <EmptyState title="Add BOQ items first" /> : (
        <Card>
          <ActionForm action={saveBudget} submitLabel="Save budget">
            <input type="hidden" name="project_id" value={id} />
            <Table caption="Budget by BOQ item"><thead><tr><Th>Item</Th><Th className="text-right">Tender amount</Th><Th>Cost rate (₹)</Th><Th>Contingency %</Th><Th className="text-right">Budget cost</Th><Th className="text-right">Committed</Th></tr></thead>
              <tbody>{rows.map((r) => (<tr key={r.b.id}><Td className="font-bold">{r.b.code}</Td><Td className="text-right"><Money minor={r.tender} /></Td>
                <Td><input aria-label={`Cost rate for ${r.b.code}`} name={`cost_${r.b.id}`} defaultValue={r.x ? toMajorString(r.x.cost_rate_minor, "INR") : ""} inputMode="decimal" disabled={!c.can("boq.edit")} className="min-h-touch w-28 rounded border border-ink-500 px-2 text-right font-mono" /></Td>
                <Td><input aria-label={`Contingency for ${r.b.code}`} name={`cont_${r.b.id}`} defaultValue={r.x ? String(r.x.contingency_bp / 100) : ""} inputMode="decimal" disabled={!c.can("boq.edit")} className="min-h-touch w-20 rounded border border-ink-500 px-2 text-right font-mono" /></Td>
                <Td className="text-right"><Money minor={r.base + r.cont} /></Td><Td className="text-right"><Money minor={r.committed} /></Td></tr>))}</tbody></Table>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
