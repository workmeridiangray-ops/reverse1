"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/lib/rules/routing";

export function NavLinks({ items }: { items: NavItem[] }) {
  const path = usePathname();
  const active = (href: string) =>
    // Longest matching nav item wins, so /admin/audit doesn't also light up /admin.
    items
      .filter((i) => path === i.href || path.startsWith(`${i.href}/`))
      .sort((a, b) => b.href.length - a.href.length)[0]?.href === href;
  return (
    <nav aria-label="Main">
      <ul className="flex flex-wrap gap-1">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active(item.href) ? "page" : undefined}
              className="flex min-h-touch items-center rounded px-3 font-bold text-ink-700 no-underline hover:bg-sunken hover:text-ink-900 aria-[current=page]:bg-brand-50 aria-[current=page]:text-brand-700 aria-[current=page]:shadow-[inset_0_-3px_0_theme(colors.brand.700)]"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
