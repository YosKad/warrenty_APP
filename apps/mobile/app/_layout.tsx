import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';

import { createQueryClient } from '@/lib/queryClient';
import { logger } from '@/lib/logger';
import { startSupabaseAutoRefresh } from '@/lib/supabase';
import { initCrashReporting } from '@/lib/crashReporting';
import { applyDirection, initI18n } from '@/i18n';
import { ThemeProvider, useTheme } from '@/theme';
import { ToastProvider } from '@/ui';
import { configureNotificationHandler } from '@/services/notificationService';
import { subscribeToAuthChanges, useSessionStore } from '@/state/session';

// Held until i18n, the stored session and the theme preference have all resolved, so
// the first frame the user sees is the right one rather than a flash of the wrong
// language or a sign-in screen they are already past.
void SplashScreen.preventAutoHideAsync();

const queryClient = createQueryClient();

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const hydrated = useSessionStore((s) => s.hydrated);

  useEffect(() => {
    let unsubscribeAuth: (() => void) | undefined;
    let stopRefresh: (() => void) | undefined;

    void (async () => {
      try {
        initCrashReporting();
        configureNotificationHandler();
        const language = await initI18n();
        // Native RTL needs a restart to apply; `applyDirection` reports that so the
        // language screen can prompt, rather than leaving a half-mirrored layout.
        applyDirection(language);
        unsubscribeAuth = subscribeToAuthChanges();
        stopRefresh = startSupabaseAutoRefresh();
      } catch (error) {
        logger.error(error, { phase: 'bootstrap' });
      } finally {
        setReady(true);
      }
    })();

    return () => {
      unsubscribeAuth?.();
      stopRefresh?.();
    };
  }, []);

  useEffect(() => {
    if (ready && hydrated) void SplashScreen.hideAsync();
  }, [ready, hydrated]);

  if (!ready || !hydrated) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <QueryClientProvider client={queryClient}>
            <ToastProvider>
              <ThemedRoot />
            </ToastProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function ThemedRoot() {
  const theme = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg.canvas }}>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.bg.canvas },
          // iOS keeps its native swipe-back; Android uses the predictive back gesture
          // configured in app.config.ts.
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="(onboarding)" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="product/[id]"
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="add"
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="coverage/[productId]"
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen name="settings" />
      </Stack>
    </View>
  );
}
