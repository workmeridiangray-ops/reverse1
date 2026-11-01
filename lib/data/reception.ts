import "server-only";
import { buildBoard, roomStatuses, type BoardAppointment } from "@/lib/rules/reception";
import { consentState } from "@/lib/rules/patient";
import type { PaymentStatus } from "@/lib/rules/invoice";
import type { AppointmentStatus } from "@/lib/rules/scheduling";
import { dayBounds, localDateKey } from "@/lib/rules/time";
import type { Session } from "@/lib/auth/session";
import type { ServerClient } from "@/lib/supabase/server";

export interface DayAppointment extends BoardAppointment {
  patientId: string;
  doctorId: string;
  reason: string | null;
  invoiceId: string | null;
  patientDueNowMinor: number;
}

/** All appointments for one clinic-local day, with patient, doctor, room and payment state. */
export async function getDayAppointments(
  supabase: ServerClient,
  session: Session,
  dateKey: string,
  opts: { doctorId?: string } = {},
): Promise<DayAppointment[]> {
  const { start, end } = dayBounds(dateKey, session.clinic.timezone);
  let query = supabase
    .from("appointments")
    .select(
      `id, starts_at, ends_at, status, checked_in_at, roomed_at, reason, patient_id, doctor_id, room_id,
       patient:patients!appointments_patient_id_clinic_id_fkey(given_name, family_name, consent_treatment_at, consent_data_processing_at, consent_communication, consent_version),
       doctor:profiles!appointments_doctor_id_clinic_id_fkey(full_name),
       room:rooms!appointments_room_id_clinic_id_fkey(name)`,
    )
    .gte("starts_at", start.toISOString())
    .lt("starts_at", end.toISOString())
    .order("starts_at");
  if (opts.doctorId) query = query.eq("doctor_id", opts.doctorId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const ids = data.map((a) => a.id);
  const invoices = new Map<string, { id: string; status: PaymentStatus; dueNow: number }>();
  if (ids.length > 0 && (session.role === "admin" || session.role === "receptionist")) {
    const { data: bal, error: balErr } = await supabase
      .from("invoice_balances")
      .select("invoice_id, appointment_id, payment_status, patient_due_now_minor, state")
      .in("appointment_id", ids)
      .neq("state", "void");
    if (balErr) throw new Error(balErr.message);
    for (const b of bal ?? []) {
      if (b.appointment_id && b.invoice_id) {
        invoices.set(b.appointment_id, {
          id: b.invoice_id,
          status: b.payment_status as PaymentStatus,
          dueNow: Number(b.patient_due_now_minor ?? 0),
        });
      }
    }
  }

  return data.map((a) => {
    const inv = invoices.get(a.id);
    const p = a.patient;
    return {
      id: a.id,
      patientId: a.patient_id,
      doctorId: a.doctor_id,
      startsAt: new Date(a.starts_at),
      endsAt: new Date(a.ends_at),
      status: a.status as AppointmentStatus,
      checkedInAt: a.checked_in_at ? new Date(a.checked_in_at) : null,
      roomedAt: a.roomed_at ? new Date(a.roomed_at) : null,
      patientName: p ? `${p.given_name} ${p.family_name}` : "Unknown patient",
      doctorName: a.doctor?.full_name ?? "",
      roomId: a.room_id,
      roomName: a.room?.name ?? null,
      reason: a.reason,
      paymentStatus: inv?.status ?? null,
      invoiceId: inv?.id ?? null,
      patientDueNowMinor: inv?.dueNow ?? 0,
      consentMissing: p
        ? consentState(
            {
              consentTreatmentAt: p.consent_treatment_at,
              consentDataProcessingAt: p.consent_data_processing_at,
              consentCommunication: p.consent_communication,
              consentVersion: p.consent_version,
            },
            session.clinic.consentVersion,
          ) !== "complete"
        : true,
    };
  });
}

export async function getRooms(supabase: ServerClient) {
  const { data, error } = await supabase.from("rooms").select("id, name, kind, out_of_service").order("name");
  if (error) throw new Error(error.message);
  return data;
}

export async function getReceptionBoard(supabase: ServerClient, session: Session, now: Date) {
  const today = localDateKey(now, session.clinic.timezone);
  const [appointments, rooms] = await Promise.all([getDayAppointments(supabase, session, today), getRooms(supabase)]);
  const board = buildBoard(appointments, now);
  const roomBoard = roomStatuses(
    rooms.map((r) => ({ id: r.id, name: r.name, outOfService: r.out_of_service })),
    appointments,
    now,
  );
  const byId = new Map(appointments.map((a) => [a.id, a]));
  return {
    today,
    rows: board.rows.map((r) => ({ ...r, ...byId.get(r.id)!, group: r.group, isNext: r.isNext, waitingMinutes: r.waitingMinutes, lateMinutes: r.lateMinutes, owesAtCheckout: r.owesAtCheckout })),
    summary: board.summary,
    rooms: roomBoard,
    freeRooms: roomBoard.filter((r) => r.state === "free" || r.state === "reserved_soon"),
  };
}

export type ReceptionBoardData = Awaited<ReturnType<typeof getReceptionBoard>>;
