import Constants from 'expo-constants';

/**
 * Typed access to build-time configuration.
 *
 * `app.config.ts` is the single place env vars enter the app; everything else reads
 * them from here so a missing value fails loudly at startup rather than as an
 * `undefined` deep inside a network call.
 */

export type AppEnv = 'development' | 'staging' | 'production';

type RawExtra = {
  appEnv?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  sentryDsn?: string;
  privacyPolicyUrl?: string;
  termsUrl?: string;
  supportUrl?: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as RawExtra;

function required(name: keyof RawExtra): string {
  const value = extra[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `Missing configuration "${name}". Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

function optional(name: keyof RawExtra, fallback = ''): string {
  const value = extra[name];
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

export const appEnv: AppEnv =
  extra.appEnv === 'production' || extra.appEnv === 'staging'
    ? extra.appEnv
    : 'development';

export const isProduction = appEnv === 'production';

export const config = {
  appEnv,
  supabaseUrl: required('supabaseUrl'),
  supabaseAnonKey: required('supabaseAnonKey'),
  sentryDsn: optional('sentryDsn'),
  privacyPolicyUrl: optional('privacyPolicyUrl', 'https://mywarranty.app/privacy'),
  termsUrl: optional('termsUrl', 'https://mywarranty.app/terms'),
  supportUrl: optional('supportUrl', 'https://mywarranty.app/support'),
} as const;
