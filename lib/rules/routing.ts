/**
 * Role-based routing. Pure.
 *
 * This decides which screens a role may open. It is a convenience layer for
 * the UI: the real access control is row-level security in Postgres, so even
 * a mis-routed user only ever sees rows their role is allowed to read.
 */

export const ROLES = ["admin", "doctor", "receptionist", "nurse", "lab", "pharmacist", "patient"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export const HOME_BY_ROLE: Readonly<Record<Role, string>> = {
  admin: "/admin",
  doctor: "/doctor",
  receptionist: "/reception",
  nurse: "/wards",
  lab: "/lab",
  pharmacist: "/pharmacy",
  patient: "/me",
};

export const ROLE_LABEL: Readonly<Record<Role, string>> = {
  admin: "Administrator",
  doctor: "Doctor",
  receptionist: "Reception",
  nurse: "Nurse",
  lab: "Laboratory",
  pharmacist: "Pharmacy",
  patient: "Patient",
};

/** Route prefix -> roles allowed. Longest matching prefix wins. */
export const ROUTE_ACCESS: ReadonlyArray<readonly [string, readonly Role[]]> = [
  ["/admin", ["admin"]],
  ["/reception", ["receptionist", "admin"]],
  ["/doctor", ["doctor"]],
  ["/lab", ["lab", "admin"]],
  ["/investigations", ["doctor", "nurse", "admin"]],
  ["/investigations/new", ["doctor"]],
  ["/notifications", ["admin", "doctor", "receptionist", "nurse", "lab", "pharmacist", "patient"]],
  ["/pharmacy", ["pharmacist", "admin"]],
  ["/me", ["patient"]],
  ["/patients", ["admin", "receptionist", "doctor", "nurse"]],
  ["/patients/new", ["admin", "receptionist"]],
  ["/appointments", ["admin", "receptionist", "doctor"]],
  ["/appointments/new", ["admin", "receptionist"]],
  ["/billing", ["admin", "receptionist"]],
  ["/billing/tariffs", ["admin"]],
  ["/wards", ["admin", "receptionist", "doctor", "nurse"]],
  ["/admissions", ["admin", "receptionist", "doctor", "nurse", "pharmacist"]],
  ["/admissions/new", ["admin", "receptionist", "doctor"]],
];

/** Signed-out visitors may open these: the marketing site, the demo request form and policies. */
export const PUBLIC_PATHS: readonly string[] = ["/", "/login", "/auth", "/features", "/pricing", "/demo", "/privacy", "/terms"];

function matches(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.some((p) => matches(path, p));
}

export function canAccess(role: Role, path: string): boolean {
  if (path === "/") return true;
  if (isPublicPath(path)) return true;
  let best: readonly [string, readonly Role[]] | undefined;
  for (const entry of ROUTE_ACCESS) {
    if (matches(path, entry[0]) && (!best || entry[0].length > best[0].length)) best = entry;
  }
  // Deny by default: unknown routes are not reachable by any role.
  return best ? best[1].includes(role) : false;
}

/** Where to send a signed-in user who asked for `path`. */
export function resolveDestination(role: Role, path: string): string {
  if (path === "/" || isPublicPath(path) || !canAccess(role, path)) return HOME_BY_ROLE[role];
  return path;
}

/** Only allow same-site relative redirects after login. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  return next;
}

export interface NavItem {
  href: string;
  label: string;
}

export function navFor(role: Role): NavItem[] {
  const items: Record<Role, NavItem[]> = {
    admin: [
      { href: "/admin", label: "Overview" },
      { href: "/reception", label: "Front desk" },
      { href: "/patients", label: "Patients" },
      { href: "/appointments", label: "Appointments" },
      { href: "/billing", label: "Billing" },
      { href: "/billing/tariffs", label: "Tariffs" },
      { href: "/billing/refunds", label: "Refunds" },
      { href: "/wards", label: "Wards" },
      { href: "/admissions", label: "Admissions" },
      { href: "/admin/audit", label: "Audit log" },
    ],
    receptionist: [
      { href: "/reception", label: "Front desk" },
      { href: "/patients", label: "Patients" },
      { href: "/appointments", label: "Appointments" },
      { href: "/billing", label: "Billing" },
      { href: "/billing/refunds", label: "Refunds" },
      { href: "/wards", label: "Wards" },
      { href: "/admissions", label: "Admissions" },
    ],
    doctor: [
      { href: "/doctor", label: "My day" },
      { href: "/patients", label: "Patients" },
      { href: "/appointments", label: "Schedule" },
      { href: "/admissions", label: "Inpatients" },
      { href: "/investigations", label: "Investigations" },
    ],
    nurse: [
      { href: "/wards", label: "Ward census" },
      { href: "/admissions", label: "Admissions" },
      { href: "/patients", label: "Patients" },
      { href: "/investigations", label: "Investigations" },
    ],
    lab: [{ href: "/lab", label: "Lab" }],
    pharmacist: [
      { href: "/pharmacy", label: "Pharmacy" },
      { href: "/admissions", label: "Discharge clearances" },
    ],
    patient: [{ href: "/me", label: "My care" }],
  };
  return items[role];
}
