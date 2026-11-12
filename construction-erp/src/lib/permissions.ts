// Role -> permission matrix. Organisations can override per role (role editor); defaults live here.
export const MODULES = ['project','tender','boq','contract','planning','drawings','rfi','procurement','stores','site','subcontract','quality','safety','billing','variations','handover','team','settings','audit','reports','finance'] as const;
export const ACTIONS = ['view','create','edit','approve','assign','export','refund','configure'] as const;
export type Perm = `${typeof MODULES[number]}:${typeof ACTIONS[number]}`;

const all = (mods: readonly string[], acts: readonly string[]) => mods.flatMap(m => acts.map(a => `${m}:${a}`));
const ALL_ACTIONS = ACTIONS as readonly string[];
const VIEW_ALL = all(MODULES.filter(m => !['safety', 'audit', 'finance', 'settings', 'billing', 'contract'].includes(m)), ['view']);

export const ROLE_DEFAULTS: Record<string, string[]> = {
  owner: all(MODULES, ALL_ACTIONS),
  manager: all(MODULES, ALL_ACTIONS).filter(p => !['finance:refund', 'settings:configure'].includes(p)),
  engineer: [...VIEW_ALL, ...all(['planning','drawings','rfi','site','quality','handover','stores'], ['create','edit']), 'procurement:create', 'procurement:edit', 'drawings:assign', 'rfi:assign', 'reports:export', 'quality:approve', 'site:approve', 'contract:view'],
  qs: [...VIEW_ALL, 'contract:view', 'contract:create', 'contract:edit', ...all(['tender','boq','billing','subcontract','variations','contract'], ['create','edit','export']), 'subcontract:approve', 'reports:export', 'reports:view', 'billing:view'],
  store: [...all(['project','planning','drawings','rfi','site','boq'].filter(m => m !== 'boq'), ['view']), 'procurement:view', ...all(['stores','procurement'], ['create','edit']), 'stores:approve'],
  accounts: [...VIEW_ALL, 'billing:view', 'billing:create', 'billing:edit', 'billing:export', 'finance:view', 'reports:export', 'audit:view'],
  supervisor: [...all(['project','site','stores','quality','handover','planning','rfi','drawings'], ['view']), ...all(['site','quality','handover'], ['create','edit']), 'stores:create'],
  viewer: VIEW_ALL,
};
export const SENSITIVE = ['safety:incidents', 'finance:refund', 'rates:view'] as const;
export const EXTERNAL_ROLES = ['client', 'consultant', 'contractor'];
export const INTERNAL_ROLES = ['owner','manager','engineer','qs','store','accounts','supervisor','viewer'];
export const isExternal = (r: string) => EXTERNAL_ROLES.includes(r);

export type Overrides = Record<string, boolean>;
export function can(role: string, perm: string, overrides: Overrides = {}): boolean {
  if (role === 'owner') return true;
  if (perm in overrides) return overrides[perm];
  return (ROLE_DEFAULTS[role] ?? []).includes(perm);
}
export function effective(role: string, overrides: Overrides): string[] {
  const set = new Set(ROLE_DEFAULTS[role] ?? []);
  for (const [p, g] of Object.entries(overrides)) g ? set.add(p) : set.delete(p);
  return [...set];
}
