import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { DateTimeText } from "@/components/ui/Format";
import { Table, Td, Th } from "@/components/ui/Table";
import { acknowledgeResult, cancelLabOrder, releaseResult } from "@/app/(app)/doctor/clinical-actions";
import type { LabOrderView, LabResultView } from "@/lib/data/clinical";
import { isCritical } from "@/lib/rules/lab-flags";
import { LAB_FLAG_VISUAL, LAB_ORDER_VISUAL, RESULT_RELEASE_VISUAL } from "@/lib/ui/status";

export function rangeText(r: Pick<LabResultView, "refLow" | "refHigh">): string {
  if (r.refLow !== null && r.refHigh !== null) return `${r.refLow}–${r.refHigh}`;
  if (r.refHigh !== null) return `up to ${r.refHigh}`;
  if (r.refLow !== null) return `from ${r.refLow}`;
  return "";
}

/** One lab order with its results. Doctor actions show only when `doctorId` owns the order. */
export function LabOrderCard({ order, tz, backPath, doctorId }: { order: LabOrderView; tz: string; backPath: string; doctorId?: string }) {
  const mine = !!doctorId && order.orderedById === doctorId;
  const canCancel = mine && (order.status === "ordered" || order.status === "collected") && order.results.every((r) => r.value === null);
  return (
    <article className="rounded border border-line" aria-label={`Lab order from ${order.orderedAt}`}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-canvas px-4 py-3">
        <p className="text-sm text-ink-700">
          Ordered <DateTimeText at={order.orderedAt} timeZone={tz} /> by {order.orderedByName}
          {order.clinicalNotes ? <> · <em>{order.clinicalNotes}</em></> : null}
        </p>
        <Badge visual={LAB_ORDER_VISUAL[order.status]} size="sm" />
      </header>
      {order.status === "cancelled" ? <p className="px-4 py-3 text-sm text-ink-700">Cancelled: {order.cancelledReason}</p> : (
        <div className="p-2">
          <Table caption="Results for this order">
            <thead><tr><Th>Test</Th><Th className="text-right">Result</Th><Th>Flag</Th><Th>Reference</Th><Th>Patient</Th>{mine ? <Th><span className="sr-only">Actions</span></Th> : null}</tr></thead>
            <tbody>
              {order.results.map((r) => (
                <tr key={r.id} className={r.flag && isCritical(r.flag) ? "bg-danger-bg" : undefined}>
                  <Td className="font-bold">{r.testName}</Td>
                  <Td className="text-right">{r.value === null ? <span className="text-ink-500">Waiting</span> : <span className="font-mono text-lg">{r.value} <span className="text-sm text-ink-500">{r.unit}</span></span>}</Td>
                  <Td>{r.flag ? <Badge visual={LAB_FLAG_VISUAL[r.flag]} size="sm" /> : null}</Td>
                  <Td className="text-sm">
                    {rangeText(r) ? <span className="font-mono">{rangeText(r)}</span> : r.flag === "unflagged" ? "None on file for this patient" : ""}
                    {r.value !== null && r.rangeReviewed === false ? <p className="text-caption text-warn-fg">Placeholder range, not clinician-reviewed</p> : null}
                  </Td>
                  <Td className="text-sm">{r.value !== null ? <Badge visual={r.releasedAt ? RESULT_RELEASE_VISUAL.released : RESULT_RELEASE_VISUAL.held} size="sm" /> : null}</Td>
                  {mine ? (
                    <Td className="text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        {r.flag && isCritical(r.flag) && !r.acknowledgedAt ? (
                          <form action={acknowledgeResult}>
                            <input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value={backPath} />
                            <Button type="submit" size="sm" variant="primary">Acknowledge<span className="sr-only"> {r.testName}</span></Button>
                          </form>
                        ) : r.flag && isCritical(r.flag) ? <span className="text-sm text-ok-fg">Acknowledged</span> : null}
                        {r.value !== null && !r.releasedAt ? (
                          <form action={releaseResult}>
                            <input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value={backPath} />
                            <Button type="submit" size="sm" variant="secondary">Release to patient<span className="sr-only">: {r.testName}</span></Button>
                          </form>
                        ) : null}
                      </div>
                    </Td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      {canCancel ? (
        <details className="border-t border-line px-4 py-3">
          <summary className="cursor-pointer text-sm font-bold text-brand-700">Cancel this order</summary>
          <form action={cancelLabOrder} className="mt-2 flex flex-wrap items-end gap-3">
            <input type="hidden" name="id" value={order.id} /><input type="hidden" name="back" value={backPath} />
            <TextField label="Reason" name="reason" id={`cancel-${order.id}`} maxLength={200} />
            <Button type="submit" size="sm" variant="danger">Cancel order</Button>
          </form>
        </details>
      ) : null}
    </article>
  );
}
