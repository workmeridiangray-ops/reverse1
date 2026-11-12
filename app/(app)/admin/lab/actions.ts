"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { friendlyDbError } from "@/lib/data/errors";
import { parseLimit, validateRange } from "@/lib/rules/lab-flags";
import { createClient } from "@/lib/supabase/server";

function back(params: Record<string, string>): never {
  revalidatePath("/admin/lab");
  redirect(`/admin/lab?${new URLSearchParams(params)}`);
}

export async function addTest(form: FormData): Promise<void> {
  const session = await requireRole("admin");
  const code = String(form.get("code") ?? "").trim().toUpperCase();
  const name = String(form.get("name") ?? "").trim();
  const unit = String(form.get("unit") ?? "").trim();
  if (!/^[A-Z0-9_]{1,20}$/.test(code)) back({ error: "The code is 1 to 20 letters, numbers or underscores, e.g. HB." });
  if (!name || !unit) back({ error: "Give the test a name and a unit." });
  const supabase = await createClient();
  const { error } = await supabase.from("lab_test_types").insert({ clinic_id: session.clinic.id, code, name, unit });
  if (error) back({ error: friendlyDbError(error.message) });
  back({ ok: `Added ${name}. It has no reference ranges yet, so its results will not be flagged until you add some.` });
}

export async function setTestActive(form: FormData): Promise<void> {
  await requireRole("admin");
  const supabase = await createClient();
  const active = form.get("active") === "true";
  const { error } = await supabase.from("lab_test_types").update({ active }).eq("id", String(form.get("id") ?? ""));
  if (error) back({ error: friendlyDbError(error.message) });
  back({ ok: active ? "Test can be ordered again." : "Test hidden from new orders. Existing results are unchanged." });
}

/** Read and check the range fields from a form. Returns an error message or the row. */
type RangeRow = { sex: "any" | "female" | "male"; age_min_years: number; age_max_years: number; low: number | null; high: number | null; critical_low: number | null; critical_high: number | null; note: string | null };
function readRange(form: FormData): { error: string } | { row: RangeRow } {
  const sex = String(form.get("sex") ?? "any");
  if (!["any", "female", "male"].includes(sex)) return { error: "Choose who the range applies to." };
  const ageMin = Number(String(form.get("age_min") ?? "0") || "0");
  const maxRaw = String(form.get("age_max") ?? "").trim();
  const ageMax = maxRaw === "" ? 200 : Number(maxRaw);
  const parsed = (["low", "high", "critical_low", "critical_high"] as const).map((k) => [k, parseLimit(String(form.get(k) ?? ""))] as const);
  for (const [k, p] of parsed) if (!p.ok) return { error: `${k.replace("_", " ")}: ${p.error}` };
  const v = Object.fromEntries(parsed.map(([k, p]) => [k, p.ok ? p.value : null])) as Record<"low" | "high" | "critical_low" | "critical_high", number | null>;
  const issues = validateRange({ sex: sex as "any" | "female" | "male", ageMinYears: ageMin, ageMaxYears: ageMax, low: v.low, high: v.high, criticalLow: v.critical_low, criticalHigh: v.critical_high });
  if (issues.length) return { error: issues.join(" ") };
  return { row: { sex: sex as "any" | "female" | "male", age_min_years: ageMin, age_max_years: ageMax, low: v.low, high: v.high, critical_low: v.critical_low, critical_high: v.critical_high, note: String(form.get("note") ?? "").trim() || null } };
}

export async function addRange(form: FormData): Promise<void> {
  const session = await requireRole("admin");
  const r = readRange(form);
  if ("error" in r) back({ error: r.error });
  const supabase = await createClient();
  const { error } = await supabase.from("lab_reference_ranges").insert({ clinic_id: session.clinic.id, test_type_id: String(form.get("test_type_id") ?? ""), ...r.row });
  if (error) back({ error: friendlyDbError(error.message) });
  back({ ok: "Range added. A doctor needs to sign it off before it counts as reviewed." });
}

export async function updateRange(form: FormData): Promise<void> {
  await requireRole("admin");
  const r = readRange(form);
  if ("error" in r) back({ error: r.error });
  const supabase = await createClient();
  const { error } = await supabase.from("lab_reference_ranges").update(r.row).eq("id", String(form.get("id") ?? ""));
  if (error) back({ error: friendlyDbError(error.message) });
  back({ ok: "Range saved. If the numbers changed, the doctor's sign-off was cleared and it needs reviewing again." });
}

export async function deleteRange(form: FormData): Promise<void> {
  await requireRole("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.from("lab_reference_ranges").delete().eq("id", String(form.get("id") ?? "")).select("id");
  if (error) back({ error: friendlyDbError(error.message) });
  if (!data?.length) back({ error: "That range no longer exists." });
  back({ ok: "Range deleted." });
}
