"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { friendlyDbError } from "@/lib/data/errors";
import { validateMyDetails, validateRequest } from "@/lib/rules/portal";
import { createClient } from "@/lib/supabase/server";

export interface RequestState {
  errors?: Partial<Record<"preferred" | "reason" | "form", string>>;
  values?: { preferred: string; reason: string };
}

export async function createRequest(_prev: RequestState, form: FormData): Promise<RequestState> {
  const session = await requireRole("patient");
  const values = { preferred: String(form.get("preferred") ?? ""), reason: String(form.get("reason") ?? "") };
  const supabase = await createClient();
  const { data: me } = await supabase.from("patients").select("id").maybeSingle();
  if (!me) return { errors: { form: "We couldn't find your record." }, values };
  const { count } = await supabase.from("appointment_requests").select("id", { count: "exact", head: true }).eq("status", "open");
  const errors = validateRequest(values, count ?? 0);
  if (Object.keys(errors).length) return { errors, values };
  const { error } = await supabase.from("appointment_requests").insert({
    clinic_id: session.clinic.id, patient_id: me.id, preferred: values.preferred.trim(), reason: values.reason.trim(),
  });
  if (error) return { errors: { form: friendlyDbError(error.message) }, values };
  revalidatePath("/me");
  redirect("/me/request?ok=" + encodeURIComponent("Request sent. The clinic will reply with a time."));
}

export async function cancelRequest(form: FormData): Promise<void> {
  await requireRole("patient");
  const supabase = await createClient();
  const { error } = await supabase.from("appointment_requests").update({ status: "cancelled" }).eq("id", String(form.get("id") ?? "")).eq("status", "open");
  revalidatePath("/me/request");
  redirect(`/me/request?${error ? `error=${encodeURIComponent(friendlyDbError(error.message))}` : "ok=" + encodeURIComponent("Request cancelled.")}`);
}

export interface DetailsState {
  errors?: Partial<Record<"phone" | "email" | "address" | "form", string>>;
  values?: { phone: string; email: string; address: string; communication: boolean };
}

export async function updateDetails(_prev: DetailsState, form: FormData): Promise<DetailsState> {
  await requireRole("patient");
  const values = {
    phone: String(form.get("phone") ?? "").trim(),
    email: String(form.get("email") ?? "").trim(),
    address: String(form.get("address") ?? "").trim(),
    communication: form.get("communication") === "on",
  };
  const errors = validateMyDetails(values);
  if (values.address.length > 300) (errors as Record<string, string>).address = "Keep your address under 300 characters.";
  if (Object.keys(errors).length) return { errors, values };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_my_details", {
    p_phone: values.phone, p_email: values.email, p_address: values.address, p_communication: values.communication,
  });
  if (error) return { errors: { form: friendlyDbError(error.message) }, values };
  revalidatePath("/me");
  redirect("/me?ok=" + encodeURIComponent("Your details were updated."));
}
