export const PAGE = 25;
export type SP = Record<string, string | string[] | undefined>;
export const sp1 = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
export function paging(sp: SP) {
  const page = Math.max(1, parseInt(sp1(sp.page) || "1", 10) || 1);
  return { page, limit: PAGE, offset: (page - 1) * PAGE };
}
export const like = (q: string) => `%${q.replace(/[\\%_]/g, (m) => "\\" + m)}%`;
/** whitelisted ORDER BY: sort=col or -col */
export function orderBy(sortParam: string, allowed: Record<string, string>, fallback: string) {
  const desc = sortParam.startsWith("-"); const key = sortParam.replace(/^-/, "");
  return allowed[key] ? `${allowed[key]} ${desc ? "desc" : "asc"}` : fallback;
}
export const pages = (total: number) => Math.max(1, Math.ceil(total / PAGE));
