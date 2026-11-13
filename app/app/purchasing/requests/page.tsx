import { requireCompany } from "@/lib/server/auth";
import { rd, itemOpts } from "@/lib/server/read";
import { Page, Card, DataTable, Badge, Field, Grid, Hidden, A, date, fmt } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { createPRAction, decidePRAction, openRfqAction } from "../../actions3";
import { can } from "@/lib/server/perms";
export const metadata = { title: "Purchase requests" };
export default async function P() {
  const a = await requireCompany("proc.read");
  const d = await rd(a, async (c) => ({ rows: (await c.query("select p.*, i.code, (select r.id from rfqs r where r.pr_id=p.id) rfq from purchase_requests p join items i on i.id=p.item_id order by p.created_at desc limit 60")).rows, items: await itemOpts(c, "active and kind <> 'make'") }));
  const w = can(a.membership.role, "proc.write"), ap = can(a.membership.role, "proc.approve");
  return <Page title="Purchase requests" sub="Raise a need, get it approved or take it straight to quotes. An award creates a draft PO that still needs approval." crumbs={[["Purchase orders", "/app/purchasing"], ["Requests"]]}>
    <DataTable rows={d.rows} empty="No requests." cols={[{ h: "No.", r: (r: any) => r.number }, { h: "Item", r: (r: any) => r.code }, { h: "Qty", r: (r: any) => fmt(r.qty), num: true }, { h: "Needed by", r: (r: any) => date(r.needed_by), hideSm: true }, { h: "Status", r: (r: any) => <Badge s={r.status} /> },
      { h: "Action", r: (r: any) => <div className="flex flex-wrap gap-2">{r.rfq && <A href={`/app/purchasing/rfq/${r.rfq}`}>View RFQ</A>}{r.po_id && <A href={`/app/purchasing/${r.po_id}`}>View PO</A>}{r.status === "open" && w && <ActionForm action={openRfqAction} submit="Request quotes" small><Hidden name="id" value={r.id} /></ActionForm>}{r.status === "open" && ap && <><ActionForm action={decidePRAction} submit="Approve" small secondary><Hidden name="id" value={r.id} /><input type="hidden" name="decision" value="approve" /></ActionForm><details><summary className="cursor-pointer text-brand">Reject</summary><ActionForm action={decidePRAction} submit="Reject" small danger className="mt-1 w-56"><Hidden name="id" value={r.id} /><input type="hidden" name="decision" value="reject" /><Field label="Reason" name="reason" required /></ActionForm></details></>}</div> }]} />
    {w && <Card title="New purchase request" className="mt-4"><ActionForm action={createPRAction} submit="Raise request" resetOnOk><Grid cols={4}><Field label="Item" name="item" required options={d.items} /><Field label="Quantity" name="qty" type="number" step="any" required /><Field label="Needed by" name="needed" type="date" required /><Field label="Reason" name="reason" /></Grid></ActionForm></Card>}</Page>;
}
