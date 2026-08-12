import { Pressable, View } from 'react-native';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { isAppError } from '@/lib/errors';
import { signInWithEmail } from '@/services/authService';
import { signInSchema, type SignInValues } from '@/features/auth/schemas';
import { BackIcon, Button, Input, Screen, Text, useToast } from '@/ui';

export default function SignInScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const toast = useToast();

  const { control, handleSubmit, formState } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
    mode: 'onTouched',
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await signInWithEmail(values.email, values.password);
      router.replace('/(tabs)');
    } catch (error) {
      // Never distinguish "no such account" from "wrong password" — that difference
      // is an account-enumeration oracle.
      toast.show(
        t(isAppError(error) && error.code === 'network' ? 'errors.network' : 'errors.unauthenticated'),
        'error',
      );
    }
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
        <Text variant="h1" accessibilityRole="header">
          {t('auth.signIn')}
        </Text>

        <View style={{ gap: theme.spacing.lg }}>
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
                returnKeyType="next"
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
                secureTextEntry
                autoComplete="current-password"
                textContentType="password"
                returnKeyType="go"
                onSubmitEditing={() => void onSubmit()}
              />
            )}
          />

          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/(auth)/forgot-password')}
            hitSlop={8}
            style={{ alignSelf: 'flex-start' }}
          >
            <Text variant="bodySmall" tone="accent">
              {t('auth.forgotPassword')}
            </Text>
          </Pressable>
        </View>

        <Button
          label={t('auth.signIn')}
          fullWidth
          loading={formState.isSubmitting}
          onPress={() => void onSubmit()}
        />

        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'center',
            gap: theme.spacing.xs,
          }}
        >
          <Text variant="bodySmall" tone="secondary">
            {t('auth.noAccount')}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace('/(auth)/sign-up')}
            hitSlop={8}
          >
            <Text variant="bodySmallStrong" tone="accent">
              {t('auth.signUp')}
            </Text>
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}
