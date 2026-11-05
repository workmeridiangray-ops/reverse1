import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { PRODUCT_NAME } from "@/lib/brand";
import { requirePlatform } from "@/lib/server/auth";
import { signOut } from "@/app/(auth)/actions";

export const dynamic = "force-dynamic";
export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const a = await requirePlatform();
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-ink-900 text-white">
        <div className="mx-auto flex max-w-page flex-wrap items-center justify-between gap-3 px-4 py-2">
          <span className="font-bold">{PRODUCT_NAME} · Platform console</span>
          <nav aria-label="Platform" className="flex flex-wrap items-center gap-1 text-sm">
            {[["Overview", "/platform"], ["Businesses", "/platform/tenants"], ["Background jobs", "/platform/jobs"], ["Leads", "/platform/leads"], ["Audit log", "/platform/audit"]].map(([l, h]) => <Link key={h} href={h!} className="inline-flex min-h-touch items-center px-3 text-white no-underline hover:underline">{l}</Link>)}
            <span className="px-2 text-ink-300">{a.user.email}</span>
            <form action={signOut}><Button type="submit" variant="secondary" size="sm">Sign out</Button></form>
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-page px-4 py-6">{children}</main>
    </div>
  );
}
