import "server-only";
import type { Slot } from "@/lib/rules/scheduling";
import type { AppointmentStatus } from "@/lib/rules/scheduling";
import type { ServerClient } from "@/lib/supabase/server";

/** Existing bookings that could clash with [start, end) for this doctor, room or patient. */
export async function getPotentialConflicts(
  supabase: ServerClient,
  c: { start: Date; end: Date; doctorId: string; roomId: string | null; patientId: string },
): Promise<Slot[]> {
  const who = [`doctor_id.eq.${c.doctorId}`, `patient_id.eq.${c.patientId}`, ...(c.roomId ? [`room_id.eq.${c.roomId}`] : [])];
  const { data, error } = await supabase
    .from("appointments")
    .select("id, starts_at, ends_at, doctor_id, room_id, patient_id, status")
    .or(who.join(","))
    .lt("starts_at", c.end.toISOString())
    .gt("ends_at", c.start.toISOString());
  if (error) throw new Error(error.message);
  return data.map((a) => ({
    id: a.id,
    startsAt: new Date(a.starts_at),
    endsAt: new Date(a.ends_at),
    doctorId: a.doctor_id,
    roomId: a.room_id,
    patientId: a.patient_id,
    status: a.status as AppointmentStatus,
  }));
}

export async function getBookingOptions(supabase: ServerClient) {
  const [doctors, rooms, patients] = await Promise.all([
    supabase.from("profiles").select("id, full_name").eq("role", "doctor").eq("active", true).order("full_name"),
    supabase.from("rooms").select("id, name, out_of_service").order("name"),
    supabase.from("patients").select("id, mrn, given_name, family_name").is("archived_at", null).order("family_name").limit(1000),
  ]);
  for (const r of [doctors, rooms, patients]) if (r.error) throw new Error(r.error.message);
  return { doctors: doctors.data ?? [], rooms: rooms.data ?? [], patients: patients.data ?? [] };
}
