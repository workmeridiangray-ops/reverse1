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
