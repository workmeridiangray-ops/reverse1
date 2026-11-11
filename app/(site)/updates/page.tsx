import { Page, Empty, date } from "@/components/ui";
import { plat } from "@/lib/server/db";
export const metadata = { title: "Updates" };
export const dynamic = "force-dynamic";
export default async function P() {
  const rows = (await plat("select * from announcements where active order by created_at desc limit 50")).rows;
  return <div className="mx-auto max-w-3xl"><Page title="Product updates">{rows.length ? <div className="space-y-3">{rows.map((r) => <article key={r.id} className="card p-4"><h2 className="font-semibold">{r.title}</h2><p className="text-xs text-muted">{date(r.created_at)}</p><p className="mt-2 text-sm">{r.body}</p></article>)}</div> : <Empty>No announcements yet.</Empty>}</Page></div>;
}
