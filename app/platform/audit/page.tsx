import { DateTimeText } from "@/components/ui/Format";
import { Card, PageHeader } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { requirePlatform } from "@/lib/server/auth";
import { tx } from "@/lib/server/db";

export const metadata = { title: "Platform audit log" };
export default async function PAudit() {
  const a = await requirePlatform();
  const rows = await tx({ userId: a.user.id, platform: true }, (db) => db.q<{ id: number; at: Date; action: string; tname: string | null; uname: string | null }>("SELECT l.id,l.at,l.action,t.name tname,u.name uname FROM audit_log l LEFT JOIN tenants t ON t.id=l.tenant_id LEFT JOIN users u ON u.id=l.user_id WHERE l.action LIKE 'platform.%' OR l.action LIKE 'tenant.%' OR l.action LIKE 'auth.%' OR l.action LIKE 'plan.%' OR l.action LIKE 'billing.%' ORDER BY l.id DESC LIMIT 200"));
  return (<><PageHeader title="Audit log" description="Platform-level and account events. Customer record changes stay in each business's own trail." />
    <Card><Table caption="Audit"><thead><tr><Th>When</Th><Th>Business</Th><Th>User</Th><Th>Action</Th></tr></thead><tbody>{rows.map((r) => <tr key={r.id}><Td><DateTimeText at={r.at} /></Td><Td>{r.tname ?? "—"}</Td><Td>{r.uname ?? "—"}</Td><Td className="font-bold">{r.action}</Td></tr>)}</tbody></Table></Card></>);
}
