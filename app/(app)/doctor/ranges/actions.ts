"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { friendlyDbError } from "@/lib/data/errors";
import { createClient } from "@/lib/supabase/server";

function back(params: Record<string, string>): never {
  revalidatePath("/doctor/ranges");
  revalidatePath("/doctor");
  redirect(`/doctor/ranges?${new URLSearchParams(params)}`);
}

/** Signing off is a clinical statement, so it needs an explicit tick. The database stamps who and when. */
export async function signOffRange(form: FormData): Promise<void> {
  await requireRole("doctor");
  if (form.get("confirm") !== "on") back({ error: "Tick the box to confirm you have checked these limits." });
  const supabase = await createClient();
  const { data, error } = await supabase.from("lab_reference_ranges").update({ reviewed_at: new Date().toISOString() }).eq("id", String(form.get("id") ?? "")).is("reviewed_at", null).select("id");
  if (error) back({ error: friendlyDbError(error.message) });
  if (!data?.length) back({ error: "That range was already signed off, or has changed. Reload and check it again." });
  back({ ok: "Signed off. Results flagged from this range will no longer say it is unreviewed." });
}

export async function withdrawSignOff(form: FormData): Promise<void> {
  await requireRole("doctor");
  const supabase = await createClient();
  const { error } = await supabase.from("lab_reference_ranges").update({ reviewed_at: null }).eq("id", String(form.get("id") ?? ""));
  if (error) back({ error: friendlyDbError(error.message) });
  back({ ok: "Sign-off withdrawn. The range counts as unreviewed again." });
}
