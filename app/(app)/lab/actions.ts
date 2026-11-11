"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { friendlyDbError } from "@/lib/data/errors";
import { parseResultValue } from "@/lib/rules/lab-flags";
import { createClient } from "@/lib/supabase/server";

function back(id: string, params: Record<string, string>): never {
  revalidatePath("/lab");
  revalidatePath(`/lab/orders/${id}`);
  redirect(`/lab/orders/${id}?${new URLSearchParams(params)}`);
}

export async function markCollected(form: FormData): Promise<void> {
  await requireRole("lab");
  const id = String(form.get("id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.from("lab_orders").update({ status: "collected" }).eq("id", id).eq("status", "ordered");
  if (error) back(id, { error: friendlyDbError(error.message) });
  back(id, { ok: "Sample marked as collected." });
}

/**
 * Save the values typed on the entry screen. The flag is NOT sent: the
 * database picks the reference range for this patient's sex and age and
 * computes it, so it cannot be mistyped or forged.
 */
export async function saveResults(form: FormData): Promise<void> {
  await requireRole("lab");
  const id = String(form.get("order_id") ?? "");
  const entries = [...form.entries()].filter(([k, v]) => k.startsWith("value_") && typeof v === "string" && v.trim() !== "");
  if (entries.length === 0) back(id, { error: "Enter at least one value." });

  const parsed: Array<{ resultId: string; value: number; comment: string | null }> = [];
  for (const [key, raw] of entries) {
    const resultId = key.slice("value_".length);
    const p = parseResultValue(String(raw));
    if (!p.ok) back(id, { error: p.error });
    else parsed.push({ resultId, value: p.value, comment: String(form.get(`comment_${resultId}`) ?? "").trim() || null });
  }

  const supabase = await createClient();
  let saved = 0;
  for (const r of parsed) {
    const { data: current } = await supabase.from("lab_results").select("value, comment").eq("id", r.resultId).maybeSingle();
    if (current && Number(current.value) === r.value && (current.comment ?? null) === r.comment) continue; // unchanged
    const { error } = await supabase.from("lab_results").update({ value: r.value, comment: r.comment }).eq("id", r.resultId);
    if (error) back(id, { error: friendlyDbError(error.message) });
    saved++;
  }
  back(id, saved ? { ok: `Saved ${saved} result${saved > 1 ? "s" : ""}.` } : { ok: "Nothing changed." });
}
