import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { DateTimeText, Money } from "@/components/ui/Format";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { requireRole } from "@/lib/auth/session";
import { logAccess } from "@/lib/data/audit";
import { getInvoice } from "@/lib/data/billing";
import type { InsuranceStatus, InvoiceState } from "@/lib/rules/invoice";
import { lineTotal, toMajorString } from "@/lib/rules/money";
import { INSURANCE_VISUAL, INVOICE_STATE_VISUAL, PAYMENT_VISUAL } from "@/lib/ui/status";
import { createClient } from "@/lib/supabase/server";
import { addLine, issueInvoice, recordPayment, removeLine, updateInsurance, voidInvoice } from "../actions";

export const metadata: Metadata = { title: "Invoice" };
export const dynamic = "force-dynamic";

const METHOD_LABEL = { cash: "Cash", card: "Card", bank_transfer: "Bank transfer", other: "Other" } as const;

export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const session = await requireRole("admin", "receptionist");
  const { id } = await params;
  const { error, ok } = await searchParams;
  const supabase = await createClient();
  const data = await getInvoice(supabase, id);
  if (!data) notFound();
  await logAccess(supabase, "invoices", id);
  const { invoice: inv, balance: b, lines, payments, parityOk } = data;
  const cur = inv.currency;
  const tz = session.clinic.timezone;
  const state = inv.state as InvoiceState;
  const ins = inv.insurance_status as InsuranceStatus;
  const canPay = state === "issued" && b.patientDueNowMinor > 0 && parityOk;

  return (
    <>
      <PageHeader
        eyebrow={`Invoice · ${inv.number}`}
        title={inv.patient ? `${inv.patient.given_name} ${inv.patient.family_name}` : "Invoice"}
        description={<>
          {inv.patient ? <Link href={`/patients/${inv.patient.id}`} className="font-mono">{inv.patient.mrn}</Link> : null}
          {inv.issued_at ? <> · issued <DateTimeText at={inv.issued_at} timeZone={tz} /></> : null}
          {inv.appointment_id ? <> · <Link href={`/appointments/${inv.appointment_id}`}>visit</Link></> : null}
        </>}
        actions={<div className="flex flex-wrap gap-2"><Badge visual={INVOICE_STATE_VISUAL[state]} /><Badge visual={PAYMENT_VISUAL[b.status]} /></div>}
      />
      <div className="mb-gutter flex flex-col gap-3">
        {error ? <Alert tone="danger" title="That didn't work">{error}</Alert> : null}
        {ok ? <Alert tone="ok" title={ok} /> : null}
        {!parityOk ? <Alert tone="danger" title="Figures don't agree">The app and the database calculated this invoice differently. Payments are disabled until this is checked.</Alert> : null}
        {state === "void" ? <Alert tone="warn" title="This invoice is void">{inv.void_reason}</Alert> : null}
      </div>

      <div className="grid gap-gutter lg:grid-cols-[1fr_24rem]">
        <div className="flex flex-col gap-gutter">
          <Card title="Items">
            {lines.length === 0 ? <EmptyState title="No items yet" /> : (
              <Table caption="Invoice items">
                <thead><tr><Th>Description</Th><Th className="text-right">Qty</Th><Th className="text-right">Unit price</Th><Th className="text-right">Amount</Th>{state === "draft" ? <Th><span className="sr-only">Remove</span></Th> : null}</tr></thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <Td>{l.description}</Td>
                      <Td className="text-right font-mono">{l.quantity}</Td>
                      <Td className="text-right"><Money minor={Number(l.unit_price_minor)} currency={cur} /></Td>
                      <Td className="text-right"><Money minor={lineTotal(l.quantity, Number(l.unit_price_minor))} currency={cur} /></Td>
                      {state === "draft" ? (
                        <Td className="text-right">
                          <form action={removeLine}>
                            <input type="hidden" name="invoice_id" value={id} /><input type="hidden" name="line_id" value={l.id} />
                            <Button type="submit" variant="ghost" size="sm">Remove<span className="sr-only"> {l.description}</span></Button>
                          </form>
                        </Td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><Td colSpan={3} className="text-right font-bold">Total</Td><Td className="text-right font-bold"><Money minor={b.totalMinor} currency={cur} /></Td>{state === "draft" ? <Td /> : null}</tr></tfoot>
              </Table>
            )}
            {state === "draft" ? (
              <form action={addLine} className="mt-6 grid items-end gap-4 border-t border-line pt-6 md:grid-cols-[1fr_6rem_9rem_auto]">
                <input type="hidden" name="invoice_id" value={id} />
                <TextField label="Item" name="description" maxLength={200} />
                <TextField label="Qty" name="quantity" type="number" min={1} max={10000} step={1} defaultValue="1" inputMode="numeric" />
                <TextField label={`Unit price (${cur})`} name="unit_price" inputMode="decimal" placeholder="0.00" />
                <Button type="submit" variant="secondary" icon="plus">Add</Button>
              </form>
            ) : null}
          </Card>

          <Card title="Payments">
            {payments.length === 0 ? <p className="text-ink-500">No payments yet.</p> : (
              <Table caption="Payments received">
                <thead><tr><Th>When</Th><Th>Method</Th><Th>Reference</Th><Th>Taken by</Th><Th className="text-right">Amount</Th></tr></thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <Td><DateTimeText at={p.received_at} timeZone={tz} /></Td>
                      <Td>{METHOD_LABEL[p.method as keyof typeof METHOD_LABEL]}</Td>
                      <Td className="text-sm">{p.reference ?? ""}</Td>
                      <Td className="text-sm">{p.receiver?.full_name ?? ""}</Td>
                      <Td className="text-right"><Money minor={Number(p.amount_minor)} currency={cur} /></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {canPay ? (
              <form action={recordPayment} className="mt-6 grid items-end gap-4 border-t border-line pt-6 md:grid-cols-[10rem_10rem_1fr_auto]">
                <input type="hidden" name="invoice_id" value={id} />
                <TextField label={`Amount (${cur})`} name="amount" inputMode="decimal" defaultValue={toMajorString(b.patientDueNowMinor, cur)}
                  hint={`Up to ${toMajorString(b.patientDueNowMinor, cur)}`} />
                <SelectField label="Method" name="method" defaultValue="card">
                  {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </SelectField>
                <TextField label="Reference" name="reference" optional maxLength={100} />
                <Button type="submit" variant="primary">Record payment</Button>
              </form>
            ) : null}
            <p className="mt-4 text-sm text-ink-500">Payments can't be edited or deleted. Partial payments are fine.</p>
          </Card>
        </div>

        <div className="flex flex-col gap-gutter">
          <Card title="Balance" as="aside">
            <dl className="flex flex-col gap-2">
              <Row label="Total"><Money minor={b.totalMinor} currency={cur} /></Row>
              <Row label="Paid by patient"><Money minor={b.patientPaidMinor} currency={cur} /></Row>
              {ins !== "none" ? <Row label="Claimed from insurer"><Money minor={Number(inv.insurance_claimed_minor)} currency={cur} /></Row> : null}
              {ins === "settled" ? <Row label="Paid by insurer"><Money minor={b.insurancePaidMinor} currency={cur} /></Row> : null}
              {b.insuranceAdjustmentMinor > 0 ? <Row label="Insurer adjustment (written off)"><Money minor={b.insuranceAdjustmentMinor} currency={cur} /></Row> : null}
              <div className="my-2 border-t border-line" />
              <Row label="Patient owes now" strong><Money minor={b.patientDueNowMinor} currency={cur} /></Row>
              {ins === "pending" ? <Row label="Waiting on insurer"><Money minor={Math.max(0, b.balanceDueMinor - b.patientDueNowMinor)} currency={cur} /></Row> : null}
            </dl>
          </Card>

          <Card title="Insurance" as="aside" actions={<Badge visual={INSURANCE_VISUAL[ins]} size="sm" />}>
            {state === "void" ? <p className="text-ink-500">Void.</p> : (
              <form action={updateInsurance} className="flex flex-col gap-4">
                <input type="hidden" name="invoice_id" value={id} />
                <SelectField label="Status" name="insurance_status" defaultValue={ins}>
                  <option value="none">Self-pay (no claim)</option>
                  <option value="pending">Claim submitted, pending</option>
                  <option value="settled">Insurer settled</option>
                  <option value="denied">Claim denied</option>
                </SelectField>
                <TextField label="Insurer" name="insurer_name" optional defaultValue={inv.insurer_name ?? ""} maxLength={120} />
                <TextField label={`Amount claimed (${cur})`} name="claimed" optional inputMode="decimal" defaultValue={inv.insurance_claimed_minor ? toMajorString(Number(inv.insurance_claimed_minor), cur) : ""} />
                <TextField label={`Insurer paid (${cur})`} name="insurer_paid" optional inputMode="decimal" hint="Only when settled. Any shortfall is written off, not charged to the patient."
                  defaultValue={inv.insurance_paid_minor ? toMajorString(Number(inv.insurance_paid_minor), cur) : ""} />
                <Button type="submit" variant="secondary">Update insurance</Button>
              </form>
            )}
          </Card>

          {state !== "void" ? (
            <Card title="Invoice" as="aside">
              {state === "draft" ? (
                <form action={issueInvoice} className="mb-6">
                  <input type="hidden" name="invoice_id" value={id} />
                  <Button type="submit" variant="primary" className="w-full" icon="flag">Issue invoice</Button>
                  <p className="mt-2 text-sm text-ink-500">Issuing locks the items so payments can be taken.</p>
                </form>
              ) : null}
              {payments.length === 0 ? (
                <form action={voidInvoice} className="flex flex-col gap-3">
                  <input type="hidden" name="invoice_id" value={id} />
                  <TextField label="Reason for voiding" name="void_reason" maxLength={200} />
                  <Button type="submit" variant="danger" size="sm">Void invoice</Button>
                </form>
              ) : <p className="text-sm text-ink-500">Invoices with payments can't be voided. Refunds arrive in a later phase.</p>}
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

function Row({ label, children, strong }: { label: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? "text-lg font-bold" : ""}`}>
      <dt className={strong ? "" : "text-ink-700"}>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
