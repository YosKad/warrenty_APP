/**
 * Calendar-date arithmetic.
 *
 * A warranty end date is a *calendar* fact, not an instant. "Two years from 20 May
 * 2026" is 20 May 2028 whether the user is in Tel Aviv or Los Angeles, and it must
 * not shift by a day when the device timezone changes or when DST rolls over. So
 * warranty dates are stored and computed as `YYYY-MM-DD` strings and every
 * operation here runs in UTC, which has no DST.
 *
 * Event timestamps (created_at, notification sent_at) are a different kind of value
 * and are stored as UTC instants — see `formatDateTime` in lib/format.
 */

export type CalendarDate = string; // 'YYYY-MM-DD'

const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

export function isCalendarDate(value: unknown): value is CalendarDate {
  if (typeof value !== 'string' || !CALENDAR_DATE_PATTERN.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

export function daysInMonth(year: number, month1Based: number): number {
  return new Date(Date.UTC(year, month1Based, 0)).getUTCDate();
}

export function toCalendarDate(date: Date): CalendarDate {
  const y = date.getUTCFullYear();
  const m = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const d = `${date.getUTCDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Parses to a UTC-midnight Date. Throws on malformed input rather than guessing. */
export function parseCalendarDate(value: CalendarDate): Date {
  if (!isCalendarDate(value)) {
    throw new Error(`Invalid calendar date: ${value}`);
  }
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * "Today" in the *user's* timezone, expressed as a calendar date. A user in Tokyo
 * should see a warranty tick over at their midnight, not at UTC midnight.
 */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): CalendarDate {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    // en-CA formats as YYYY-MM-DD.
    return isCalendarDate(parts) ? parts : toCalendarDate(now);
  } catch {
    // An invalid IANA zone must not crash a warranty calculation.
    return toCalendarDate(now);
  }
}

/**
 * Adds whole months, clamping to the end of the target month.
 * 31 Jan + 1 month = 28 Feb (or 29 in a leap year) — the behaviour every consumer
 * expects from "one month later", and what warranty terms mean by it.
 */
export function addMonths(date: CalendarDate, months: number): CalendarDate {
  const parsed = parseCalendarDate(date);
  const year = parsed.getUTCFullYear();
  const month = parsed.getUTCMonth();
  const day = parsed.getUTCDate();

  const targetMonthIndex = month + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalisedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const clampedDay = Math.min(day, daysInMonth(targetYear, normalisedMonth + 1));

  return toCalendarDate(new Date(Date.UTC(targetYear, normalisedMonth, clampedDay)));
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  const parsed = parseCalendarDate(date);
  return toCalendarDate(new Date(parsed.getTime() + days * MS_PER_DAY));
}

/** Signed whole-day difference: `to - from`. */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  return Math.round(
    (parseCalendarDate(to).getTime() - parseCalendarDate(from).getTime()) / MS_PER_DAY,
  );
}

export function compareCalendarDates(a: CalendarDate, b: CalendarDate): number {
  // ISO dates sort lexicographically, which is why this format was chosen.
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minCalendarDate(a: CalendarDate, b: CalendarDate): CalendarDate {
  return compareCalendarDates(a, b) <= 0 ? a : b;
}

export function maxCalendarDate(a: CalendarDate, b: CalendarDate): CalendarDate {
  return compareCalendarDates(a, b) >= 0 ? a : b;
}
