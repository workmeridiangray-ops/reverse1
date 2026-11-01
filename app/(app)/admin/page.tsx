import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { Money } from "@/components/ui/Format";
import { Alert, Card, PageHeader } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { requireRole } from "@/lib/auth/session";
import { getReceptionBoard } from "@/lib/data/reception";
import { sum } from "@/lib/rules/money";
import { ROLE_LABEL, ROLES } from "@/lib/rules/routing";
import { ROOM_VISUAL } from "@/lib/ui/status";
import { createClient } from "@/lib/supabase/server";
import { saveRoom, updateStaff } from "./actions";

export const metadata: Metadata = { title: "Administration" };
export const dynamic = "force-dynamic";

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const session = await requireRole("admin");
  const { error, ok } = await searchParams;
  const supabase = await createClient();
  const [board, staff, owing] = await Promise.all([
    getReceptionBoard(supabase, session, new Date()),
    supabase.from("profiles").select("id, full_name, role, active").neq("role", "patient").order("full_name"),
    supabase.from("invoice_balances").select("patient_due_now_minor").in("payment_status", ["unpaid", "partially_paid"]),
  ]);
  const owed = sum((owing.data ?? []).map((o) => Number(o.patient_due_now_minor ?? 0)));
  const staffRoles = ROLES.filter((r) => r !== "patient");

  return (
    <>
      <PageHeader eyebrow={session.clinic.name} title="Clinic administration"
        description={<>Time zone {session.clinic.timezone} · currency {session.clinic.currency} · consent form {session.clinic.consentVersion}</>} />
      <div className="mb-gutter flex flex-col gap-3">
        {error ? <Alert tone="danger" title="That didn't work">{error}</Alert> : null}
        {ok ? <Alert tone="ok" title={ok} /> : null}
      </div>
      <section aria-label="Today" className="mb-section grid gap-gutter md:grid-cols-4">
        {[
          ["Here now", String(board.summary.here)],
          ["Still expected", String(board.summary.expectedRemaining)],
          ["Leaving unpaid", String(board.summary.owesAtCheckout)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-line bg-surface p-5 shadow-card">
            <p className="text-sm font-bold text-ink-500">{k}</p><p className="font-mono text-display">{v}</p>
          </div>
        ))}
        <div className="rounded-lg border border-line bg-surface p-5 shadow-card">
          <p className="text-sm font-bold text-ink-500">Patients owe</p>
          <p className="font-mono text-heading"><Money minor={owed} currency={session.clinic.currency} /></p>
          <Link href="/billing?show=owing" className="text-sm">See invoices</Link>
        </div>
      </section>

      <div className="grid gap-gutter xl:grid-cols-[1fr_28rem]">
        <Card title="Staff" actions={<Link href="/admin/audit">Audit log</Link>}>
          <Table caption="Staff accounts">
            <thead><tr><Th>Name</Th><Th>Role</Th><Th>Access</Th><Th><span className="sr-only">Save</span></Th></tr></thead>
            <tbody>
              {(staff.data ?? []).map((s) => (
                <tr key={s.id}>
                  <Td className="font-bold">{s.full_name}{s.id === session.userId ? <span className="font-normal text-ink-500"> (you)</span> : null}</Td>
                  <Td colSpan={3}>
                    <form action={updateStaff} className="flex flex-wrap items-center gap-3">
                      <input type="hidden" name="id" value={s.id} />
                      <label htmlFor={`role-${s.id}`} className="sr-only">Role for {s.full_name}</label>
                      <select id={`role-${s.id}`} name="role" defaultValue={s.role} className="min-h-touch rounded border border-ink-500 bg-surface px-2">
                        {staffRoles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" name="active" defaultChecked={s.active} className="h-5 w-5 accent-brand-700" />
                        <span>Active<span className="sr-only"> for {s.full_name}</span></span>
                      </label>
                      {!s.active ? <Badge visual={{ tone: "neutral", icon: "lock", label: "No access" }} size="sm" /> : null}
                      <Button type="submit" size="sm" variant="secondary" className="ml-auto">Save<span className="sr-only"> {s.full_name}</span></Button>
                    </form>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="mt-4 text-sm text-ink-500">Deactivating someone removes their access to every record at once. Inviting new staff arrives with the settings phase.</p>
        </Card>

        <Card title="Rooms">
          <ul className="flex flex-col gap-4">
            {board.rooms.map((r) => (
              <li key={r.id} className="rounded border border-line p-4">
                <form action={saveRoom} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="id" value={r.id} />
                  <div className="flex-1"><TextField label="Name" name="name" defaultValue={r.name} id={`room-${r.id}`} /></div>
                  <input type="hidden" name="kind" value="consult" />
                  <label className="flex min-h-touch items-center gap-2">
                    <input type="checkbox" name="out_of_service" defaultChecked={r.state === "out_of_service"} className="h-5 w-5 accent-brand-700" />
                    Out of service
                  </label>
                  <Button type="submit" size="sm" variant="secondary">Save</Button>
                </form>
                <div className="mt-2"><Badge visual={ROOM_VISUAL[r.state]} size="sm" /></div>
              </li>
            ))}
          </ul>
          <form action={saveRoom} className="mt-6 flex flex-col gap-4 border-t border-line pt-6">
            <h3 className="font-bold">Add a room</h3>
            <TextField label="Room name" name="name" maxLength={60} />
            <SelectField label="Type" name="kind" defaultValue="consult">
              <option value="consult">Consultation</option><option value="procedure">Procedure</option>
              <option value="lab">Lab / sampling</option><option value="other">Other</option>
            </SelectField>
            <div><Button type="submit" variant="primary" icon="plus">Add room</Button></div>
          </form>
        </Card>
      </div>
    </>
  );
}
