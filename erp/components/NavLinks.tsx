"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
export type NavGroup = { title: string; links: [string, string][] };
export function NavLinks({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  const active = (h: string) => (h === "/app" ? path === "/app" : path === h || path.startsWith(h + "/"));
  return (
    <nav className="nav" aria-label="Sections" onClick={() => document.body.classList.remove("nav-open")}>
      {groups.map((g) => (
        <div key={g.title || "top"}>{g.title && <h4>{g.title}</h4>}
          {g.links.map(([l, h]) => <Link key={h} href={h} aria-current={active(h) ? "page" : undefined}>{l}</Link>)}</div>))}
    </nav>
  );
}
