import { withSystem } from "@/lib/db";
export const metadata = { title: "Product updates" };
export const dynamic = "force-dynamic";
export default async function Updates() {
  const rows = await withSystem(async (db) => (await db.query("select * from announcements where active order by created_at desc limit 50")).rows);
  return (<div className="wrap section narrow"><h1>Product updates</h1>
    {rows.length === 0 ? <p className="muted">No announcements yet.</p> : rows.map((r: any) => <div className="card" key={r.id}><h2>{r.title}</h2><p className="small muted">{new Date(r.created_at).toDateString()}</p><p style={{ whiteSpace: "pre-wrap" }}>{r.body}</p></div>)}</div>);
}
