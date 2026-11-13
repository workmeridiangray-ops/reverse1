import type { Metadata } from "next";
import { ProcedureForm } from "@/components/patients/ProcedureForm";
import { PageHeader } from "@/components/ui/Layout";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Request procedure" };
export const dynamic = "force-dynamic";

export default async function NewProcedure() {
  const session = await requireRole("doctor");
  const supabase = await createClient();
  const [pts, docs] = await Promise.all([
    supabase.from("patients").select("id, mrn, given_name, family_name").is("archived_at", null).order("family_name").limit(1000),
    supabase.from("profiles").select("id, full_name").eq("role", "doctor").eq("active", true).order("full_name"),
  ]);
  return (<><PageHeader eyebrow="Theatre" title="Request a procedure" />
    <ProcedureForm me={session.userId} patients={(pts.data ?? []).map((p) => ({ id: p.id, label: `${p.family_name}, ${p.given_name} (${p.mrn})` }))} doctors={(docs.data ?? []).map((d) => ({ id: d.id, name: d.full_name }))} /></>);
}
