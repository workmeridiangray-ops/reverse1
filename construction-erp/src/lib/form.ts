import type { FormState } from '@/components/ActionForm';
import type { Result } from './session';
import { parseMoney, parseQty } from './rules/money';
import { AppError } from './db';

export const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
export const opt = (fd: FormData, k: string) => { const v = str(fd, k); return v === '' ? null : v; };
export const idem = (fd: FormData) => { const v = str(fd, '_idem'); return v || null; };
export const money = (fd: FormData, k: string) => { try { return parseMoney(str(fd, k)); } catch { throw new AppError(`${k.replace(/_/g, ' ')} is not a valid amount (up to 2 decimals).`, 'money'); } };
export const qty = (fd: FormData, k: string) => { try { return parseQty(str(fd, k)); } catch { throw new AppError(`${k.replace(/_/g, ' ')} is not a valid quantity (up to 3 decimals).`, 'qty'); } };
export const int = (fd: FormData, k: string, min = 0, max = 1_000_000) => { const n = Number(str(fd, k)); if (!Number.isInteger(n) || n < min || n > max) throw new AppError(`${k.replace(/_/g, ' ')} must be a whole number between ${min} and ${max}.`, 'int'); return n; };
export const date = (fd: FormData, k: string) => { const v = str(fd, k); if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v))) throw new AppError(`${k.replace(/_/g, ' ')} must be a valid date.`, 'date'); return v; };

export function state<T>(r: Result<T>, o: { message?: string; redirect?: (d: T) => string | undefined } = {}): FormState {
  if (!r.ok) return { error: r.error, code: r.code };
  return { ok: true, message: o.message ?? r.message, redirect: o.redirect?.(r.data) };
}
/** Run a parser that may throw AppError and turn it into a form error instead of a crash. */
export async function guard(fn: () => Promise<FormState>): Promise<FormState> {
  try { return await fn(); } catch (e) { const err = e as any; if (err?.digest?.startsWith?.('NEXT_REDIRECT')) throw e; return { error: err instanceof AppError || err?.name === 'RuleError' ? err.message : 'Something went wrong. Nothing was saved — please try again.' }; }
}
