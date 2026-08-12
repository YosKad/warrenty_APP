import React, { useEffect } from 'react';
import { Redirect } from 'expo-router';

import { getItem } from '@/lib/storage';
import { identifyUser } from '@/lib/crashReporting';
import { useSessionStore } from '@/state/session';

/**
 * The entry gate.
 *
 * Decides between onboarding, auth and the app in one place, so no screen has to
 * guess whether the user is signed in. The session store is already hydrated by the
 * time this renders (the root layout holds the splash until it is), which is what
 * makes a synchronous redirect safe here.
 */

const ONBOARDING_KEY = 'mw.onboarding-seen';

export default function Index() {
  const status = useSessionStore((s) => s.status);
  const loadProfile = useSessionStore((s) => s.loadProfile);
  const userId = useSessionStore((s) => s.session?.user.id ?? null);
  const [onboardingSeen, setOnboardingSeen] = React.useState<boolean | null>(null);

  useEffect(() => {
    void getItem(ONBOARDING_KEY).then((value) => setOnboardingSeen(value === 'true'));
  }, []);

  useEffect(() => {
    identifyUser(userId);
    if (status === 'signed_in') {
      void loadProfile().catch(() => undefined);
    }
  }, [status, userId, loadProfile]);

  if (onboardingSeen === null) return null;
  if (!onboardingSeen) return <Redirect href="/(onboarding)" />;
  if (status === 'signed_in') return <Redirect href="/(tabs)" />;
  return <Redirect href="/(auth)/welcome" />;
}

export { ONBOARDING_KEY };
