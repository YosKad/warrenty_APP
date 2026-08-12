import React, { useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { track } from '@/lib/analytics';
import { useProductList, useWarrantySummary } from '@/hooks/useProducts';
import type { WarrantyStatus } from '@/domain/warranty';
import { ProductCard } from '@/features/products/ProductCard';
import {
  EmptyState,
  ListSkeleton,
  Screen,
  SearchField,
  SegmentedControl,
  Text,
} from '@/ui';

/**
 * Product list.
 *
 * Search and a status filter, and nothing else at this level. Category and brand
 * filters live behind a sheet because most sessions are "find the thing I'm holding",
 * and that is a search, not a taxonomy exercise.
 */

type StatusFilter = 'all' | WarrantyStatus;

export default function ProductsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ status?: string }>();

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>(
    isStatusFilter(params.status) ? params.status : 'all',
  );

  const summary = useWarrantySummary();

  const filters = useMemo(
    () => ({
      query: query.trim().length > 1 ? query.trim() : undefined,
      status: status === 'all' ? undefined : [status],
      sort: 'urgency' as const,
    }),
    [query, status],
  );

  const products = useProductList(filters);
  const items = products.data?.items ?? [];

  React.useEffect(() => {
    if (query.trim().length > 1 && !products.isLoading) {
      track({ name: 'search_performed', props: { resultCount: items.length } });
    }
    // Fires when a settled result set arrives for a query, not on every keystroke.
  }, [products.isLoading, query, items.length]);

  const isFiltered = query.trim().length > 0 || status !== 'all';

  return (
    <Screen padded={false}>
      <View
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.md,
          gap: theme.spacing.md,
        }}
      >
        <Text variant="h1" accessibilityRole="header">
          {t('products.title')}
        </Text>

        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder={t('products.searchPlaceholder')}
        />

        <SegmentedControl<StatusFilter>
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: t('common.seeAll'), badge: summary.data?.total },
            {
              value: 'active',
              label: t('home.statusActive'),
              badge: summary.data?.active,
            },
            {
              value: 'ending_soon',
              label: t('home.statusEndingSoon'),
              badge: summary.data?.endingSoon,
            },
            {
              value: 'expired',
              label: t('home.statusExpired'),
              badge: summary.data?.expired,
            },
          ]}
        />
      </View>

      {products.isLoading ? (
        <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
          <ListSkeleton count={5} />
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
            <ProductCard
              product={item}
              onPress={() => router.push(`/product/${item.id}`)}
            />
          )}
          ListEmptyComponent={
            isFiltered ? (
              <EmptyState
                title={t('products.emptyFiltered.title')}
                body={t('products.emptyFiltered.body')}
                actionLabel={t('common.clear')}
                onAction={() => {
                  setQuery('');
                  setStatus('all');
                }}
              />
            ) : (
              <EmptyState
                title={t('products.empty.title')}
                body={t('products.empty.body')}
                actionLabel={t('products.empty.cta')}
                onAction={() => router.push('/add')}
              />
            )
          }
          // A modest window: product cards are cheap, and aggressive virtualisation
          // causes visible blanking while scrolling a short list.
          initialNumToRender={8}
          windowSize={7}
          removeClippedSubviews
          keyboardDismissMode="on-drag"
        />
      )}
    </Screen>
  );
}

function isStatusFilter(value: string | undefined): value is StatusFilter {
  return (
    value === 'all' ||
    value === 'active' ||
    value === 'ending_soon' ||
    value === 'expired' ||
    value === 'unknown'
  );
}
