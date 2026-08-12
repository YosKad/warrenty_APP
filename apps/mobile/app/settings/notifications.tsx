import { Linking, Pressable, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { DEFAULT_REMINDER_OFFSETS_DAYS } from '@/domain/reminders';
import {
  getPreferences,
  requestPushPermission,
  updatePreferences,
  hasPushPermission,
} from '@/services/notificationService';
import { useSessionStore } from '@/state/session';
import { SettingsScreen } from '@/features/settings/SettingsScreen';
import { Card, ListGroup, ListRow, Text, useToast } from '@/ui';

/**
 * Notification settings.
 *
 * The offsets a user picks here drive the server-side scheduler, not local
 * notifications — which is why changing them re-derives every future reminder rather
 * than only affecting new products.
 */
export default function NotificationSettingsScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const userId = useSessionStore((s) => s.session?.user.id);

  const prefs = useQuery({ queryKey: ['notification-prefs'], queryFn: getPreferences });
  const permission = useQuery({
    queryKey: ['push-permission'],
    queryFn: hasPushPermission,
  });

  const update = useMutation({
    mutationFn: (patch: Parameters<typeof updatePreferences>[1]) => {
      if (!userId) throw new Error('not signed in');
      return updatePreferences(userId, patch);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notification-prefs'] });
    },
    onError: () => toast.show(t('errors.unknown'), 'error'),
  });

  const offsets = prefs.data?.expiryOffsetsDays ?? [...DEFAULT_REMINDER_OFFSETS_DAYS];

  const toggleOffset = (offset: number) => {
    const next = offsets.includes(offset)
      ? offsets.filter((o) => o !== offset)
      : [...offsets, offset].sort((a, b) => b - a);
    // At least one reminder must remain, otherwise the product silently stops doing
    // the single thing it promises.
    if (next.length === 0) return;
    update.mutate({ expiryOffsetsDays: next });
  };

  return (
    <SettingsScreen title={t('notificationSettings.title')}>
      {permission.data === false ? (
        <Card variant="subtle">
          <View style={{ gap: theme.spacing.md }}>
            <Text variant="bodySmall" tone="secondary">
              {t('notificationSettings.permissionDenied')}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void requestPushPermission().then((granted) => {
                  if (!granted) void Linking.openSettings();
                  void permission.refetch();
                });
              }}
            >
              <Text variant="bodySmallStrong" tone="accent">
                {t('notificationSettings.openSettings')}
              </Text>
            </Pressable>
          </View>
        </Card>
      ) : null}

      <ListGroup>
        <ListRow
          label={t('notificationSettings.push')}
          toggle={{
            value: prefs.data?.pushEnabled ?? true,
            onChange: (value) => update.mutate({ pushEnabled: value }),
          }}
        />
        <ListRow
          label={t('notificationSettings.email')}
          toggle={{
            value: prefs.data?.emailEnabled ?? false,
            onChange: (value) => update.mutate({ emailEnabled: value }),
          }}
        />
      </ListGroup>

      <ListGroup title={t('notificationSettings.whenToRemind')}>
        {DEFAULT_REMINDER_OFFSETS_DAYS.map((offset) => (
          <ListRow
            key={offset}
            label={t('notificationSettings.offset', { count: offset })}
            toggle={{
              value: offsets.includes(offset),
              onChange: () => toggleOffset(offset),
            }}
          />
        ))}
      </ListGroup>

      <Card variant="subtle">
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="bodySmallStrong">{t('notificationSettings.timeOfDay')}</Text>
          <Text variant="caption" tone="tertiary">
            {t('notificationSettings.timeOfDayBody')}
          </Text>
          <Text variant="h3" style={{ marginTop: theme.spacing.xs }}>
            {`${String(prefs.data?.preferredHourLocal ?? 9).padStart(2, '0')}:00`}
          </Text>
        </View>
      </Card>
    </SettingsScreen>
  );
}
