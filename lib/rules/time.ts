/**
 * Clinic-local time helpers. Pure (uses only the built-in Intl API).
 *
 * "Today" always means today in the clinic's time zone, not the server's.
 */

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = fmt.formatToParts(instant).find((p) => p.type === type);
    if (!part) throw new Error(`Missing ${type}`);
    return Number(part.value);
  };
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset of `timeZone` from UTC at `instant`, in minutes (e.g. +240 for UTC+4). */
export function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const truncated = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round((asUtc - truncated) / 60000);
}

/**
 * Convert a wall-clock time in `timeZone` to a UTC instant. Handles DST by
 * re-checking the offset at the candidate instant.
 */
export function zonedTimeToUtc(
  local: { year: number; month: number; day: number; hour?: number; minute?: number },
  timeZone: string,
): Date {
  const naive = Date.UTC(local.year, local.month - 1, local.day, local.hour ?? 0, local.minute ?? 0);
  let guess = naive - zoneOffsetMinutes(new Date(naive), timeZone) * 60000;
  const second = naive - zoneOffsetMinutes(new Date(guess), timeZone) * 60000;
  if (second !== guess) guess = second;
  return new Date(guess);
}

/** ISO date string (YYYY-MM-DD) of `instant` in the clinic's zone. */
export function localDateKey(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function parseDateKey(key: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) throw new Error(`Invalid date: ${key}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) throw new Error(`Invalid date: ${key}`);
  return { year, month, day };
}

/** [start, end) of a clinic-local calendar day as UTC instants. */
export function dayBounds(dateKey: string, timeZone: string): { start: Date; end: Date } {
  const d = parseDateKey(dateKey);
  const next = new Date(Date.UTC(d.year, d.month - 1, d.day + 1));
  return {
    start: zonedTimeToUtc(d, timeZone),
    end: zonedTimeToUtc(
      { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() },
      timeZone,
    ),
  };
}

/** "HH:MM" in the clinic's zone. */
export function formatClock(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** Parse an HTML datetime-local value ("2026-11-01T09:30") as clinic-local time. */
export function parseLocalDateTime(value: string, timeZone: string): Date {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m || !m[1]) throw new Error(`Invalid date/time: ${value}`);
  const hour = Number(m[2]);
  const minute = Number(m[3]);
  if (hour > 23 || minute > 59) throw new Error(`Invalid date/time: ${value}`);
  return zonedTimeToUtc({ ...parseDateKey(m[1]), hour, minute }, timeZone);
}

/** Inverse of parseLocalDateTime, for prefilling inputs. */
export function toLocalDateTimeInput(instant: Date, timeZone: string): string {
  return `${localDateKey(instant, timeZone)}T${formatClock(instant, timeZone)}`;
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60000);
}

/** Whole years of age on `on`, from an ISO date of birth. */
export function ageInYears(dateOfBirth: string, on: Date, timeZone: string): number {
  const dob = parseDateKey(dateOfBirth);
  const today = zonedParts(on, timeZone);
  let age = today.year - dob.year;
  if (today.month < dob.month || (today.month === dob.month && today.day < dob.day)) age -= 1;
  return age;
}
