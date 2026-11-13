import "server-only";
import { tx, type Db } from "./db";
import type { CompanyAuth } from "./auth";
import type { Ctx } from "./svc/ctx";
export const ctxOf = (a: CompanyAuth): Ctx => ({ companyId: a.company.id, userId: a.user.id, role: a.membership.role, plantIds: a.membership.plantIds, label: a.user.email });
/** Read inside a tenant-bound transaction (RLS applies). */
export const rd = <T>(a: CompanyAuth, fn: (c: Db) => Promise<T>) => tx(fn, { companyId: a.company.id, userId: a.user.id, plantIds: a.membership.plantIds });
export const opts = (rows: any[], label: (r: any) => string = (r) => `${r.code} — ${r.name}`) => rows.map((r) => ({ value: r.id as string, label: label(r) }));
export const PER = 25;
export const pg = (sp: Record<string, string | undefined>) => Math.max(1, Number(sp.page) || 1);
export async function itemOpts(c: Db, where = "active") { return opts((await c.query(`select id, code, name from items where ${where} order by code`)).rows); }
export async function locOpts(c: Db, kind?: string) { return opts((await c.query(`select id, code, name from locations ${kind ? "where kind=$1" : ""} order by code`, kind ? [kind] : [])).rows); }
