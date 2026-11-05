import Link from "next/link";
import { ActionForm } from "@/components/ui/ActionForm";
import { Badge } from "@/components/ui/Badge";
import { Money, DateText } from "@/components/ui/Format";
import { Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { ButtonLink } from "@/components/ui/Button";
import { ProjectTabs } from "@/components/app/ProjectTabs";
import { requireCtx } from "@/lib/server/auth";
import { getProject, projectSummary } from "@/lib/server/queries";
import { Stat } from "@/components/ui/Stat";
import { createBill } from "./actions";

export const metadata = { title: "Bills & collections" };
export default async function Bills({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await requireCtx("bill.view");
  const { p, rows, s, invoices } = await c.run(async (db) => ({
    p: await getProject(db, id), s: await projectSummary(db, id, true),
    rows: await db.q<{ id: string; bill_no: number; status: string; claimed_gross_minor: number; certified_gross_minor: number; net_minor: number; created_at: Date }>(
      "SELECT id,bill_no,status,claimed_gross_minor,certified_gross_minor,net_minor,created_at FROM bills WHERE project_id=$1 ORDER BY bill_no DESC", [id]),
    invoices: await db.q<{ id: string; number: string; amount_minor: number; issued_on: string; due_on: string; collected: number; disputed: number }>(
      `SELECT i.id,i.number,i.amount_minor,i.issued_on,i.due_on,
              COALESCE((SELECT sum(amount_minor) FROM receipts r WHERE r.invoice_id=i.id AND r.reversed_at IS NULL),0)::bigint collected,
              COALESCE((SELECT sum(amount_minor) FROM disputes d WHERE d.invoice_id=i.id AND d.status='open'),0)::bigint disputed
         FROM client_invoices i WHERE i.project_id=$1 ORDER BY i.number DESC`, [id]),
  }));
  return (
    <>
      <PageHeader eyebrow={p.code} title="Running bills and collections" description="Submitted, certified, invoiced and collected amounts are tracked separately."
        actions={<>{c.can("export") ? <ButtonLink href={`/api/export/${id}/bills`} icon="file">Export CSV</ButtonLink> : null}</>} />
      <ProjectTabs c={c} id={id} active="bills" />
      <section aria-label="Position" className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Submitted (claimed)" value={<Money minor={s.claimedMinor} />} /><Stat label="Certified" value={<Money minor={s.certifiedMinor} />} />
        <Stat label="Invoiced (net)" value={<Money minor={s.invoicedMinor} />} /><Stat label="Collected" value={<Money minor={s.collectedMinor} />} hint={`Outstanding ${(s.outstandingMinor / 100).toLocaleString("en-IN")}`} />
      </section>
      {c.can("bill.prepare") && p.status !== "closed" ? (
        <Card title="Prepare the next running bill" className="mb-6"><ActionForm action={createBill} submitLabel="Prepare bill from verified work"><input type="hidden" name="project_id" value={id} />
          <p className="text-ink-700">Takes all verified quantities not yet certified and deducts what earlier bills certified. Only one bill can be open at a time.</p></ActionForm></Card>
      ) : null}
      <Card title="Running bills">
        {rows.length === 0 ? <EmptyState title="No bills yet">Verify measurements, then prepare the first running bill.</EmptyState> : (
          <Table caption="Running bills">
            <thead><tr><Th>Bill</Th><Th>Status</Th><Th className="text-right">Claimed</Th><Th className="text-right">Certified</Th><Th className="text-right">Net payable</Th><Th>Prepared</Th></tr></thead>
            <tbody>{rows.map((b) => <tr key={b.id}><Td><Link className="font-bold" href={`/app/projects/${id}/bills/${b.id}`}>Bill {b.bill_no}</Link></Td><Td><Badge status={b.status} /></Td><Td className="text-right"><Money minor={b.claimed_gross_minor} /></Td><Td className="text-right"><Money minor={b.certified_gross_minor} /></Td><Td className="text-right"><Money minor={b.net_minor} /></Td><Td><DateText at={b.created_at} /></Td></tr>)}</tbody>
          </Table>
        )}
      </Card>
      {c.can("invoice.view") ? (
        <Card title="Invoices" className="mt-6">
          {invoices.length === 0 ? <EmptyState title="No invoices yet">Invoices are created from certified bills.</EmptyState> : (
            <Table caption="Invoices"><thead><tr><Th>Invoice</Th><Th>Issued</Th><Th>Due</Th><Th className="text-right">Amount</Th><Th className="text-right">Collected</Th><Th className="text-right">Disputed</Th><Th>Status</Th></tr></thead>
              <tbody>{invoices.map((i) => <tr key={i.id}><Td className="font-bold">{i.number}</Td><Td><DateText at={i.issued_on} /></Td><Td><DateText at={i.due_on} /></Td><Td className="text-right"><Money minor={i.amount_minor} /></Td><Td className="text-right"><Money minor={i.collected} /></Td><Td className="text-right"><Money minor={i.disputed} /></Td><Td><Badge status={i.collected === 0 ? "unpaid" : i.collected < i.amount_minor ? "part_paid" : "paid"} /></Td></tr>)}</tbody></Table>
          )}
        </Card>
      ) : null}
    </>
  );
}
