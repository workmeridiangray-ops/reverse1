import { requireCompany } from "@/lib/server/auth";
import { plat } from "@/lib/server/db";
import { Page, Card, DataTable, Badge, Field, A, dt } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { supportTicketAction } from "../actions2";
export const metadata = { title: "Help & support" };
export default async function P() {
  const a = await requireCompany();
  const rows = (await plat("select * from support_tickets where company_id=$1 and user_id=$2 order by created_at desc limit 20", [a.company.id, a.user.id])).rows;
  return <Page title="Help & support" sub={<>Browse the <A href="/help">help centre</A> or raise a ticket.</> as any}>
    <div className="grid gap-4 lg:grid-cols-2"><Card title="Raise a ticket"><ActionForm action={supportTicketAction} submit="Send" resetOnOk><Field label="Subject" name="subject" required /><Field label="What happened? What did you expect?" name="body" type="textarea" rows={5} required className="mt-2" /></ActionForm></Card>
      <Card title="Your tickets"><DataTable rows={rows} empty="No tickets." cols={[{ h: "Subject", r: (r: any) => r.subject }, { h: "Status", r: (r: any) => <Badge s={r.status} /> }, { h: "Reply", r: (r: any) => r.reply ?? "—", hideSm: true }, { h: "Opened", r: (r: any) => dt(r.created_at), hideSm: true }]} /></Card></div></Page>;
}
