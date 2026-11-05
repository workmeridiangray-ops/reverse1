export const ROLES = ["owner", "manager", "planner", "buyer", "storekeeper", "supervisor", "operator", "quality", "sales", "finance", "viewer", "customer", "supplier"] as const;
export type Role = (typeof ROLES)[number];
export type Perm =
  | "master.read" | "master.write" | "eng.write" | "eng.approve" | "sales.read" | "sales.write" | "plan.run" | "plan.release"
  | "proc.read" | "proc.write" | "proc.approve" | "inv.read" | "inv.post" | "inv.adjust" | "prod.read" | "prod.write" | "shop.operate"
  | "qa.read" | "qa.write" | "qa.decide" | "cost.read" | "cost.adjust" | "ship.read" | "ship.write" | "report.read" | "export"
  | "admin.users" | "admin.billing" | "audit.read" | "settings";
const all: Perm[] = ["master.read","master.write","eng.write","eng.approve","sales.read","sales.write","plan.run","plan.release","proc.read","proc.write","proc.approve","inv.read","inv.post","inv.adjust","prod.read","prod.write","shop.operate","qa.read","qa.write","qa.decide","cost.read","cost.adjust","ship.read","ship.write","report.read","export","admin.users","admin.billing","audit.read","settings"];
const read: Perm[] = ["master.read","sales.read","proc.read","inv.read","prod.read","qa.read","ship.read","report.read"];
export const ROLE_PERMS: Record<Role, Perm[]> = {
  owner: all,
  manager: all.filter((p) => p !== "admin.billing" && p !== "settings"),
  planner: [...read, "eng.write", "plan.run", "plan.release", "prod.write", "master.write", "sales.write"],
  buyer: [...read, "proc.write", "proc.approve", "master.write"].filter((p) => p !== "proc.approve") as Perm[],
  storekeeper: [...read, "inv.post", "proc.write"],
  supervisor: [...read, "prod.write", "shop.operate", "inv.post", "qa.write"],
  operator: ["prod.read", "inv.read", "shop.operate"],
  quality: [...read, "qa.write", "qa.decide"],
  sales: [...read, "sales.write", "ship.write"],
  finance: [...read, "cost.read", "cost.adjust", "export", "proc.approve"],
  viewer: read,
  customer: [],
  supplier: [],
};
export const can = (role: Role, p: Perm) => ROLE_PERMS[role]?.includes(p) ?? false;
export const isPortal = (r: Role) => r === "customer" || r === "supplier";
export const ROLE_LABEL: Record<Role, string> = { owner: "Business owner", manager: "Manager", planner: "Planner", buyer: "Buyer", storekeeper: "Storekeeper", supervisor: "Shop supervisor", operator: "Operator", quality: "Quality inspector", sales: "Sales", finance: "Finance", viewer: "Viewer", customer: "Customer (portal)", supplier: "Supplier (portal)" };
/** Sensitive permissions shown in the role editor. */
export const SENSITIVE: Perm[] = ["eng.approve", "proc.approve", "inv.adjust", "cost.adjust", "export", "admin.users", "admin.billing", "qa.decide"];
