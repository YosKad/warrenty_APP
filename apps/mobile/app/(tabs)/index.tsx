import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { queryKeys } from '@/lib/queryClient';
import { formatDate, greetingKey } from '@/lib/format';
import { track } from '@/lib/analytics';
import { useLocale } from '@/hooks/useLocale';
import {
  useProductList,
  useProductQuota,
  useWarrantySummary,
} from '@/hooks/useProducts';
import { daysBetween } from '@/domain/date';
import { remainingProductSlots } from '@/domain/entitlements';
import { useSessionStore } from '@/state/session';
import { ProductCard } from '@/features/products/ProductCard';
import {
  Button,
  Card,
  ChevronIcon,
  EmptyState,
  ListSkeleton,
  Screen,
  Text,
} from '@/ui';

/**
 * Home.
 *
 * The two-second question this screen answers: *is anything about to run out?* So the
 * order is greeting → how many things are protected → what needs attention → recent
 * items. Everything else lives a tap away.
 *
 * There is no chart, no activity feed and no tips carousel. A calm screen that
 * answers one question well is worth more than a dashboard.
 */
export default function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const { timeZone } = useLocale();
  const queryClient = useQueryClient();
  const profile = useSessionStore((s) => s.profile);

  const summary = useWarrantySummary();
  const recent = useProductList({ sort: 'recent' });
  const quota = useProductQuota();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.products.summary }),
      queryClient.invalidateQueries({ queryKey: queryKeys.products.all }),
    ]);
    setRefreshing(false);
  }, [queryClient]);

  const localHour = Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone }).format(
      new Date(),
    ),
  );

  const firstName = profile?.displayName?.split(' ')[0] ?? '';
  const counts = summary.data;
  const isEmpty = counts !== undefined && counts.total === 0;

  return (
    <Screen
      scroll
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
      }
    >
      <View style={{ gap: theme.spacing.xl, paddingTop: theme.spacing.md }}>
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="bodySmall" tone="secondary">
            {t(greetingKey(localHour))}
            {firstName ? `, ${firstName}` : ''}
          </Text>
          <Text variant="h1" accessibilityRole="header">
            {counts && counts.total > 0
              ? t('home.protectedCount', { count: counts.active + counts.endingSoon })
              : t('home.noProductsYet')}
          </Text>
        </View>

        {summary.isLoading ? (
          <ListSkeleton count={2} />
        ) : isEmpty ? (
          <EmptyState
            title={t('products.empty.title')}
            body={t('products.empty.body')}
            actionLabel={t('products.empty.cta')}
            onAction={() => router.push('/add')}
          />
        ) : (
          <>
            <SummaryRow
              active={counts?.active ?? 0}
              endingSoon={counts?.endingSoon ?? 0}
              expired={counts?.expired ?? 0}
              onSelect={(status) => router.push(`/(tabs)/products?status=${status}`)}
            />

            <AttentionCard />

            <View style={{ gap: theme.spacing.md }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <Text variant="h3" accessibilityRole="header">
                  {t('home.recentlyAdded')}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push('/(tabs)/products')}
                  hitSlop={8}
                >
                  <Text variant="bodySmall" tone="accent">
                    {t('common.seeAll')}
                  </Text>
                </Pressable>
              </View>

              {recent.isLoading ? (
                <ListSkeleton count={3} />
              ) : (
                <View style={{ gap: theme.spacing.md }}>
                  {recent.data?.items.slice(0, 4).map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      onPress={() => router.push(`/product/${product.id}`)}
                    />
                  ))}
                </View>
              )}
            </View>

            <View style={{ gap: theme.spacing.sm }}>
              <Button
                label={t('home.quickAdd')}
                fullWidth
                onPress={() => router.push('/add')}
              />
              {/* Shown only when a limit exists, so Pro users never see a meaningless
                  counter. */}
              {quota.entitlements.product_limit !== null ? (
                <Text variant="caption" tone="tertiary" align="center">
                  {t('home.slotsUsed', {
                    used: quota.current,
                    limit: quota.entitlements.product_limit,
                  })}
                  {remainingProductSlots(quota.entitlements, quota.current) === 0 ? ' · ' : ''}
                </Text>
              ) : null}
            </View>
          </>
        )}
      </View>
    </Screen>
  );
}

function SummaryRow({
  active,
  endingSoon,
  expired,
  onSelect,
}: {
  active: number;
  endingSoon: number;
  expired: number;
  onSelect: (status: 'active' | 'ending_soon' | 'expired') => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();

  const tiles = [
    {
      status: 'active' as const,
      count: active,
      label: t('home.statusActive'),
      color: theme.colors.protection.activeFg,
    },
    {
      status: 'ending_soon' as const,
      count: endingSoon,
      label: t('home.statusEndingSoon'),
      color: theme.colors.protection.endingFg,
    },
    {
      status: 'expired' as const,
      count: expired,
      label: t('home.statusExpired'),
      color: theme.colors.protection.expiredFg,
    },
  ];

  return (
    <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
      {tiles.map((tile) => (
        <Card
          key={tile.status}
          onPress={() => onSelect(tile.status)}
          accessibilityLabel={`${tile.label}, ${tile.count}`}
          style={{ flex: 1, paddingVertical: theme.spacing.lg }}
        >
          <View style={{ gap: theme.spacing.xs }}>
            {/* A coloured rule rather than a coloured number: the count stays high
                contrast and legible, and colour is a secondary cue. */}
            <View
              style={{
                width: 20,
                height: 3,
                borderRadius: 2,
                backgroundColor: tile.color,
              }}
            />
            <Text variant="numeric">{tile.count}</Text>
            <Text variant="caption" tone="secondary" numberOfLines={2}>
              {tile.label}
            </Text>
          </View>
        </Card>
      ))}
    </View>
  );
}

/**
 * The single most urgent item, if there is one. Deliberately capped at one: a list of
 * five "urgent" things is a list of zero urgent things.
 */
function AttentionCard() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const { locale, today } = useLocale();

  const endingSoon = useProductList({ status: ['ending_soon'], sort: 'urgency' });
  const item = endingSoon.data?.items[0];

  if (!item || !item.warrantyEnd) return null;

  const days = Math.max(0, daysBetween(today, item.warrantyEnd));

  return (
    <Card variant="brand" padded>
      <View style={{ gap: theme.spacing.md }}>
        <Text variant="metadata" tone="onBrand" style={{ opacity: 0.6 }}>
          {t('home.attentionTitle')}
        </Text>
        <Text variant="h3" tone="onBrand">
          {t('home.expiringIn', { name: item.name, count: days })}
        </Text>
        <Text variant="bodySmall" tone="onBrand" style={{ opacity: 0.7 }}>
          {t('product.endsOn', { date: formatDate(item.warrantyEnd, locale) })}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            track({ name: 'warranty_alert_opened', props: { daysRemaining: days } });
            router.push(`/product/${item.id}`);
          }}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.xs,
            marginTop: theme.spacing.xs,
          }}
        >
          <Text variant="bodySmallStrong" tone="onBrand">
            {t('home.reviewWarranty')}
          </Text>
          <ChevronIcon size={16} color={theme.colors.text.onBrand} />
        </Pressable>
      </View>
    </Card>
  );
}
