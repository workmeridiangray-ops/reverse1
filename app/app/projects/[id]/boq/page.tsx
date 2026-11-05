import { ActionForm } from "@/components/ui/ActionForm";
import { TextField } from "@/components/ui/Field";
import { Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { Money, Qty } from "@/components/ui/Format";
import { Table, Td, Th } from "@/components/ui/Table";
import { ProjectTabs } from "@/components/app/ProjectTabs";
import { requireCtx } from "@/lib/server/auth";
import { boqWithDeltas, getProject } from "@/lib/server/queries";
import { amountFor } from "@/lib/rules/qty";
import { addBoqItem, deleteBoqItem } from "./actions";
import { BoqImport } from "./BoqImport";

export const metadata = { title: "BOQ" };
export default async function Boq({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await requireCtx("boq.view");
  const { p, rows, approved } = await c.run(async (db) => ({
    p: await getProject(db, id), rows: await boqWithDeltas(db, id),
    approved: !!(await db.maybe("SELECT 1 FROM contracts WHERE project_id=$1 AND status='approved'", [id])),
  }));
  const total = rows.reduce((a, r) => a + amountFor(r.qty_milli + Number(r.delta), r.rate_minor), 0);
  const edit = c.can("boq.edit") && p.status !== "closed";
  return (
    <>
      <PageHeader eyebrow={p.code} title="Bill of quantities" description={approved ? "Contract approved: quantities and rates are frozen. Changes need an approved variation." : "Draft BOQ. Import a CSV or add items; rates are in ₹ per unit."} />
      <ProjectTabs c={c} id={id} active="boq" />
      {rows.length === 0 ? <EmptyState title="No BOQ items yet">{edit ? "Import a CSV below or add the first item." : "The BOQ has not been prepared."}</EmptyState> : (
        <Card>
          <Table caption="Bill of quantities">
            <thead><tr><Th>Code</Th><Th>Description</Th><Th>Unit</Th><Th className="text-right">Contract qty</Th><Th className="text-right">Rate</Th><Th className="text-right">Amount</Th><Th>Source</Th>{edit && !approved ? <Th><span className="sr-only">Actions</span></Th> : null}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td className="font-bold">{r.code}</Td><Td>{r.description}</Td><Td>{r.unit}</Td>
                  <Td className="text-right"><Qty milli={r.qty_milli + Number(r.delta)} />{Number(r.delta) ? <span className="block text-caption text-ink-500">incl. variations</span> : null}</Td>
                  <Td className="text-right"><Money minor={r.rate_minor} /></Td>
                  <Td className="text-right"><Money minor={amountFor(r.qty_milli + Number(r.delta), r.rate_minor)} /></Td>
                  <Td className="text-caption text-ink-500">{r.source}</Td>
                  {edit && !approved ? <Td><ActionForm action={deleteBoqItem} submitLabel="Delete" variant="secondary" className="!gap-0"><input type="hidden" name="project_id" value={id} /><input type="hidden" name="item_id" value={r.id} /></ActionForm></Td> : null}
                </tr>
              ))}
            </tbody>
            <tfoot><tr><Td colSpan={5} className="text-right font-bold">Total contract value</Td><Td className="text-right font-bold"><Money minor={total} /></Td><Td /></tr></tfoot>
          </Table>
        </Card>
      )}
      {edit ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card title="Add an item">
            <ActionForm action={addBoqItem} submitLabel="Add item" reset>
              <input type="hidden" name="project_id" value={id} />
              <div className="grid gap-4 sm:grid-cols-2"><TextField label="Item code" name="code" placeholder="1.01" /><TextField label="Unit" name="unit" placeholder="m3" /></div>
              <TextField label="Description" name="description" />
              <div className="grid gap-4 sm:grid-cols-2"><TextField label="Quantity" name="quantity" inputMode="decimal" hint={approved ? "Must be 0 after approval" : "Up to 3 decimals"} placeholder="0" /><TextField label="Rate (₹ per unit)" name="rate" inputMode="decimal" placeholder="0.00" /></div>
            </ActionForm>
          </Card>
          {!approved ? <Card title="Import from CSV"><BoqImport projectId={id} /></Card> : null}
        </div>
      ) : null}
    </>
  );
}
