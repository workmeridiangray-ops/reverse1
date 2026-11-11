"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { friendlyDbError } from "@/lib/data/errors";
import { createClient } from "@/lib/supabase/server";

export async function declineRequest(form: FormData): Promise<void> {
  await requireRole("admin", "receptionist");
  const reason = String(form.get("reason") ?? "").trim();
  const back = (p: Record<string, string>) => { revalidatePath("/appointments/requests"); redirect(`/appointments/requests?${new URLSearchParams(p)}`); };
  if (reason.length < 3) back({ error: "Tell the patient why, so they can try another time." });
  const supabase = await createClient();
  const { error } = await supabase.from("appointment_requests").update({ status: "declined", decline_reason: reason }).eq("id", String(form.get("id") ?? "")).eq("status", "open");
  if (error) back({ error: friendlyDbError(error.message) });
  back({ ok: "Request declined. The patient can see your reason." });
}
