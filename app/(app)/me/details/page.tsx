import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui/Layout";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { DetailsForm } from "./DetailsForm";

export const metadata: Metadata = { title: "My details" };
export const dynamic = "force-dynamic";

export default async function MyDetailsPage() {
  const session = await requireRole("patient");
  const supabase = await createClient();
  const { data: p } = await supabase.from("patients").select("given_name, family_name, mrn, phone, email, address, consent_communication").maybeSingle();
  if (!p) notFound();
  return (
    <>
      <PageHeader eyebrow={session.clinic.name} title="My details" description={<>{p.given_name} {p.family_name} · <span className="font-mono">{p.mrn}</span></>} />
      <Card title="Contact details">
        <DetailsForm initial={{ phone: p.phone ?? "", email: p.email ?? "", address: p.address ?? "", communication: p.consent_communication }} />
      </Card>
    </>
  );
}
