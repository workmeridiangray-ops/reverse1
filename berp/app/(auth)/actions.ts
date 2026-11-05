"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const msg = (e: string) => encodeURIComponent(e);

export async function signIn(form: FormData) {
  const sb = await createClient();
  const { error } = await sb.auth.signInWithPassword({ email: String(form.get("email") ?? "").trim(), password: String(form.get("password") ?? "") });
  if (error) redirect(`/login?error=${msg("Email or password is incorrect.")}`);
  const next = String(form.get("next") ?? "");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/app");
}

export async function signUp(form: FormData) {
  const sb = await createClient();
  const password = String(form.get("password") ?? "");
  if (password.length < 10) redirect(`/signup?error=${msg("Use at least 10 characters for the password.")}`);
  const { data, error } = await sb.auth.signUp({ email: String(form.get("email") ?? "").trim(), password, options: { data: { full_name: String(form.get("name") ?? "") } } });
  if (error) redirect(`/signup?error=${msg(error.message)}`);
  if (!data.session) redirect(`/login?ok=${msg("Check your email to verify your address, then sign in.")}`);
  const company = String(form.get("company") ?? "").trim();
  if (company.length >= 2) {
    const { error: e2 } = await sb.rpc("create_workspace", { p_name: company });
    if (e2) redirect(`/workspaces?error=${msg(e2.message)}`);
  }
  redirect("/app");
}

export async function signOut() {
  const sb = await createClient();
  await sb.auth.signOut();
  redirect("/");
}
