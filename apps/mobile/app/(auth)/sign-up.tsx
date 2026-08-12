import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { track } from '@/lib/analytics';
import { isAppError } from '@/lib/errors';
import { detectRegion } from '@/i18n';
import { signUpWithEmail } from '@/services/authService';
import { signUpSchema, PASSWORD_MIN_LENGTH, type SignUpValues } from '@/features/auth/schemas';
import { BackIcon, Button, EmptyState, Input, Screen, Text, useToast } from '@/ui';

export default function SignUpScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [awaitingConfirmation, setAwaitingConfirmation] = useState<string | null>(null);

  const { control, handleSubmit, formState } = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { displayName: '', email: '', password: '', confirmPassword: '' },
    mode: 'onTouched',
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const result = await signUpWithEmail({
        email: values.email,
        password: values.password,
        displayName: values.displayName,
        // Seeded from the device so the account starts with sensible warranty rules;
        // the user can change it in Profile at any time.
        countryCode: detectRegion(),
        preferredLanguage: i18n.language,
      });
      track({ name: 'signup_completed', props: { method: 'email' } });

      if (result.needsEmailConfirmation) {
        setAwaitingConfirmation(values.email);
        return;
      }
      router.replace('/(tabs)');
    } catch (error) {
      toast.show(t(isAppError(error) ? error.messageKey : 'errors.unknown'), 'error');
    }
  });

  if (awaitingConfirmation) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState
            title={t('auth.verifyEmailTitle')}
            body={t('auth.verifyEmailBody', { email: awaitingConfirmation })}
            actionLabel={t('auth.signIn')}
            onAction={() => router.replace('/(auth)/sign-in')}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('a11y.back')}
        onPress={() => router.back()}
        hitSlop={12}
        style={{ height: 44, justifyContent: 'center' }}
      >
        <BackIcon color={theme.colors.text.primary} />
      </Pressable>

      <View style={{ gap: theme.spacing.xl, marginTop: theme.spacing.lg }}>
        <Text variant="h1" accessibilityRole="header">
          {t('auth.signUp')}
        </Text>

        <View style={{ gap: theme.spacing.lg }}>
          <Controller
            control={control}
            name="displayName"
            render={({ field, fieldState }) => (
              <Input
                label={t('auth.name')}
                required
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error ? t(fieldState.error.message ?? '') : undefined}
                autoComplete="name"
                textContentType="name"
                autoCapitalize="words"
              />
            )}
          />

          <Controller
            control={control}
            name="email"
            render={({ field, fieldState }) => (
              <Input
                label={t('auth.email')}
                required
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error ? t(fieldState.error.message ?? '') : undefined}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                textContentType="emailAddress"
              />
            )}
          />

          <Controller
            control={control}
            name="password"
            render={({ field, fieldState }) => (
              <Input
                label={t('auth.password')}
                required
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error ? t(fieldState.error.message ?? '') : undefined}
                hint={t('auth.passwordRule', { count: PASSWORD_MIN_LENGTH })}
                secureTextEntry
                autoComplete="new-password"
                textContentType="newPassword"
              />
            )}
          />

          <Controller
            control={control}
            name="confirmPassword"
            render={({ field, fieldState }) => (
              <Input
                label={t('auth.confirmPassword')}
                required
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error ? t(fieldState.error.message ?? '') : undefined}
                secureTextEntry
                autoComplete="new-password"
                textContentType="newPassword"
                onSubmitEditing={() => void onSubmit()}
              />
            )}
          />
        </View>

        <Button
          label={t('auth.signUp')}
          fullWidth
          loading={formState.isSubmitting}
          onPress={() => void onSubmit()}
        />

        <View
          style={{ flexDirection: 'row', justifyContent: 'center', gap: theme.spacing.xs }}
        >
          <Text variant="bodySmall" tone="secondary">
            {t('auth.haveAccount')}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace('/(auth)/sign-in')}
            hitSlop={8}
          >
            <Text variant="bodySmallStrong" tone="accent">
              {t('auth.signIn')}
            </Text>
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}
