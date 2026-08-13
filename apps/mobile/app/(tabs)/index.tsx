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
import { useProductList, useProductQuota } from '@/hooks/useProducts';
import { useProtection } from '@/hooks/useProtection';
import { daysBetween } from '@/domain/date';
import { useSessionStore } from '@/state/session';
import { ProductCard } from '@/features/products/ProductCard';
import { ProtectionHero } from '@/features/protection/ProtectionHero';
import { SuggestedActions } from '@/features/protection/SuggestedActions';
import {
  Button,
  ChevronIcon,
  EmptyState,
  ListSkeleton,
  Screen,
  Text,
} from '@/ui';

/**
 * Home (V2).
 *
 * V1 answered "how many of each status do I have?" with three counter tiles. That
 * is a report, not a product: it told you the state of your data and then left you
 * to work out what to do about it.
 *
 * V2 answers "am I actually covered, and what should I do next?" — the Protection
 * Score, the one thing that is genuinely urgent, and a short list of actions that
 * each raise the score by a stated amount. Everything else is one tap away.
 *
 * Still no chart, no feed and no tips carousel.
 */
export default function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const { timeZone } = useLocale();
  const queryClient = useQueryClient();
  const profile = useSessionStore((s) => s.profile);

  const protection = useProtection();
  const recent = useProductList({ sort: 'recent' });
  const quota = useProductQuota();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.products.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.protection }),
    ]);
    setRefreshing(false);
  }, [queryClient]);

  const localHour = Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone }).format(
      new Date(),
    ),
  );

  const firstName = profile?.displayName?.split(' ')[0] ?? '';
  const items = recent.data?.items;
  const isLoading = recent.isLoading || protection.isLoading;
  const isEmpty = items !== undefined && items.length === 0;

  return (
    <Screen
      scroll
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
      }
    >
      <View style={{ gap: theme.spacing.xl, paddingTop: theme.spacing.md }}>
        <Text variant="h2" accessibilityRole="header" style={{ writingDirection: 'auto' }}>
          {t(greetingKey(localHour))}
          {firstName ? `, ${firstName}` : ''}
        </Text>

        {isLoading ? (
          <ListSkeleton count={3} />
        ) : isEmpty ? (
          <EmptyState
            title={t('products.empty.title')}
            body={t('products.empty.body')}
            actionLabel={t('products.empty.cta')}
            onAction={() => router.push('/add')}
          />
        ) : (
          <>
            <ProtectionHero portfolio={protection.portfolio} />

            <AttentionCard />

            <SuggestedActions
              actions={protection.actions}
              productFor={protection.productFor}
              onSelect={(productId) => router.push(`/product/${productId}`)}
            />

            <View style={{ gap: theme.spacing.sm }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <Text variant="h3" accessibilityRole="header">
                  {t('home.yourProducts')}
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

              <View style={{ gap: theme.spacing.xs }}>
                {items?.slice(0, 4).map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    dense
                    onPress={() => router.push(`/product/${product.id}`)}
                  />
                ))}
              </View>
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
                </Text>
              ) : null}
            </View>
          </>
        )}
      </View>
    </Screen>
  );
}

/**
 * The single most urgent item, if there is one. Deliberately capped at one: a list of
 * five "urgent" things is a list of zero urgent things.
 *
 * V2 keeps the dark brand panel here — it is the one place on the screen that should
 * interrupt, and it earns the contrast by being conditional.
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
    <View
      style={{
        gap: theme.spacing.md,
        padding: theme.spacing.xl,
        borderRadius: theme.radii.xxl,
        backgroundColor: theme.colors.bg.brand,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <View
          style={{
            width: 7,
            height: 7,
            borderRadius: 4,
            backgroundColor: theme.colors.protection.endingFg,
          }}
        />
        <Text variant="metadata" tone="onBrand" style={{ opacity: 0.65 }}>
          {t('home.attentionTitle').toUpperCase()}
        </Text>
      </View>

      <Text variant="h3" tone="onBrand" style={{ writingDirection: 'auto' }}>
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
  );
}
