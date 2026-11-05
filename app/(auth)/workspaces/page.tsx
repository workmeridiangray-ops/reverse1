import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Alert, EmptyState } from "@/components/ui/Layout";
import { requireUser } from "@/lib/server/auth";
import { tx } from "@/lib/server/db";
import { ROLE_LABEL, isRole } from "@/lib/rules/permissions";
import { selectWorkspace, signOut } from "../actions";
import Link from "next/link";

export const metadata = { title: "Choose a workspace" };
export default async function Workspaces({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const a = await requireUser();
  const { next } = await searchParams;
  const rows = await tx({ userId: a.user.id }, (db) => db.q<{ tenant_id: string; name: string; role: string; status: string; tstatus: string }>(
    `SELECT m.tenant_id, t.name, m.role, m.status, t.status tstatus FROM memberships m JOIN tenants t ON t.id = m.tenant_id WHERE m.user_id = $1 ORDER BY t.name`, [a.user.id]));
  return (
    <>
      <h1 className="mb-1 text-heading font-bold">Choose a workspace</h1>
      <p className="mb-4 text-ink-700">Signed in as {a.user.email}. Each business is separate; switching is always explicit.</p>
      {rows.length === 0 ? <EmptyState title="You have no workspace yet">Ask a business owner to invite you, or <Link href="/signup">start your own</Link>.</EmptyState> : null}
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.tenant_id} className="rounded border border-line p-4">
            <p className="font-bold">{r.name}</p>
            <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-ink-500">{isRole(r.role) ? ROLE_LABEL[r.role] : r.role} {r.tstatus === "suspended" ? <Badge status="suspended" /> : null}{r.status === "suspended" ? <Badge status="suspended" detail="your access" /> : null}</p>
            {r.status === "active" ? (
              <form action={selectWorkspace}><input type="hidden" name="tenant_id" value={r.tenant_id} /><input type="hidden" name="next" value={next ?? ""} /><Button type="submit">Open workspace</Button></form>
            ) : <Alert tone="warn">Your access to this business is suspended.</Alert>}
          </li>
        ))}
      </ul>
      <form action={signOut} className="mt-6"><Button variant="ghost" type="submit">Sign out</Button></form>
    </>
  );
}
