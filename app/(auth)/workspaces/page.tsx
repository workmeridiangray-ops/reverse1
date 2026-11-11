import { redirect } from "next/navigation";
import { AuthCard } from "@/components/AuthCard";
import { Badge, Note } from "@/components/ui";
import { requireUser } from "@/lib/server/auth";
import { plat } from "@/lib/server/db";
import { switchWorkspaceAction, logoutAction } from "../actions";
import { ROLE_LABEL } from "@/lib/server/perms";
export const metadata = { title: "Choose workspace" };
export const dynamic = "force-dynamic";
export default async function P({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const a = await requireUser(); const sp = await searchParams;
  const rows = (await plat("select c.id, c.name, c.status, m.role from memberships m join companies c on c.id=m.company_id where m.user_id=$1 and m.active order by c.name", [a.user.id])).rows;
  if (rows.length === 0 && a.user.platformRole) redirect("/admin");
  return <AuthCard title="Choose a workspace" sub={`Signed in as ${a.user.email}`}>
    {sp.error && <Note tone="danger">You don’t have access to that workspace.</Note>}
    {rows.length === 0 ? <Note tone="warn">You aren’t a member of any workspace yet. Ask your company owner for an invitation, or <a className="underline" href="/signup">start your own</a>.</Note> :
      <ul className="space-y-2">{rows.map((r) => <li key={r.id}><form action={switchWorkspaceAction}><input type="hidden" name="company" value={r.id} />
        <button className="card flex w-full min-h-[56px] items-center justify-between gap-3 px-4 text-left hover:bg-canvas"><span><span className="block font-medium">{r.name}</span><span className="text-xs text-muted">{ROLE_LABEL[r.role as keyof typeof ROLE_LABEL]}</span></span><Badge s={r.status} /></button></form></li>)}</ul>}
    <form action={logoutAction} className="mt-5"><button className="text-sm text-brand underline">Sign out</button></form>
  </AuthCard>;
}
