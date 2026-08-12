import { FlatList, Pressable, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { queryKeys } from '@/lib/queryClient';
import { formatDateTime } from '@/lib/format';
import { useLocale } from '@/hooks/useLocale';
import { listAlerts, markRead, type AlertItem } from '@/services/notificationService';
import { Card, EmptyState, ListSkeleton, Screen, Text } from '@/ui';

/**
 * Alerts.
 *
 * The inbox is rendered from i18n keys plus parameters rather than pre-rendered
 * strings, so a reminder scheduled months ago in English still displays in Hebrew if
 * the user has since switched language.
 */
export default function AlertsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const { locale, timeZone } = useLocale();
  const queryClient = useQueryClient();

  const alerts = useQuery({
    queryKey: queryKeys.alerts.list,
    queryFn: () => listAlerts(true),
  });

  const markReadMutation = useMutation({
    mutationFn: markRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.alerts.list });
      void queryClient.invalidateQueries({ queryKey: queryKeys.alerts.unreadCount });
    },
  });

  const items = alerts.data ?? [];
  const unreadIds = items.filter((a) => !a.readAt).map((a) => a.id);

  return (
    <Screen padded={false}>
      <View
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.md,
          paddingBottom: theme.spacing.sm,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Text variant="h1" accessibilityRole="header">
          {t('alerts.title')}
        </Text>
        {unreadIds.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => markReadMutation.mutate(unreadIds)}
            hitSlop={8}
          >
            <Text variant="bodySmall" tone="accent">
              {t('alerts.markAllRead')}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {alerts.isLoading ? (
        <View style={{ padding: theme.spacing.lg }}>
          <ListSkeleton count={4} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{
            padding: theme.spacing.lg,
            gap: theme.spacing.md,
            flexGrow: 1,
          }}
          renderItem={({ item }) => (
            <AlertRow
              alert={item}
              locale={locale}
              timeZone={timeZone}
              onPress={() => {
                if (!item.readAt) markReadMutation.mutate([item.id]);
                if (item.productId) router.push(`/product/${item.productId}`);
              }}
            />
          )}
          ListEmptyComponent={
            <EmptyState title={t('alerts.empty.title')} body={t('alerts.empty.body')} />
          }
        />
      )}
    </Screen>
  );
}

function AlertRow({
  alert,
  locale,
  timeZone,
  onPress,
}: {
  alert: AlertItem;
  locale: string;
  timeZone: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const unread = alert.readAt === null;

  return (
    <Card onPress={onPress} accessibilityLabel={t(alert.titleKey, alert.params)}>
      <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
        {/* Unread marker doubles as the only colour on the row, so scanning for
            "what's new" doesn't require reading. */}
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            marginTop: 6,
            backgroundColor: unread ? theme.colors.accent.solid : 'transparent',
          }}
        />
        <View style={{ flex: 1, gap: theme.spacing.xs }}>
          <Text variant={unread ? 'bodyStrong' : 'body'}>
            {t(alert.titleKey, alert.params)}
          </Text>
          <Text variant="bodySmall" tone="secondary">
            {t(alert.bodyKey, alert.params)}
          </Text>
          <Text variant="caption" tone="tertiary">
            {formatDateTime(alert.sentAt, locale, timeZone)}
          </Text>
        </View>
      </View>
    </Card>
  );
}
