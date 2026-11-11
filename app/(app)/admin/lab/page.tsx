import type { Metadata } from "next";
import { Badge } from "@/components/ui/Badge";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { Table, Td, Th } from "@/components/ui/Table";
import { requireRole } from "@/lib/auth/session";
import { getRangesByTest } from "@/lib/data/clinical";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Lab tests and ranges" };
export const dynamic = "force-dynamic";

const SEX = { any: "Any sex", female: "Female", male: "Male" } as const;
const limit = (v: number | null) => (v === null ? "–" : String(v));

export default async function AdminLabPage() {
  await requireRole("admin");
  const supabase = await createClient();
  const [tests, ranges] = await Promise.all([
    supabase.from("lab_test_types").select("id, code, name, unit, active").order("name"),
    getRangesByTest(supabase),
  ]);
  if (tests.error) throw new Error(tests.error.message);
  const unreviewed = [...ranges.values()].flat().filter((r) => !r.reviewed).length;
  return (
    <>
      <PageHeader eyebrow="Administration" title="Lab tests and reference ranges"
        description="Results are flagged using the range that matches the patient's sex and age. If no range matches, the result is not flagged." />
      {unreviewed > 0 ? (
        <div className="mb-gutter">
          <Alert tone="warn" title={`${unreviewed} range${unreviewed > 1 ? "s" : ""} not reviewed by a clinician`}>
            These are placeholders. Results flagged from them say so on screen. Replace them with ranges your laboratory or a clinician has signed off before real use.
          </Alert>
        </div>
      ) : null}
      <div className="flex flex-col gap-gutter">
        {tests.data.length === 0 ? <EmptyState title="No tests set up" /> : tests.data.map((t) => (
          <Card key={t.id} title={`${t.name} (${t.code}), ${t.unit}`} actions={t.active ? null : <Badge visual={{ tone: "neutral", icon: "lock", label: "Inactive" }} size="sm" />}>
            <Table caption={`Reference ranges for ${t.name}`}>
              <thead><tr><Th>Sex</Th><Th>Age (years)</Th><Th className="text-right">Low</Th><Th className="text-right">High</Th><Th className="text-right">Critical below</Th><Th className="text-right">Critical above</Th><Th>Review</Th></tr></thead>
              <tbody>
                {(ranges.get(t.id) ?? []).map((r) => (
                  <tr key={r.id}>
                    <Td>{SEX[r.sex]}</Td>
                    <Td className="font-mono">{r.ageMinYears}–{r.ageMaxYears >= 200 ? "up" : r.ageMaxYears - 1}</Td>
                    <Td className="text-right font-mono">{limit(r.low)}</Td><Td className="text-right font-mono">{limit(r.high)}</Td>
                    <Td className="text-right font-mono">{limit(r.criticalLow)}</Td><Td className="text-right font-mono">{limit(r.criticalHigh)}</Td>
                    <Td>{r.reviewed ? <Badge visual={{ tone: "ok", icon: "shield", label: "Reviewed" }} size="sm" detail={r.reviewedBy ?? undefined} /> : <Badge visual={{ tone: "warn", icon: "alert", label: "Not reviewed" }} size="sm" />}</Td>
                  </tr>
                ))}
                {(ranges.get(t.id) ?? []).length === 0 ? <tr><Td colSpan={7} className="text-ink-500">No ranges: results for this test are never flagged.</Td></tr> : null}
              </tbody>
            </Table>
          </Card>
        ))}
      </div>
      <p className="mt-section text-sm text-ink-500">Editing ranges and recording clinician review arrives with the settings phase. The database already refuses overlapping or contradictory ranges.</p>
    </>
  );
}
