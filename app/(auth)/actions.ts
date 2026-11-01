"use server";
import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/rules/routing";
import { createClient } from "@/lib/supabase/server";

export interface SignInState {
  error?: string;
  email?: string;
}

export async function signIn(_prev: SignInState, form: FormData): Promise<SignInState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password.", email };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  // Same message for unknown email and wrong password: don't reveal which accounts exist.
  if (error) return { error: "That email and password don't match an account.", email };
  redirect(safeNextPath(String(form.get("next") ?? "/")));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
