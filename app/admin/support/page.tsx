import { plat } from "@/lib/server/db";
import { requirePlatform } from "@/lib/server/auth";
import { Page, Card, DataTable, Badge, Field, Hidden, dt } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { replyTicket } from "../actions";
export const metadata = { title: "Support" };
export default async function P() {
  await requirePlatform("support");
  const t = (await plat("select t.*, c.name company, u.email from support_tickets t left join companies c on c.id=t.company_id join users u on u.id=t.user_id order by (t.status='resolved'), t.created_at desc limit 50")).rows;
  const leads = (await plat("select * from leads order by created_at desc limit 50")).rows;
  return <Page title="Support queue & leads">
    <div className="space-y-3">{t.length === 0 ? <Card><p className="text-sm">No tickets.</p></Card> : t.map((x: any) => <Card key={x.id} title={x.subject} actions={<Badge s={x.status} />}><p className="text-xs text-muted">{x.company} · {x.email} · {dt(x.created_at)}</p><p className="mt-1 text-sm">{x.body}</p>
      {x.reply ? <p className="mt-2 rounded bg-sunken p-2 text-sm">Reply: {x.reply}</p> : <ActionForm action={replyTicket} submit="Send reply" small className="mt-3"><Hidden name="id" value={x.id} /><Field label="Reply" name="reply" type="textarea" required /></ActionForm>}</Card>)}</div>
    <h2 className="mb-2 mt-6 font-semibold">Demo, contact & trial requests</h2>
    <DataTable rows={leads} empty="None." cols={[{ h: "When", r: (r: any) => dt(r.created_at) }, { h: "Type", r: (r: any) => r.kind }, { h: "Name", r: (r: any) => r.name }, { h: "Email", r: (r: any) => r.email }, { h: "Company", r: (r: any) => r.company ?? "—", hideSm: true }, { h: "Message", r: (r: any) => r.message ?? "—", hideSm: true }]} /></Page>;
}
