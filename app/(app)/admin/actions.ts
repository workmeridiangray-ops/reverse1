"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { friendlyDbError } from "@/lib/data/errors";
import { isRole } from "@/lib/rules/routing";
import { createClient } from "@/lib/supabase/server";

function done(params: Record<string, string>): never {
  revalidatePath("/admin");
  redirect(`/admin?${new URLSearchParams(params)}`);
}

export async function updateStaff(form: FormData): Promise<void> {
  const session = await requireRole("admin");
  const id = String(form.get("id") ?? "");
  const role = String(form.get("role") ?? "");
  const active = form.get("active") === "on";
  if (!isRole(role) || role === "patient") done({ error: "Choose a staff role." });
  if (id === session.userId && (role !== "admin" || !active)) done({ error: "You can't remove your own admin access." });
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").update({ role, active }).eq("id", id).select("id");
  if (error) done({ error: friendlyDbError(error.message) });
  if (!data?.length) done({ error: "Staff member not found." });
  done({ ok: "Staff member updated." });
}

export async function saveRoom(form: FormData): Promise<void> {
  const session = await requireRole("admin");
  const id = String(form.get("id") ?? "");
  const name = String(form.get("name") ?? "").trim();
  const kind = String(form.get("kind") ?? "consult");
  const outOfService = form.get("out_of_service") === "on";
  if (!name) done({ error: "Give the room a name." });
  if (!["consult", "procedure", "lab", "other"].includes(kind)) done({ error: "Choose a room type." });
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("rooms").update({ name, kind, out_of_service: outOfService }).eq("id", id)
    : await supabase.from("rooms").insert({ clinic_id: session.clinic.id, name, kind, out_of_service: outOfService });
  if (error) done({ error: friendlyDbError(error.message) });
  done({ ok: id ? "Room updated." : "Room added." });
}

export async function saveWard(form: FormData): Promise<void> {
  const session = await requireRole("admin");
  const id = String(form.get("id") ?? "");
  const name = String(form.get("name") ?? "").trim();
  const kind = String(form.get("kind") ?? "general");
  const active = form.get("active") === "on" || !id;
  if (!name) wardsDone({ error: "Give the ward a name." });
  if (!["general", "surgical", "maternity", "paediatric", "icu", "emergency", "other"].includes(kind)) wardsDone({ error: "Choose a ward type." });
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("wards").update({ name, kind, active }).eq("id", id)
    : await supabase.from("wards").insert({ clinic_id: session.clinic.id, name, kind });
  if (error) wardsDone({ error: friendlyDbError(error.message) });
  wardsDone({ ok: id ? "Ward updated." : "Ward added." });
}

export async function saveBed(form: FormData): Promise<void> {
  const session = await requireRole("admin");
  const id = String(form.get("id") ?? "");
  const label = String(form.get("label") ?? "").trim();
  const wardId = String(form.get("ward_id") ?? "");
  const out = form.get("out_of_service") === "on";
  if (!label) wardsDone({ error: "Give the bed a label." });
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("beds").update({ label, out_of_service: out }).eq("id", id)
    : await supabase.from("beds").insert({ clinic_id: session.clinic.id, ward_id: wardId, label });
  if (error) wardsDone({ error: friendlyDbError(error.message) });
  wardsDone({ ok: id ? "Bed updated." : "Bed added." });
}

export async function savePolicy(form: FormData): Promise<void> {
  const session = await requireRole("admin");
  const supabase = await createClient();
  const { error } = await supabase.from("clinics").update({
    require_deposit_for_elective: form.get("require_deposit_for_elective") === "on",
    emergency_requires_finance_clearance: form.get("emergency_requires_finance_clearance") === "on",
  }).eq("id", session.clinic.id);
  if (error) wardsDone({ error: friendlyDbError(error.message) });
  wardsDone({ ok: "Admission policy saved." });
}

function wardsDone(params: Record<string, string>): never {
  revalidatePath("/admin/wards");
  revalidatePath("/wards");
  redirect(`/admin/wards?${new URLSearchParams(params)}`);
}
