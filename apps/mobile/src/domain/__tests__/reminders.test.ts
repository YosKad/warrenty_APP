import {
  buildReminderSchedule,
  DEFAULT_REMINDER_OFFSETS_DAYS,
  isWithinQuietHours,
  reminderIdempotencyKey,
  timeZoneOffsetMinutes,
  toUtcSendInstant,
} from '../reminders';

/**
 * Reminder scheduling. The failure modes worth guarding against: firing a "90 days
 * left" alert for a warranty that ends next week, sending at 3am, and double-sending
 * when the scheduler retries.
 */

describe('buildReminderSchedule', () => {
  it('schedules the default offsets before an expiry', () => {
    const schedule = buildReminderSchedule('2026-12-31', '2026-01-01');
    expect(schedule.map((r) => r.offsetDays)).toEqual([90, 30, 7, 1]);
    expect(schedule[0]?.sendOn).toBe('2026-10-02');
    expect(schedule[3]?.sendOn).toBe('2026-12-30');
  });

  it('drops reminders whose date has already passed', () => {
    // Warranty ends in 10 days: the 90- and 30-day nudges are meaningless now, and
    // firing them late would tell the user something plainly false.
    const schedule = buildReminderSchedule('2026-01-11', '2026-01-01');
    expect(schedule.map((r) => r.offsetDays)).toEqual([7, 1]);
  });

  it('returns nothing once the warranty has expired', () => {
    expect(buildReminderSchedule('2025-01-01', '2026-01-01')).toEqual([]);
  });

  it('returns nothing when the end date is unknown', () => {
    expect(buildReminderSchedule(null, '2026-01-01')).toEqual([]);
  });

  it('keeps a reminder scheduled for today', () => {
    const schedule = buildReminderSchedule('2026-01-08', '2026-01-01');
    expect(schedule.some((r) => r.sendOn === '2026-01-01')).toBe(true);
  });

  it('honours custom offsets and de-duplicates them', () => {
    const schedule = buildReminderSchedule('2026-12-31', '2026-01-01', [14, 14, 3]);
    expect(schedule.map((r) => r.offsetDays)).toEqual([14, 3]);
  });

  it('ignores negative and non-finite offsets', () => {
    const schedule = buildReminderSchedule('2026-12-31', '2026-01-01', [
      30,
      -5,
      Number.NaN,
    ]);
    expect(schedule.map((r) => r.offsetDays)).toEqual([30]);
  });
});

describe('timezone handling', () => {
  it('resolves the offset for a specific instant, not for "now"', () => {
    // New York is UTC-5 in January and UTC-4 in July. A reminder scheduled six
    // months out must use the offset in force on that date.
    const winter = timeZoneOffsetMinutes(new Date('2026-01-15T12:00:00Z'), 'America/New_York');
    const summer = timeZoneOffsetMinutes(new Date('2026-07-15T12:00:00Z'), 'America/New_York');
    expect(winter).toBe(-300);
    expect(summer).toBe(-240);
  });

  it('falls back to UTC for an unknown zone instead of throwing', () => {
    expect(timeZoneOffsetMinutes(new Date('2026-01-15T12:00:00Z'), 'Nowhere/Real')).toBe(0);
  });

  it('sends at 09:00 local on both sides of a DST change', () => {
    const winter = toUtcSendInstant('2026-01-15', 'America/New_York');
    const summer = toUtcSendInstant('2026-07-15', 'America/New_York');
    expect(winter.toISOString()).toBe('2026-01-15T14:00:00.000Z');
    expect(summer.toISOString()).toBe('2026-07-15T13:00:00.000Z');
  });

  it('respects a custom preferred hour', () => {
    const instant = toUtcSendInstant('2026-01-15', 'UTC', 18);
    expect(instant.toISOString()).toBe('2026-01-15T18:00:00.000Z');
  });
});

describe('quiet hours', () => {
  it('treats the overnight window as quiet', () => {
    expect(isWithinQuietHours(23)).toBe(true);
    expect(isWithinQuietHours(3)).toBe(true);
    expect(isWithinQuietHours(21)).toBe(true);
  });

  it('treats daytime as sendable', () => {
    expect(isWithinQuietHours(9)).toBe(false);
    expect(isWithinQuietHours(20)).toBe(false);
    expect(isWithinQuietHours(8)).toBe(false);
  });

  it('never falls inside quiet hours at the default send time', () => {
    expect(isWithinQuietHours(9)).toBe(false);
  });
});

describe('idempotency', () => {
  it('produces a stable key for the same reminder', () => {
    const key = reminderIdempotencyKey('prod-1', 'warranty_expiring', 30, '2026-12-31');
    expect(key).toBe('prod-1:warranty_expiring:30:2026-12-31');
    expect(reminderIdempotencyKey('prod-1', 'warranty_expiring', 30, '2026-12-31')).toBe(key);
  });

  it('changes when the warranty end moves, so a corrected date re-schedules', () => {
    const before = reminderIdempotencyKey('p', 'warranty_expiring', 30, '2026-12-31');
    const after = reminderIdempotencyKey('p', 'warranty_expiring', 30, '2027-01-31');
    expect(before).not.toBe(after);
  });

  it('distinguishes offsets and kinds for the same product', () => {
    expect(reminderIdempotencyKey('p', 'warranty_expiring', 30, '2026-12-31')).not.toBe(
      reminderIdempotencyKey('p', 'warranty_expiring', 7, '2026-12-31'),
    );
    expect(reminderIdempotencyKey('p', 'warranty_expiring', 30, '2026-12-31')).not.toBe(
      reminderIdempotencyKey('p', 'warranty_expired', 30, '2026-12-31'),
    );
  });
});

describe('defaults', () => {
  it('reminds at 90, 30, 7 and 1 days by default', () => {
    expect([...DEFAULT_REMINDER_OFFSETS_DAYS]).toEqual([90, 30, 7, 1]);
  });
});
