import { requireCompany } from "@/lib/server/auth";
import { plat } from "@/lib/server/db";
import { Page, Card, Empty, A, dt } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { markNotificationsRead } from "../actions2";
export const metadata = { title: "Notifications" };
export default async function P() {
  const a = await requireCompany();
  const rows = (await plat("select * from notifications where user_id=$1 order by created_at desc limit 50", [a.user.id])).rows;
  return <Page title="Notifications" actions={<ActionForm action={markNotificationsRead} submit="Mark all read" small secondary>{null}</ActionForm>}>
    {rows.length === 0 ? <Empty>No notifications yet. You’ll see approvals waiting, failed payments and schedule changes here.</Empty> : <div className="space-y-2">{rows.map((n: any) => <Card key={n.id}><div className="flex justify-between gap-3"><div><b className={n.read_at ? "font-normal" : ""}>{n.title}</b>{n.body && <p className="text-sm text-muted">{n.body}</p>}{n.href && <A href={n.href}>Open</A>}</div><span className="text-xs text-muted">{dt(n.created_at)}</span></div></Card>)}</div>}</Page>;
}
