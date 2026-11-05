import type { ReactNode } from "react";
import { AppShell } from "@/components/app/AppShell";
import { requireCtx } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export default async function Layout({ children }: { children: ReactNode }) {
  const c = await requireCtx(undefined, { allowLocked: true });
  return <AppShell c={c}>{children}</AppShell>;
}
