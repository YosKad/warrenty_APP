import { useState } from 'react';
import { Platform, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { track } from '@/lib/analytics';
import { isAppError } from '@/lib/errors';
import { signInWithProvider } from '@/services/authService';
import { Button, Screen, Text, WarrantyMarkIcon, useToast } from '@/ui';

/**
 * Welcome.
 *
 * Sign in with Apple sits first on iOS, both because App Store guidelines require it
 * to be offered alongside other social logins and because it is genuinely the least
 * friction for an iPhone user. Email is always available — never gate the product
 * behind a third party.
 */
export default function WelcomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState<'apple' | 'google' | null>(null);

  const handleProvider = async (provider: 'apple' | 'google') => {
    setBusy(provider);
    try {
      await signInWithProvider(provider);
      track({ name: 'signup_completed', props: { method: provider } });
      router.replace('/(tabs)');
    } catch (error) {
      // A cancelled sign-in is a normal choice, not an error worth shouting about.
      const key = isAppError(error) ? error.messageKey : 'errors.unknown';
      if (key !== 'auth.cancelled') toast.show(t(key), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'space-between', paddingTop: theme.spacing.xxxl }}>
        <View style={{ gap: theme.spacing.lg }}>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: theme.radii.lg,
              backgroundColor: theme.colors.bg.brand,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <WarrantyMarkIcon size={28} color={theme.colors.text.onBrand} />
          </View>
          <Text variant="display" accessibilityRole="header">
            {t('auth.welcomeTitle')}
          </Text>
          <Text variant="body" tone="secondary" style={{ maxWidth: 320 }}>
            {t('auth.welcomeBody')}
          </Text>
        </View>

        <View style={{ gap: theme.spacing.md }}>
          {Platform.OS === 'ios' ? (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={
                theme.scheme === 'dark'
                  ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                  : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
              }
              cornerRadius={theme.radii.md}
              style={{ height: 48 }}
              onPress={() => void handleProvider('apple')}
            />
          ) : null}

          <Button
            label={t('auth.signInWithGoogle')}
            variant="secondary"
            fullWidth
            loading={busy === 'google'}
            onPress={() => void handleProvider('google')}
          />

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.md,
              paddingVertical: theme.spacing.xs,
            }}
          >
            <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.border.subtle }} />
            <Text variant="caption" tone="tertiary">
              {t('auth.orContinueWith')}
            </Text>
            <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.border.subtle }} />
          </View>

          <Button
            label={t('auth.signUp')}
            fullWidth
            onPress={() => router.push('/(auth)/sign-up')}
          />
          <Button
            label={t('auth.signIn')}
            variant="ghost"
            fullWidth
            onPress={() => router.push('/(auth)/sign-in')}
          />
        </View>
      </View>
    </Screen>
  );
}
