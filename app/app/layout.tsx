import { requireCompany } from "@/lib/server/auth";
import { AppShell } from "@/components/AppShell";
import { redirect } from "next/navigation";
import { isPortal } from "@/lib/server/perms";
export const dynamic = "force-dynamic";
export default async function L({ children }: { children: React.ReactNode }) {
  const a = await requireCompany(undefined, { allowSuspended: true });
  if (isPortal(a.membership.role)) redirect("/portal");
  return <AppShell auth={a}>{children}</AppShell>;
}
