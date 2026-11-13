import type { ReactNode } from "react";
import { Logo } from "@/components/shell/Logo";
import { NavLinks } from "@/components/shell/NavLinks";
import { Icon } from "@/components/ui/Icon";
import { requireSession } from "@/lib/auth/session";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { navFor, ROLE_LABEL } from "@/lib/rules/routing";
import { signOut } from "../(auth)/actions";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  const { count } = await (await createClient()).from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-surface focus:px-4 focus:py-2 focus:shadow-raised">
        Skip to main content
      </a>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-page flex-wrap items-center gap-x-8 gap-y-3 px-6 py-3">
          <a href="/" className="no-underline"><Logo /><span className="sr-only"> home</span></a>
          <NavLinks items={navFor(session.role)} />
          <div className="ml-auto flex items-center gap-4">
            <div className="text-right leading-tight">
              <p className="font-bold">{session.fullName}</p>
              <p className="text-caption text-ink-500">{ROLE_LABEL[session.role]} · {session.clinic.name}</p>
            </div>
            <Link href="/notifications" className="flex min-h-touch items-center rounded px-3 font-bold text-ink-700 no-underline hover:bg-sunken">Notifications{count ? <span className="ml-1.5 rounded-pill bg-brand-700 px-2 text-sm text-white" aria-label={`${count} unread`}>{count}</span> : null}</Link>
            <form action={signOut}>
              <button type="submit" className="flex min-h-touch items-center gap-2 rounded px-3 font-bold text-ink-700 hover:bg-sunken">
                <Icon name="logout" /> Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-page px-6 py-section">
        {children}
      </main>
    </>
  );
}
