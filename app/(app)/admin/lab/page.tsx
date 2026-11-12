import type { Metadata } from "next";
import { RangeFields } from "@/components/clinical/RangeFields";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { DateText } from "@/components/ui/Format";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { requireRole } from "@/lib/auth/session";
import { getRangesByTest } from "@/lib/data/clinical";
import { coverageGaps, describeGap } from "@/lib/rules/lab-flags";
import { createClient } from "@/lib/supabase/server";
import { addRange, addTest, deleteRange, setTestActive, updateRange } from "./actions";

export const metadata: Metadata = { title: "Lab tests and ranges" };
export const dynamic = "force-dynamic";

const SEX = { any: "Any sex", female: "Women", male: "Men" } as const;
const limit = (v: number | null) => (v === null ? "–" : String(v));

export default async function AdminLabPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const session = await requireRole("admin");
  const { ok, error } = await searchParams;
  const supabase = await createClient();
  const [tests, ranges] = await Promise.all([
    supabase.from("lab_test_types").select("id, code, name, unit, active").order("name"),
    getRangesByTest(supabase),
  ]);
  if (tests.error) throw new Error(tests.error.message);
  const unreviewed = [...ranges.values()].flat().filter((r) => !r.reviewed).length;
  const tz = session.clinic.timezone;

  return (
    <>
      <PageHeader eyebrow="Administration" title="Lab tests and reference ranges"
        description="Results are flagged using the range that matches the patient's sex and age. If no range matches, the result is not flagged. You edit the numbers; a doctor signs them off." />
      <div className="mb-gutter flex flex-col gap-3">
        {error ? <Alert tone="danger" title="That didn't work">{error}</Alert> : null}
        {ok ? <Alert tone="ok" title={ok} /> : null}
        {unreviewed > 0 ? (
          <Alert tone="warn" title={`${unreviewed} range${unreviewed > 1 ? "s" : ""} not reviewed by a clinician`}>
            Results flagged from these say so on screen. Ask a doctor to sign them off on their &ldquo;Lab ranges&rdquo; page. Editing the numbers of a signed-off range clears its sign-off.
          </Alert>
        ) : null}
      </div>
      <div className="flex flex-col gap-gutter">
        {tests.data.length === 0 ? <EmptyState title="No tests set up" /> : tests.data.map((t) => {
          const list = ranges.get(t.id) ?? [];
          const gaps = coverageGaps(list);
          return (
            <Card key={t.id} title={`${t.name} (${t.code}), ${t.unit}`}
              actions={
                <form action={setTestActive} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={t.id} /><input type="hidden" name="active" value={String(!t.active)} />
                  {t.active ? null : <Badge visual={{ tone: "neutral", icon: "lock", label: "Hidden from new orders" }} size="sm" />}
                  <Button type="submit" size="sm" variant="ghost">{t.active ? "Hide from new orders" : "Show again"}</Button>
                </form>
              }>
              {list.length > 0 ? (
                <Table caption={`Reference ranges for ${t.name}`}>
                  <thead><tr><Th>Who</Th><Th>Age (years)</Th><Th className="text-right">Critical below</Th><Th className="text-right">Normal</Th><Th className="text-right">Critical above</Th><Th>Review</Th><Th><span className="sr-only">Edit</span></Th></tr></thead>
                  <tbody>
                    {list.map((r) => (
                      <tr key={r.id}>
                        <Td>{SEX[r.sex]}</Td>
                        <Td className="font-mono">{r.ageMinYears}–{r.ageMaxYears >= 200 ? "up" : r.ageMaxYears - 1}</Td>
                        <Td className="text-right font-mono">{limit(r.criticalLow)}</Td>
                        <Td className="text-right font-mono">{limit(r.low)} to {limit(r.high)}</Td>
                        <Td className="text-right font-mono">{limit(r.criticalHigh)}</Td>
                        <Td>
                          {r.reviewed ? <Badge visual={{ tone: "ok", icon: "shield", label: "Signed off" }} size="sm" /> : <Badge visual={{ tone: "warn", icon: "alert", label: "Not reviewed" }} size="sm" />}
                          {r.reviewed && r.reviewedAt ? <p className="mt-1 text-caption text-ink-700">{r.reviewedBy}, <DateText at={r.reviewedAt} timeZone={tz} /></p> : null}
                          {r.note ? <p className="mt-1 max-w-[14rem] text-caption text-ink-500">{r.note}</p> : null}
                        </Td>
                        <Td>
                          <details className="min-w-[8rem]">
                            <summary className="cursor-pointer text-sm font-bold text-brand-700">Edit<span className="sr-only"> {SEX[r.sex]} range for {t.name}</span></summary>
                            <form action={updateRange} className="mt-3 flex min-w-[34rem] flex-col gap-3 rounded border border-line bg-canvas p-4">
                              <input type="hidden" name="id" value={r.id} />
                              <RangeFields idp={`e-${r.id}`} initial={{ sex: r.sex, ageMin: r.ageMinYears, ageMax: r.ageMaxYears, low: r.low, high: r.high, criticalLow: r.criticalLow, criticalHigh: r.criticalHigh, note: r.note }} />
                              {r.reviewed ? <p className="text-sm font-bold text-warn-fg">Changing the numbers will clear {r.reviewedBy}&apos;s sign-off.</p> : null}
                              <div className="flex gap-2"><Button type="submit" size="sm" variant="primary">Save</Button></div>
                            </form>
                            <form action={deleteRange} className="mt-2"><input type="hidden" name="id" value={r.id} /><Button type="submit" size="sm" variant="ghost">Delete this range</Button></form>
                          </details>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : <p className="text-ink-700">No ranges: results for this test are never flagged.</p>}

              {gaps.length > 0 ? (
                <div className="mt-4 rounded border border-warn-line bg-warn-bg p-3 text-warn-fg">
                  <p className="font-bold">Who would get no flag</p>
                  <ul className="list-disc pl-5 text-sm">{gaps.map((g) => <li key={`${g.who}${g.fromAge}`}>{describeGap(g)}</li>)}</ul>
                  <p className="mt-1 text-sm">That is allowed (no range means no verdict, never a guess), but it should be a choice.</p>
                </div>
              ) : null}

              <details className="mt-4 border-t border-line pt-4">
                <summary className="cursor-pointer font-bold text-brand-700">Add a range</summary>
                <form action={addRange} className="mt-3 flex flex-col gap-3">
                  <input type="hidden" name="test_type_id" value={t.id} />
                  <RangeFields idp={`a-${t.id}`} />
                  <p className="text-sm text-ink-700">Order the limits: critical below, normal from, normal up to, critical above. At least one is needed. The database refuses overlapping ranges for the same sex.</p>
                  <div><Button type="submit" variant="secondary" icon="plus">Add range</Button></div>
                </form>
              </details>
            </Card>
          );
        })}

        <Card title="Add a test">
          <form action={addTest} className="grid items-end gap-4 md:grid-cols-[8rem_1fr_8rem_auto]">
            <TextField label="Code" name="code" id="new-code" maxLength={20} hint="e.g. HB" />
            <TextField label="Name" name="name" id="new-name" maxLength={100} />
            <TextField label="Unit" name="unit" id="new-unit" maxLength={20} hint="e.g. g/dL" />
            <Button type="submit" variant="secondary" icon="plus">Add test</Button>
          </form>
          <p className="mt-3 text-sm text-ink-500">A test&apos;s code and unit can&apos;t be changed once it has results, because that would change what the numbers on patients&apos; records mean.</p>
        </Card>
      </div>
    </>
  );
}
