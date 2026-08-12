import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';
import { setAnalyticsOptIn } from '@/lib/analytics';
import { getProfile, type UserProfile } from '@/services/profileService';

/**
 * Session state.
 *
 * Auth state lives in Zustand rather than React Query because navigation depends on
 * it synchronously — the root layout has to know, on the very first render, whether
 * to show the auth stack or the app. `status: 'loading'` is what prevents the
 * sign-in screen flashing before a stored session is restored.
 */

export type SessionStatus = 'loading' | 'signed_out' | 'signed_in';

type SessionState = {
  status: SessionStatus;
  session: Session | null;
  profile: UserProfile | null;
  /** True once the initial `getSession` has resolved, whatever the outcome. */
  hydrated: boolean;
  setSession: (session: Session | null) => void;
  loadProfile: () => Promise<void>;
  patchProfile: (patch: Partial<UserProfile>) => void;
  reset: () => void;
};

export const useSessionStore = create<SessionState>((set, get) => ({
  status: 'loading',
  session: null,
  profile: null,
  hydrated: false,

  setSession: (session) =>
    set({
      session,
      status: session ? 'signed_in' : 'signed_out',
      hydrated: true,
      ...(session ? {} : { profile: null }),
    }),

  loadProfile: async () => {
    if (!get().session) return;
    const profile = await getProfile();
    setAnalyticsOptIn(profile.analyticsOptIn);
    set({ profile });
  },

  patchProfile: (patch) =>
    set((state) => (state.profile ? { profile: { ...state.profile, ...patch } } : state)),

  reset: () => set({ session: null, profile: null, status: 'signed_out', hydrated: true }),
}));

/**
 * Wires Supabase auth events into the store. Called once from the root layout;
 * returns an unsubscribe so a fast refresh in development doesn't stack listeners.
 */
export function subscribeToAuthChanges(): () => void {
  void supabase.auth.getSession().then(({ data }) => {
    useSessionStore.getState().setSession(data.session);
  });

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    const store = useSessionStore.getState();
    if (event === 'SIGNED_OUT') {
      store.reset();
      return;
    }
    store.setSession(session);
  });

  return () => data.subscription.unsubscribe();
}

/** Convenience selectors — components subscribe to one slice, not the whole store. */
export const useSessionStatus = () => useSessionStore((s) => s.status);
export const useCurrentUserId = () => useSessionStore((s) => s.session?.user.id ?? null);
export const useProfile = () => useSessionStore((s) => s.profile);
