import type { Metadata } from "next";
import { PageHeader, Placeholder } from "@/components/ui/Layout";
import { requireRole } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Lab" };

export default async function LabHome() {
  const session = await requireRole("lab", "admin");
  return (
    <>
      <PageHeader eyebrow={session.clinic.name} title="Laboratory" />
      <Placeholder phase="Coming in Phase 2">
        Lab orders and results will appear here. Results will be flagged against reference ranges chosen by sex and age.
        If no range is on file, a result will not be flagged. Ranges must be reviewed by a clinician before use.
      </Placeholder>
    </>
  );
}
