import 'react-native-url-polyfill/auto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import type { Database } from '@/types/database';
import { config } from './config';
import { secureSessionStorage } from './storage';

/**
 * The single Supabase client for the app.
 *
 * Only the anon key is shipped. Every table is guarded by Row Level Security and
 * every privileged operation (store receipt verification, AI analysis, scheduled
 * reminders) runs in an Edge Function with the service-role key held server-side.
 *
 * The session is persisted in the Keychain / Keystore via `secureSessionStorage`,
 * not AsyncStorage — a refresh token in plaintext on disk is a device-theft
 * vulnerability, and on Android it is readable on a rooted device.
 */
export const supabase: SupabaseClient<Database> = createClient<Database>(
  config.supabaseUrl,
  config.supabaseAnonKey,
  {
    auth: {
      storage: secureSessionStorage,
      autoRefreshToken: true,
      persistSession: true,
      // React Native has no URL bar; OAuth callbacks are handled explicitly by
      // authService via the app's deep-link scheme.
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
    global: {
      headers: { 'x-client-platform': 'mobile' },
    },
  },
);

/**
 * Supabase refreshes tokens on a timer, which the OS suspends in the background.
 * Tying the refresher to foreground state avoids a burst of failed refreshes on
 * resume and keeps the session alive without polling.
 */
let appStateSubscription: { remove: () => void } | null = null;

export function startSupabaseAutoRefresh(): () => void {
  appStateSubscription?.remove();
  appStateSubscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      void supabase.auth.startAutoRefresh();
    } else {
      void supabase.auth.stopAutoRefresh();
    }
  });
  if (AppState.currentState === 'active') {
    void supabase.auth.startAutoRefresh();
  }
  return () => {
    appStateSubscription?.remove();
    appStateSubscription = null;
    void supabase.auth.stopAutoRefresh();
  };
}
