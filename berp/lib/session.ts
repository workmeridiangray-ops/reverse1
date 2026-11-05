import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role = "owner" | "manager" | "sales" | "purchasing" | "warehouse" | "accountant" | "viewer";
export type Ctx = {
  userId: string; email: string; role: Role; tenant: { id: string; name: string; plan_code: string; status: string; trial_ends_at: string };
  workspaces: { tenant_id: string; name: string; role: Role }[]; isPlatformAdmin: boolean;
};

/** Signed-in user + active workspace, or redirect. RLS still guards every query. */
export async function requireCtx(): Promise<Ctx> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const [{ data: prof }, { data: mem }, { data: pa }] = await Promise.all([
    sb.from("profiles").select("active_tenant_id").eq("user_id", user.id).maybeSingle(),
    sb.from("memberships").select("tenant_id, role, tenants(name)").eq("user_id", user.id).eq("active", true),
    sb.rpc("am_platform_admin"),
  ]);
  const workspaces = (mem ?? []).map((m: any) => ({ tenant_id: m.tenant_id, name: m.tenants?.name ?? "", role: m.role as Role }));
  const active = workspaces.find((w) => w.tenant_id === prof?.active_tenant_id);
  if (!active) redirect("/workspaces");
  const { data: t } = await sb.from("tenants").select("id,name,plan_code,status,trial_ends_at").eq("id", active.tenant_id).single();
  if (!t) redirect("/workspaces");
  return { userId: user.id, email: user.email ?? "", role: active.role, tenant: t, workspaces, isPlatformAdmin: pa === true };
}

export const can = (role: Role, ...roles: Role[]) => roles.includes(role);
