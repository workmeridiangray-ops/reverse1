import type { Metadata } from "next";
import { AppointmentForm } from "@/components/appointments/AppointmentForm";
import { PageHeader } from "@/components/ui/Layout";
import { requireRole } from "@/lib/auth/session";
import { getBookingOptions } from "@/lib/data/appointments";
import { localDateKey } from "@/lib/rules/time";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Book appointment" };

export default async function NewAppointmentPage({ searchParams }: { searchParams: Promise<{ patient?: string; date?: string }> }) {
  const session = await requireRole("admin", "receptionist");
  const sp = await searchParams;
  const supabase = await createClient();
  const opts = await getBookingOptions(supabase);
  return (
    <>
      <PageHeader eyebrow="Appointments" title="Book an appointment" description="Clashes are checked before saving. The database also refuses double-booking." />
      <AppointmentForm
        timeZone={session.clinic.timezone}
        initial={{ patient_id: sp.patient ?? "", doctor_id: "", room_id: "", date: sp.date ?? localDateKey(new Date(), session.clinic.timezone), time: "", duration: "20", reason: "" }}
        patients={opts.patients.map((p) => ({ id: p.id, label: `${p.family_name}, ${p.given_name} · ${p.mrn}` }))}
        doctors={opts.doctors.map((d) => ({ id: d.id, label: d.full_name }))}
        rooms={opts.rooms.map((r) => ({ id: r.id, label: r.out_of_service ? `${r.name} (out of service)` : r.name, disabled: r.out_of_service }))}
      />
    </>
  );
}
