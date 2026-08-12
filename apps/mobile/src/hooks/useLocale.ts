import { useTranslation } from 'react-i18next';

import { resolveLocale } from '@/lib/format';
import { detectRegion, detectTimeZone } from '@/i18n';
import { todayInTimeZone } from '@/domain/date';
import { useSessionStore } from '@/state/session';

/**
 * Resolves the locale, timezone and "today" that formatting and warranty maths
 * should use.
 *
 * Precedence is profile → device. The profile wins because a user who has explicitly
 * set their country expects that choice to hold when they travel — warranty rules
 * follow where the product was bought, not where the phone currently is.
 */
export function useLocale() {
  const { i18n } = useTranslation();
  const profile = useSessionStore((s) => s.profile);

  const countryCode = profile?.countryCode ?? detectRegion();
  const timeZone = profile?.timeZone ?? detectTimeZone();
  const language = profile?.preferredLanguage ?? i18n.language;

  return {
    language,
    countryCode,
    timeZone,
    locale: resolveLocale(language, countryCode),
    currency: profile?.preferredCurrency ?? 'USD',
    /** Calendar "today" in the user's zone — the anchor for every warranty status. */
    today: todayInTimeZone(timeZone),
  };
}
