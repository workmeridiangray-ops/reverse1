import { withSystem } from "@/lib/db";
import { requirePlatform } from "@/lib/auth/session";
import { PageHead } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { announceAction } from "../actions";
export default async function Ann() {
  await requirePlatform("support"); const rows = await withSystem(async (db) => (await db.query("select * from announcements order by created_at desc limit 20")).rows);
  return (<><PageHead title="Announcements" sub="Published on the public Updates page." /><div className="card"><ActionForm action={announceAction} submit="Publish" resetOnSuccess><Field name="title" label="Title" required /><Field name="body" label="Message" type="textarea" required /></ActionForm></div>{rows.map((r: any) => <div className="card" key={r.id}><h3>{r.title}</h3><p>{r.body}</p></div>)}</>);
}
