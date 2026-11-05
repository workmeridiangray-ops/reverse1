import { ActionForm } from "@/components/ui/ActionForm";
import { TextField } from "@/components/ui/Field";
import { Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { requireCtx } from "@/lib/server/auth";
import { addSupplier } from "./actions";

export const metadata = { title: "Suppliers" };
export default async function Suppliers() {
  const c = await requireCtx("supplier.view");
  const rows = await c.run((db) => db.q<{ id: string; name: string; contact: string | null; gstin: string | null }>("SELECT id,name,contact,gstin FROM suppliers ORDER BY name"));
  return (
    <>
      <PageHeader title="Suppliers" />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        {rows.length === 0 ? <EmptyState title="No suppliers yet" /> : <Card><Table caption="Suppliers"><thead><tr><Th>Name</Th><Th>Contact</Th><Th>GSTIN</Th></tr></thead><tbody>{rows.map((r) => <tr key={r.id}><Td className="font-bold">{r.name}</Td><Td>{r.contact ?? "—"}</Td><Td>{r.gstin ?? "—"}</Td></tr>)}</tbody></Table></Card>}
        {c.can("supplier.manage") ? <Card title="Add supplier"><ActionForm action={addSupplier} submitLabel="Add supplier" reset><TextField label="Name" name="name" /><TextField label="Contact" name="contact" optional /><TextField label="GSTIN" name="gstin" optional /></ActionForm></Card> : null}
      </div>
    </>
  );
}
