import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { HOME_BY_ROLE, isRole, type Role } from "@/lib/rules/routing";
import { createClient } from "@/lib/supabase/server";

export interface Session {
  userId: string;
  role: Role;
  fullName: string;
  clinic: { id: string; name: string; timezone: string; currency: string; consentVersion: string };
}

/** The signed-in user's profile and clinic, once per request. */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name, active, clinic_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.active || !isRole(profile.role)) return null;
  const { data: clinic } = await supabase
    .from("clinics")
    .select("id, name, timezone, currency, consent_form_version")
    .eq("id", profile.clinic_id)
    .single();
  if (!clinic) return null;
  return {
    userId: user.id,
    role: profile.role,
    fullName: profile.full_name,
    clinic: {
      id: clinic.id,
      name: clinic.name,
      timezone: clinic.timezone,
      currency: clinic.currency,
      consentVersion: clinic.consent_form_version,
    },
  };
});

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/** Second line of defence after middleware; RLS is the third. */
export async function requireRole(...roles: Role[]): Promise<Session> {
  const session = await requireSession();
  if (!roles.includes(session.role)) redirect(HOME_BY_ROLE[session.role]);
  return session;
}
