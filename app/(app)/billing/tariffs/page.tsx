import type { Metadata } from "next";
import { Badge } from "@/components/ui/Badge";
import { SelectField, TextField } from "@/components/ui/Field";
import { DateText, Money } from "@/components/ui/Format";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { Table, Td, Th } from "@/components/ui/Table";
import { requireRole } from "@/lib/auth/session";
import { toMajorString } from "@/lib/rules/money";
import { createClient } from "@/lib/supabase/server";
import { activateTariff, createTariff, deleteTariffItem, saveTariffItem } from "../finance-actions";

export const metadata: Metadata = { title: "Tariffs" };
export const dynamic = "force-dynamic";
const CATS = ["bed", "consultation", "procedure", "service", "other"];

export default async function Tariffs({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const session = await requireRole("admin");
  const { ok, error } = await searchParams;
  const supabase = await createClient();
  const [versions, items] = await Promise.all([
    supabase.from("tariff_versions").select("id, name, effective_from, status, activated_at").order("effective_from", { ascending: false }),
    supabase.from("tariff_items").select("id, version_id, code, description, category, unit_price_minor").order("code"),
  ]);
  const cur = session.clinic.currency;
  const VIS = { draft: { tone: "warn", icon: "pencil", label: "Draft" }, active: { tone: "ok", icon: "check", label: "Active" }, retired: { tone: "neutral", icon: "lock", label: "Retired" } } as const;
  return (
    <>
      <PageHeader eyebrow="Billing" title="Tariffs" description="Prices are copied onto each charge when it is added, so activating a new tariff never changes past charges." />
      <div className="mb-gutter flex flex-col gap-3">
        {error ? <Alert tone="danger" title="That didn't work">{error}</Alert> : null}
        {ok ? <Alert tone="ok" title={ok} /> : null}
      </div>
      <div className="flex flex-col gap-gutter">
        {(versions.data ?? []).map((v) => {
          const rows = (items.data ?? []).filter((i) => i.version_id === v.id);
          const draft = v.status === "draft";
          return (
            <Card key={v.id} title={v.name} actions={<Badge visual={VIS[v.status as keyof typeof VIS]} size="sm" />}>
              <p className="mb-4 text-sm text-ink-500">Effective from <DateText at={`${v.effective_from}T12:00:00Z`} timeZone="UTC" /></p>
              {rows.length === 0 ? <EmptyState title="No prices yet" /> : (
                <Table caption={`Prices in ${v.name}`}>
                  <thead><tr><Th>Code</Th><Th>Description</Th><Th>Category</Th><Th className="text-right">Price</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
                  <tbody>{rows.map((r) => (
                    <tr key={r.id}>
                      <Td className="font-mono">{r.code}</Td><Td>{r.description}</Td><Td>{r.category}</Td>
                      <Td className="text-right"><Money minor={Number(r.unit_price_minor)} currency={cur} /></Td>
                      <Td>{draft ? (
                        <div className="flex flex-wrap gap-2">
                          <details><summary className="cursor-pointer font-bold text-brand-700">Edit</summary>
                            <form action={saveTariffItem} className="mt-2 grid w-72 gap-2">
                              <input type="hidden" name="id" value={r.id} /><input type="hidden" name="version_id" value={v.id} />
                              <TextField label="Code" id={`c-${r.id}`} name="code" defaultValue={r.code} />
                              <TextField label="Description" id={`d-${r.id}`} name="description" defaultValue={r.description} />
                              <SelectField label="Category" id={`k-${r.id}`} name="category" defaultValue={r.category}>{CATS.map((c) => <option key={c}>{c}</option>)}</SelectField>
                              <TextField label="Price" id={`p-${r.id}`} name="price" defaultValue={toMajorString(Number(r.unit_price_minor), cur)} inputMode="decimal" />
                              <SubmitButton size="sm" variant="secondary">Save</SubmitButton>
                            </form></details>
                          <form action={deleteTariffItem}><input type="hidden" name="id" value={r.id} /><SubmitButton size="sm" variant="ghost">Remove</SubmitButton></form>
                        </div>) : null}</Td>
                    </tr>))}</tbody>
                </Table>
              )}
              {draft ? (
                <div className="mt-5 flex flex-col gap-5 border-t border-line pt-5">
                  <form action={saveTariffItem} className="grid items-end gap-3 md:grid-cols-[8rem_1fr_9rem_8rem_auto]">
                    <input type="hidden" name="version_id" value={v.id} />
                    <TextField label="Code" id={`nc-${v.id}`} name="code" hint="e.g. XRAY-CHEST" />
                    <TextField label="Description" id={`nd-${v.id}`} name="description" />
                    <SelectField label="Category" id={`nk-${v.id}`} name="category">{CATS.map((c) => <option key={c}>{c}</option>)}</SelectField>
                    <TextField label="Price" id={`np-${v.id}`} name="price" inputMode="decimal" />
                    <SubmitButton size="sm">Add price</SubmitButton>
                  </form>
                  <form action={activateTariff}><input type="hidden" name="version_id" value={v.id} /><SubmitButton variant="primary">Activate this tariff</SubmitButton>
                    <p className="mt-2 text-sm text-ink-500">Retires the current active tariff. Prices can no longer be edited afterwards.</p></form>
                </div>) : null}
            </Card>
          );
        })}
        <Card title="New tariff version">
          <form action={createTariff} className="grid items-end gap-4 md:grid-cols-4">
            <TextField label="Name" id="nt-name" name="name" />
            <TextField label="Effective from" id="nt-date" name="effective_from" type="date" />
            <SelectField label="Copy prices from" id="nt-copy" name="copy_from" optional><option value="">Start empty</option>{(versions.data ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</SelectField>
            <SubmitButton>Create draft</SubmitButton>
          </form>
        </Card>
      </div>
    </>
  );
}
