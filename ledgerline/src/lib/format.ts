// All money is stored as integer paise. Never floats.
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: 2 });
const inrWhole = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
export const money = (paise: number | undefined | null) => inr.format((paise ?? 0) / 100);
export const moneyShort = (paise: number) => inrWhole.format(Math.round(paise / 100));
export const toPaise = (rupees: number | string) => Math.round(Number(rupees || 0) * 100);
export const toRupees = (paise: number) => (paise / 100).toFixed(2);
export const DAY = 86400000;
export const iso = (d: Date | number) => new Date(d).toISOString().slice(0, 10);
export const today = () => iso(Date.now());
export const addDays = (date: string, n: number) => iso(new Date(date + 'T00:00:00Z').getTime() + n * DAY);
export const daysBetween = (a: string, b: string) => Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / DAY);
const fmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const date = (s?: string) => (s ? fmt.format(new Date(s.length > 10 ? s : s + 'T00:00:00Z')) : '—');
export const dateTime = (s?: string) => (s ? new Date(s).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const cap = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
export const uid = (p: string) => p + '_' + Math.random().toString(36).slice(2, 9);
export const pct = (n: number) => `${n.toFixed(n % 1 ? 1 : 0)}%`;
export function addMonths(d: string, n: number) { const x = new Date(d + 'T00:00:00Z'); x.setUTCMonth(x.getUTCMonth() + n); return iso(x); }
