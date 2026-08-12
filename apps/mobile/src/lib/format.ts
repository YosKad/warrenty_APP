import { I18nManager } from 'react-native';

import { parseCalendarDate, type CalendarDate } from '@/domain/date';

/**
 * Locale-aware formatting.
 *
 * Everything here goes through `Intl`, which is what makes 20 May 2026 render as
 * 05/20/2026 for a US user and 20/05/2026 for an Israeli one without a single
 * conditional in a screen. Warranty dates in particular must never be assembled by
 * string concatenation — a misread date is a missed claim.
 */

export function formatDate(
  value: CalendarDate | null | undefined,
  locale: string,
  style: 'short' | 'medium' | 'long' = 'medium',
): string {
  if (!value) return '—';
  try {
    const date = parseCalendarDate(value);
    return new Intl.DateTimeFormat(locale, {
      // The date is a UTC-midnight instant; formatting in UTC keeps the calendar
      // day intact regardless of where the device is.
      timeZone: 'UTC',
      dateStyle: style,
    }).format(date);
  } catch {
    return value;
  }
}

export function formatDateTime(iso: string | null, locale: string, timeZone?: string): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      ...(timeZone ? { timeZone } : {}),
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * Money. The amount and its ISO currency code are always stored together, so this
 * never has to guess — 4999.00 ILS renders as ₪4,999.00, not as $4,999.00.
 */
export function formatCurrency(
  amount: number | null | undefined,
  currency: string | null | undefined,
  locale: string,
): string {
  if (amount === null || amount === undefined) return '—';
  if (!currency) return formatNumber(amount, locale);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).format(amount);
  } catch {
    return `${formatNumber(amount, locale)} ${currency}`;
  }
}

export function formatNumber(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    return String(value);
  }
}

/**
 * Serial numbers, model codes and reference numbers are Latin-script identifiers.
 * In an RTL layout they must stay left-to-right or the digits reorder visually and
 * the user reads a different number than the one printed on the appliance. The
 * bidi isolate characters below pin the direction without affecting the surrounding
 * text.
 */
export function isolateLtr(value: string): string {
  if (!I18nManager.isRTL) return value;
  const LRI = '⁦';
  const PDI = '⁩';
  return `${LRI}${value}${PDI}`;
}

/** Phone numbers have the same reordering problem as serial numbers. */
export const formatPhone = isolateLtr;

export function formatFileSize(bytes: number, locale: string): string {
  const units = ['B', 'KB', 'MB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const rounded = unitIndex === 0 ? Math.round(size) : Math.round(size * 10) / 10;
  return `${formatNumber(rounded, locale)} ${units[unitIndex]}`;
}

/** Greeting bucket for the Home header. */
export function greetingKey(hourLocal: number): string {
  if (hourLocal < 12) return 'home.greetingMorning';
  if (hourLocal < 18) return 'home.greetingAfternoon';
  return 'home.greetingEvening';
}

/**
 * Maps a language to a full BCP 47 locale for Intl, honouring the user's country so
 * an English speaker in Israel gets day/month ordering rather than US ordering.
 */
export function resolveLocale(language: string, countryCode: string): string {
  return `${language}-${countryCode.toUpperCase()}`;
}
