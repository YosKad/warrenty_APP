/* eslint-disable no-undef */

// Domain and service tests must not reach the network or native modules.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        appEnv: 'development',
        supabaseUrl: 'http://localhost:54321',
        supabaseAnonKey: 'test-anon-key',
        privacyPolicyUrl: 'https://example.test/privacy',
        termsUrl: 'https://example.test/terms',
        supportUrl: 'https://example.test/support',
      },
    },
  },
}));

jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    getItemAsync: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    setItemAsync: jest.fn(async (k, v) => {
      store.set(k, v);
    }),
    deleteItemAsync: jest.fn(async (k) => {
      store.delete(k);
    }),
    isAvailableAsync: jest.fn(async () => true),
  };
});

jest.mock('expo-localization', () => ({
  getLocales: () => [
    { languageTag: 'en-US', languageCode: 'en', regionCode: 'US', textDirection: 'ltr' },
  ],
  getCalendars: () => [{ timeZone: 'UTC' }],
}));
