import i18n, { changeLanguage, use as registerI18nPlugin } from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import { I18nManager } from 'react-native';

import { getItem, setItem } from '@/lib/storage';
import en from './locales/en.json';
import he from './locales/he.json';

/**
 * Internationalisation.
 *
 * English and Hebrew ship at launch; the resource map and the RTL handling are built
 * so Arabic, Spanish, French and German are additions rather than refactors.
 *
 * On RTL: `I18nManager.forceRTL` requires an app reload to take effect on native, so
 * `applyDirection` reports whether a restart is needed and the caller decides when to
 * ask. Flipping layout mid-session leaves views half-mirrored.
 */

export const SUPPORTED_LANGUAGES = ['en', 'he'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const RTL_LANGUAGES: ReadonlySet<string> = new Set(['he', 'ar', 'fa', 'ur']);

const LANGUAGE_KEY = 'mw.language';

export function isSupportedLanguage(value: string): value is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

export function isRtlLanguage(language: string): boolean {
  return RTL_LANGUAGES.has(language.split('-')[0] ?? language);
}

/** Device language when supported, otherwise English. */
export function detectDeviceLanguage(): SupportedLanguage {
  const locales = Localization.getLocales();
  for (const locale of locales) {
    const code = locale.languageCode ?? '';
    if (isSupportedLanguage(code)) return code;
  }
  return 'en';
}

export function detectTimeZone(): string {
  return Localization.getCalendars()[0]?.timeZone ?? 'UTC';
}

export function detectRegion(): string {
  return Localization.getLocales()[0]?.regionCode ?? 'US';
}

export async function initI18n(): Promise<SupportedLanguage> {
  const stored = await getItem(LANGUAGE_KEY);
  const language =
    stored && isSupportedLanguage(stored) ? stored : detectDeviceLanguage();

  await registerI18nPlugin(initReactI18next).init({
    resources: {
      en: { translation: en },
      he: { translation: he },
    },
    lng: language,
    fallbackLng: 'en',
    // React already escapes; double-escaping mangles apostrophes and Hebrew quotes.
    interpolation: { escapeValue: false },
    returnNull: false,
    compatibilityJSON: 'v4',
  });

  return language;
}

export async function setLanguage(language: SupportedLanguage): Promise<void> {
  await changeLanguage(language);
  await setItem(LANGUAGE_KEY, language);
}

/**
 * Aligns native layout direction with the active language.
 * Returns true when the process must be restarted for the change to apply.
 */
export function applyDirection(language: string): { restartRequired: boolean } {
  const shouldBeRtl = isRtlLanguage(language);
  if (I18nManager.isRTL === shouldBeRtl) return { restartRequired: false };
  I18nManager.allowRTL(shouldBeRtl);
  I18nManager.forceRTL(shouldBeRtl);
  return { restartRequired: true };
}

export { i18n };
