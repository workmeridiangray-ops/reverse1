/** Role → permission matrix. Enforced on the server; the UI only hides what the server would refuse. */
export const ROLES = ["owner", "manager", "engineer", "procurement", "accounts", "viewer", "client", "consultant"] as const;
export type Role = (typeof ROLES)[number];
export const isRole = (v: unknown): v is Role => typeof v === "string" && (ROLES as readonly string[]).includes(v);
export const EXTERNAL_ROLES: readonly Role[] = ["client", "consultant"];
export const isExternal = (r: Role) => EXTERNAL_ROLES.includes(r);

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Business owner", manager: "Project manager", engineer: "Site engineer", procurement: "Procurement",
  accounts: "Accounts", viewer: "Read-only", client: "Client (portal)", consultant: "Consultant (portal)",
};

const READ = ["project.view", "boq.view", "drawing.view", "report.view"] as const;
const P = {
  owner: ["*"],
  manager: [...READ, "project.create", "project.edit", "boq.edit", "budget.view", "contract.edit", "contract.approve",
    "measure.record", "measure.verify", "bill.view", "bill.prepare", "bill.certify", "invoice.view", "variation.request", "variation.approve",
    "material.request", "material.approve", "po.view", "report.write", "report.verify", "drawing.manage", "drawing.approve",
    "rfi.raise", "rfi.respond", "inspection.manage", "snag.manage", "supplier.view", "audit.view", "export", "team.view", "project.access"],
  engineer: [...READ, "measure.record", "material.request", "report.write", "rfi.raise", "inspection.manage", "snag.manage", "variation.request"],
  procurement: [...READ, "material.request", "po.view", "po.manage", "grn.manage", "supplier.view", "supplier.manage"],
  accounts: [...READ, "bill.view", "bill.prepare", "invoice.view", "invoice.create", "receipt.record", "dispute.manage", "export", "po.view", "supplier.view", "budget.view"],
  viewer: [...READ],
  client: ["project.view", "boq.view", "drawing.view", "report.view", "bill.view", "bill.certify", "invoice.view", "variation.decide", "rfi.respond", "dispute.raise", "portal"],
  consultant: ["project.view", "boq.view", "drawing.view", "report.view", "bill.view", "bill.certify", "variation.decide", "rfi.respond", "portal"],
} as const satisfies Record<Role, readonly string[]>;

export type Permission = string;
export function can(role: Role, perm: Permission): boolean {
  const set = P[role] as readonly string[];
  return set.includes("*") || set.includes(perm);
}
export function permissionsOf(role: Role): readonly string[] {
  return P[role];
}

/** Segregation of duties: the person who prepared/recorded/requested may not also approve. */
export function violatesSeparation(actorId: string, preparerId: string | null | undefined): boolean {
  return !!preparerId && actorId === preparerId;
}
