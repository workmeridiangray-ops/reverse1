import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { DateTimeText } from "@/components/ui/Format";
import { Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { requireRole } from "@/lib/auth/session";
import { getOpenLabOrders, getRecentlyResulted } from "@/lib/data/clinical";
import { isCritical } from "@/lib/rules/lab-flags";
import { LAB_FLAG_VISUAL, LAB_ORDER_VISUAL } from "@/lib/ui/status";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Lab" };
export const dynamic = "force-dynamic";

export default async function LabHome() {
  const session = await requireRole("lab");
  const supabase = await createClient();
  const [open, done] = await Promise.all([getOpenLabOrders(supabase), getRecentlyResulted(supabase)]);
  const tz = session.clinic.timezone;
  const waitingCollect = open.filter((o) => o.status === "ordered").length;
  return (
    <>
      <PageHeader eyebrow={session.clinic.name} title="Laboratory"
        description={<>{open.length} orders waiting · {waitingCollect} samples to collect</>} />
      <div className="grid gap-gutter xl:grid-cols-[1fr_26rem]">
        <Card title="Waiting for results">
          {open.length === 0 ? <EmptyState title="Nothing waiting">New orders from doctors appear here.</EmptyState> : (
            <Table caption="Lab orders waiting for results, oldest first">
              <thead><tr><Th>Ordered</Th><Th>Patient</Th><Th>Tests</Th><Th>By</Th><Th>Status</Th><Th><span className="sr-only">Open</span></Th></tr></thead>
              <tbody>
                {open.map((o) => (
                  <tr key={o.id}>
                    <Td className="text-sm"><DateTimeText at={o.orderedAt} timeZone={tz} /></Td>
                    <Td className="font-bold">{o.patientName}</Td>
                    <Td className="text-sm">{o.results.map((r) => r.testName).join(", ")}</Td>
                    <Td className="text-sm">{o.orderedByName}</Td>
                    <Td><Badge visual={LAB_ORDER_VISUAL[o.status]} size="sm" /></Td>
                    <Td className="text-right"><ButtonLink href={`/lab/orders/${o.id}`} size="sm" variant="primary">Enter results<span className="sr-only"> for {o.patientName}</span></ButtonLink></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card title="Recently resulted" as="aside">
          {done.length === 0 ? <p className="text-ink-500">None yet.</p> : (
            <ul className="flex flex-col gap-4">
              {done.map((o) => (
                <li key={o.id}>
                  <Link href={`/lab/orders/${o.id}`} className="font-bold">{o.patientName}</Link>
                  <ul className="mt-1 flex flex-col gap-1">
                    {o.results.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span>{r.testName} <span className="font-mono">{r.value} {r.unit}</span></span>
                        {r.flag ? <Badge visual={LAB_FLAG_VISUAL[r.flag]} size="sm" detail={isCritical(r.flag) && !r.acknowledgedAt ? "unacknowledged" : undefined} /> : null}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
