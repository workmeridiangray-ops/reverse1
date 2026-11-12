import type { Metadata } from "next";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CheckboxField } from "@/components/ui/Field";
import { DateText } from "@/components/ui/Format";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { requireRole } from "@/lib/auth/session";
import { getRangesByTest } from "@/lib/data/clinical";
import { createClient } from "@/lib/supabase/server";
import { signOffRange, withdrawSignOff } from "./actions";

export const metadata: Metadata = { title: "Lab ranges to review" };
export const dynamic = "force-dynamic";

const SEX = { any: "Anyone", female: "Women", male: "Men" } as const;
const limit = (v: number | null) => (v === null ? "none" : String(v));

export default async function DoctorRangesPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const session = await requireRole("doctor");
  const { ok, error } = await searchParams;
  const supabase = await createClient();
  const [tests, ranges] = await Promise.all([supabase.from("lab_test_types").select("id, code, name, unit").order("name"), getRangesByTest(supabase)]);
  if (tests.error) throw new Error(tests.error.message);
  const waiting = [...ranges.values()].flat().filter((r) => !r.reviewed).length;
  const tz = session.clinic.timezone;
  return (
    <>
      <PageHeader eyebrow="Clinical sign-off" title="Lab reference ranges"
        description="These numbers decide which results are flagged low, high or critical. Your sign-off says you have checked them for this clinic's patients. An administrator can edit the numbers but not sign them off, and any change to the numbers clears your sign-off." />
      <div className="mb-gutter flex flex-col gap-3">
        {error ? <Alert tone="danger" title="That didn't work">{error}</Alert> : null}
        {ok ? <Alert tone="ok" title={ok} /> : null}
        {waiting > 0 ? <Alert tone="warn" title={`${waiting} range${waiting > 1 ? "s" : ""} waiting for review`}>Until signed off, results flagged from them say &ldquo;placeholder range, not clinician-reviewed&rdquo;.</Alert> : <Alert tone="ok" title="Every range has been signed off" />}
      </div>
      <div className="flex flex-col gap-gutter">
        {tests.data.length === 0 ? <EmptyState title="No tests set up" /> : tests.data.map((t) => (
          <Card key={t.id} title={`${t.name} (${t.code}), ${t.unit}`}>
            {(ranges.get(t.id) ?? []).length === 0 ? <p className="text-ink-700">No ranges: this test&apos;s results are never flagged.</p> : (
              <Table caption={`Ranges for ${t.name}`}>
                <thead><tr><Th>Who</Th><Th>Age</Th><Th className="text-right">Critical below</Th><Th className="text-right">Normal</Th><Th className="text-right">Critical above</Th><Th>Status</Th></tr></thead>
                <tbody>
                  {(ranges.get(t.id) ?? []).map((r) => (
                    <tr key={r.id}>
                      <Td className="font-bold">{SEX[r.sex]}</Td>
                      <Td className="font-mono">{r.ageMinYears}–{r.ageMaxYears >= 200 ? "up" : r.ageMaxYears - 1}</Td>
                      <Td className="text-right font-mono">{limit(r.criticalLow)}</Td>
                      <Td className="text-right font-mono">{limit(r.low)} to {limit(r.high)}</Td>
                      <Td className="text-right font-mono">{limit(r.criticalHigh)}</Td>
                      <Td>
                        {r.reviewed ? (
                          <div>
                            <Badge visual={{ tone: "ok", icon: "shield", label: "Signed off" }} size="sm" />
                            <p className="mt-1 text-caption text-ink-700">{r.reviewedBy}{r.reviewedAt ? <>, <DateText at={r.reviewedAt} timeZone={tz} /></> : null}</p>
                            <form action={withdrawSignOff} className="mt-1"><input type="hidden" name="id" value={r.id} /><Button type="submit" size="sm" variant="ghost">Withdraw<span className="sr-only"> sign-off for {t.name}, {SEX[r.sex]}</span></Button></form>
                          </div>
                        ) : (
                          <form action={signOffRange} className="flex min-w-[15rem] flex-col gap-2">
                            <Badge visual={{ tone: "warn", icon: "alert", label: "Not reviewed" }} size="sm" />
                            <input type="hidden" name="id" value={r.id} />
                            <CheckboxField label="I have checked these limits" name={`confirm`} id={`confirm-${r.id}`} />
                            <div><Button type="submit" size="sm" variant="primary" icon="shield">Sign off<span className="sr-only"> {t.name}, {SEX[r.sex]}</span></Button></div>
                          </form>
                        )}
                        {r.note ? <p className="mt-1 max-w-[16rem] text-caption text-ink-500">Source: {r.note}</p> : null}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
