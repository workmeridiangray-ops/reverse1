import type { Metadata } from "next";
import { OrderForm } from "@/components/patients/OrderForm";
import { PageHeader } from "@/components/ui/Layout";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "New investigation" };
export const dynamic = "force-dynamic";

export default async function NewOrder({ searchParams }: { searchParams: Promise<{ patient?: string }> }) {
  await requireRole("doctor");
  const { patient } = await searchParams;
  const { data } = await (await createClient()).from("patients").select("id, mrn, given_name, family_name").is("archived_at", null).order("family_name").limit(1000);
  return (<><PageHeader eyebrow="Investigations" title="Order a test or scan" />
    <OrderForm patients={(data ?? []).map((p) => ({ id: p.id, label: `${p.family_name}, ${p.given_name} (${p.mrn})` }))} defaultPatient={patient} /></>);
}
