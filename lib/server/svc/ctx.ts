import type { Role } from "../perms";
export type Ctx = { companyId: string; userId: string; role: Role; plantIds: string[]; label?: string; ip?: string | null };
export const actor = (x: Ctx) => ({ userId: x.userId, companyId: x.companyId, label: x.label, ip: x.ip });
