import Link from "next/link";
import type { ReactNode } from "react";
import { PRODUCT_NAME } from "@/lib/brand";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <Link href="/" className="mb-6 text-title font-bold text-ink-900 no-underline">{PRODUCT_NAME}</Link>
      <main id="main" className="rounded-lg border border-line bg-surface p-6 shadow-card">{children}</main>
    </div>
  );
}
