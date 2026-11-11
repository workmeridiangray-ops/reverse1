import { rd } from "@/lib/server/read";
import type { CompanyAuth } from "@/lib/server/auth";
import { Card, DataTable, A, date } from "./ui";
import { ActionForm } from "./ActionForm";
import { Hidden } from "./ui";
import { uploadDocument } from "@/app/app/actions2";
import { can } from "@/lib/server/perms";
export async function Documents({ auth, entity, id }: { auth: CompanyAuth; entity: string; id: string }) {
  const rows = await rd(auth, async (c) => (await c.query("select * from documents where entity=$1 and entity_id=$2 order by created_at desc", [entity, id])).rows);
  return <Card title="Documents" className="mt-4"><DataTable rows={rows} empty="No documents attached." cols={[{ h: "File", r: (r: any) => <A href={`/api/files/${r.id}`}>{r.filename}</A> }, { h: "Size", r: (r: any) => `${Math.round(r.size_bytes / 1024)} KB`, num: true }, { h: "Shared with party", r: (r: any) => (r.shared_with_party ? "yes" : "no"), hideSm: true }, { h: "Added", r: (r: any) => date(r.created_at), hideSm: true }]} />
    {can(auth.membership.role, "master.write") && <form action={undefined} />}
    {can(auth.membership.role, "master.write") && <ActionForm action={uploadDocument} submit="Upload" className="mt-3" resetOnOk><Hidden name="entity" value={entity} /><Hidden name="entity_id" value={id} /><label className="label" htmlFor={`file-${id}`}>Add a file (PDF, PNG, JPG, CSV, TXT, XLSX · max 10 MB)</label><input id={`file-${id}`} type="file" name="file" required className="input py-2" /><label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" name="share" className="h-4 w-4" /> Visible to the customer/supplier in their portal</label></ActionForm>}</Card>;
}
