import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { sendPasswordReset } from '@/services/authService';
import {
  forgotPasswordSchema,
  type ForgotPasswordValues,
} from '@/features/auth/schemas';
import { BackIcon, Button, Input, Screen, Text } from '@/ui';

export default function ForgotPasswordScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const [sent, setSent] = useState(false);

  const { control, handleSubmit, formState } = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    // The confirmation is shown whether or not the address exists. Reporting
    // "no such account" would let anyone test which emails are registered.
    await sendPasswordReset(values.email).catch(() => undefined);
    setSent(true);
  });

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
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="h1" accessibilityRole="header">
            {t('auth.resetTitle')}
          </Text>
          <Text variant="body" tone="secondary">
            {t('auth.resetBody')}
          </Text>
        </View>

        {sent ? (
          <View
            style={{
              backgroundColor: theme.colors.feedback.successBg,
              padding: theme.spacing.lg,
              borderRadius: theme.radii.md,
            }}
          >
            <Text
              variant="bodySmall"
              accessibilityLiveRegion="polite"
              style={{ color: theme.colors.feedback.successFg }}
            >
              {t('auth.resetSent')}
            </Text>
          </View>
        ) : (
          <>
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
                  onSubmitEditing={() => void onSubmit()}
                />
              )}
            />
            <Button
              label={t('common.continue')}
              fullWidth
              loading={formState.isSubmitting}
              onPress={() => void onSubmit()}
            />
          </>
        )}
      </View>
    </Screen>
  );
}
