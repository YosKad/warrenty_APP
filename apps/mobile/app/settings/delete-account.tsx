import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { track } from '@/lib/analytics';
import { isAppError } from '@/lib/errors';
import { deleteAccount } from '@/services/authService';
import { useSessionStore } from '@/state/session';
import { SettingsScreen } from '@/features/settings/SettingsScreen';
import { Button, Card, Input, ScreenFooter, Text, useToast } from '@/ui';

/**
 * Account deletion.
 *
 * In-app, reachable, and it actually deletes — required by both stores and by
 * privacy law, and the right default regardless. The typed-email confirmation is a
 * deliberate speed bump rather than security theatre: the server re-authenticates
 * the caller's JWT and does the work.
 *
 * The note about cancelling the subscription separately is important and honest: we
 * cannot cancel an App Store or Play subscription on the user's behalf, and leaving
 * them to discover a live charge after deleting their account would be indefensible.
 */
export default function DeleteAccountScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const toast = useToast();
  const profile = useSessionStore((s) => s.profile);

  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);

  const matches =
    profile?.email !== undefined &&
    confirmation.trim().toLowerCase() === profile.email.toLowerCase();

  const onDelete = async () => {
    setBusy(true);
    try {
      await deleteAccount(confirmation);
      track({ name: 'account_deleted', props: {} });
      router.replace('/(auth)/welcome');
    } catch (error) {
      toast.show(t(isAppError(error) ? error.messageKey : 'errors.unknown'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsScreen
      title={t('deleteAccount.title')}
      footer={
        <ScreenFooter>
          <Button
            label={t('deleteAccount.confirmCta')}
            variant="danger"
            fullWidth
            disabled={!matches}
            loading={busy}
            onPress={() => void onDelete()}
          />
        </ScreenFooter>
      }
    >
      <Card style={{ backgroundColor: theme.colors.feedback.dangerBg }}>
        <Text variant="bodySmall" style={{ color: theme.colors.feedback.dangerFg }}>
          {t('deleteAccount.warning')}
        </Text>
      </Card>

      <Text variant="bodySmall" tone="secondary">
        {t('deleteAccount.keepsNote')}
      </Text>

      <View style={{ gap: theme.spacing.md }}>
        <Input
          label={t('deleteAccount.confirmLabel')}
          required
          value={confirmation}
          onChangeText={setConfirmation}
          placeholder={profile?.email}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
    </SettingsScreen>
  );
}
