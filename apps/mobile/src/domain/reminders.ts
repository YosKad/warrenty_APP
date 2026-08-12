import { addDays, compareCalendarDates, type CalendarDate } from './date';

/**
 * Reminder scheduling.
 *
 * Pure date maths, deliberately shared between the app (which previews a product's
 * reminder schedule) and the server cron that actually sends them. Keeping one
 * implementation is what stops the preview and the delivered notification from
 * disagreeing.
 */

export const DEFAULT_REMINDER_OFFSETS_DAYS = [90, 30, 7, 1] as const;

/** Sending at 09:00 local is a product decision: useful, and never at night. */
export const DEFAULT_REMINDER_HOUR_LOCAL = 9;

export type ReminderOffsetDays = number;

export type ScheduledReminder = {
  /** Days before expiry this reminder represents. */
  offsetDays: ReminderOffsetDays;
  /** Local calendar date it should be delivered on. */
  sendOn: CalendarDate;
};

/**
 * Builds the reminder schedule for one warranty.
 *
 * Reminders in the past are dropped rather than fired late — a user who adds a
 * product whose warranty ends in 10 days should get the 7-day and 1-day nudges, not
 * an immediate "90 days left" that is plainly wrong.
 */
export function buildReminderSchedule(
  warrantyEnd: CalendarDate | null,
  today: CalendarDate,
  offsets: readonly number[] = DEFAULT_REMINDER_OFFSETS_DAYS,
): ScheduledReminder[] {
  if (!warrantyEnd) return [];

  const unique = [...new Set(offsets.filter((o) => Number.isFinite(o) && o >= 0))].sort(
    (a, b) => b - a,
  );

  return unique
    .map((offsetDays) => ({ offsetDays, sendOn: addDays(warrantyEnd, -offsetDays) }))
    .filter((reminder) => compareCalendarDates(reminder.sendOn, today) >= 0);
}

/**
 * Converts a local send date + preferred hour into the UTC instant the scheduler
 * should fire at.
 *
 * The timezone offset is resolved for that specific date, not for today, so a
 * reminder scheduled six months out still lands at 09:00 local after a DST change.
 */
export function toUtcSendInstant(
  sendOn: CalendarDate,
  timeZone: string,
  hourLocal: number = DEFAULT_REMINDER_HOUR_LOCAL,
): Date {
  const [y, m, d] = sendOn.split('-').map(Number) as [number, number, number];
  const naiveUtc = Date.UTC(y, m - 1, d, hourLocal, 0, 0);
  const offsetMinutes = timeZoneOffsetMinutes(new Date(naiveUtc), timeZone);
  return new Date(naiveUtc - offsetMinutes * 60_000);
}

/**
 * Minutes that `timeZone` is ahead of UTC at `instant`.
 * Uses Intl rather than a timezone database dependency; falls back to 0 (UTC) if the
 * zone is unrecognised, which is the safe direction — a reminder at the wrong hour
 * beats no reminder.
 */
export function timeZoneOffsetMinutes(instant: Date, timeZone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const parts = formatter.formatToParts(instant);
    const get = (type: string) =>
      Number(parts.find((part) => part.type === type)?.value ?? '0');
    // `hour` can format as 24 for midnight under hour12: false on some engines.
    const hour = get('hour') % 24;
    const asUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      hour,
      get('minute'),
      get('second'),
    );
    return Math.round((asUtc - instant.getTime()) / 60_000);
  } catch {
    return 0;
  }
}

export type ReminderKind =
  | 'warranty_expiring'
  | 'warranty_expired'
  | 'claim_update'
  | 'document_ready'
  | 'subscription';

/**
 * Deterministic key used to make reminder delivery idempotent. The scheduler upserts
 * on this, so a cron that runs twice, or a retried webhook, cannot double-notify.
 */
export function reminderIdempotencyKey(
  productId: string,
  kind: ReminderKind,
  offsetDays: number,
  warrantyEnd: CalendarDate,
): string {
  return `${productId}:${kind}:${offsetDays}:${warrantyEnd}`;
}

/** Quiet hours guard for anything triggered outside the scheduled 09:00 slot. */
export function isWithinQuietHours(
  hourLocal: number,
  quietStart = 21,
  quietEnd = 8,
): boolean {
  if (quietStart <= quietEnd) return hourLocal >= quietStart && hourLocal < quietEnd;
  // Window wraps midnight (the normal case: 21:00 → 08:00).
  return hourLocal >= quietStart || hourLocal < quietEnd;
}
