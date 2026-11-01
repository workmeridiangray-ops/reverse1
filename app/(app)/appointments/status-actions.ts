"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { APPOINTMENT_STATUSES, canTransition } from "@/lib/rules/appointment-status";
import type { AppointmentStatus } from "@/lib/rules/scheduling";
import { friendlyDbError } from "@/lib/data/errors";
import { createClient } from "@/lib/supabase/server";

function isStatus(v: unknown): v is AppointmentStatus {
  return typeof v === "string" && (APPOINTMENT_STATUSES as readonly string[]).includes(v);
}

/**
 * Move an appointment through the visit (check in, send to room, done...).
 * The rule check here gives a clear message; the database trigger enforces
 * the same table (lib/rules/appointment-status.ts) regardless.
 */
export async function setAppointmentStatus(form: FormData): Promise<void> {
  const session = await requireRole("admin", "receptionist", "doctor");
  const id = String(form.get("id") ?? "");
  const to = form.get("to");
  const back = String(form.get("back") ?? "/reception");
  const safeBack = back.startsWith("/") && !back.startsWith("//") ? back : "/reception";
  const fail = (msg: string) => redirect(`${safeBack}${safeBack.includes("?") ? "&" : "?"}error=${encodeURIComponent(msg)}`);
  if (!id || !isStatus(to)) return fail("Unknown action.");

  const supabase = await createClient();
  const { data: current } = await supabase.from("appointments").select("status, room_id").eq("id", id).maybeSingle();
  if (!current) return fail("Appointment not found.");
  if (!canTransition(current.status as AppointmentStatus, to)) {
    return fail(`Can't move this appointment from ${current.status.replace("_", " ")} to ${to.replace("_", " ")}.`);
  }

  const update: { status: AppointmentStatus; room_id?: string; cancelled_reason?: string } = { status: to };
  if (to === "in_room" && session.role !== "doctor") {
    const room = String(form.get("room_id") ?? "");
    if (room) update.room_id = room;
    else if (!current.room_id) return fail("Choose a room before sending the patient in.");
  }
  if (to === "cancelled") {
    const reason = String(form.get("reason") ?? "").trim();
    if (!reason) return fail("Give a reason for cancelling.");
    update.cancelled_reason = reason;
  }

  const { error } = await supabase.from("appointments").update(update).eq("id", id);
  if (error) return fail(friendlyDbError(error.message));
  revalidatePath(safeBack.split("?")[0] ?? "/reception");
  redirect(safeBack);
}
