import { View } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { formatDate } from '@/lib/format';
import { useLocale } from '@/hooks/useLocale';
import type { ProductListItem } from '@/services/productService';
import { Card, StatusBadge, Text, WarrantyMarkIcon } from '@/ui';

/**
 * Product card.
 *
 * Reads like a card in a wallet: the object, its state, and when that state changes.
 * Four facts and no more — name, brand, status, time remaining. Model numbers,
 * serials, prices and categories all belong on the detail screen; putting them here
 * would turn a scannable list into a table.
 */

export type ProductCardProps = {
  product: ProductListItem;
  imageUrl?: string | null;
  onPress: () => void;
};

export function ProductCard({ product, imageUrl, onPress }: ProductCardProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { locale } = useLocale();

  const remainingLabel = remainingText(product.daysRemaining, product.warrantyEnd, t, locale);

  return (
    <Card
      onPress={onPress}
      padded={false}
      accessibilityLabel={t('a11y.productCard', {
        name: product.name,
        status: t(statusLabelKey(product.status)),
        remaining: remainingLabel,
      })}
    >
      <View
        style={{
          flexDirection: 'row',
          gap: theme.spacing.md,
          padding: theme.spacing.lg,
          alignItems: 'center',
        }}
      >
        <ProductThumbnail imageUrl={imageUrl} />

        <View style={{ flex: 1, gap: theme.spacing.xs + 2 }}>
          <View style={{ gap: 1 }}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {product.name}
            </Text>
            {product.brandName ? (
              <Text variant="caption" tone="tertiary" numberOfLines={1}>
                {product.brandName}
              </Text>
            ) : null}
          </View>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.sm,
              flexWrap: 'wrap',
            }}
          >
            <StatusBadge status={product.status} size="sm" />
            {remainingLabel ? (
              <Text variant="caption" tone="secondary">
                {remainingLabel}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </Card>
  );
}

function ProductThumbnail({ imageUrl }: { imageUrl?: string | null }) {
  const theme = useTheme();

  if (imageUrl) {
    return (
      <Image
        source={{ uri: imageUrl }}
        // `contentFit: cover` on a fixed square keeps the list rhythm regardless of
        // the source aspect ratio.
        contentFit="cover"
        transition={160}
        style={{
          width: 56,
          height: 56,
          borderRadius: theme.radii.md,
          backgroundColor: theme.colors.bg.subtle,
        }}
      />
    );
  }

  return (
    <View
      style={{
        width: 56,
        height: 56,
        borderRadius: theme.radii.md,
        backgroundColor: theme.colors.bg.subtle,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <WarrantyMarkIcon size={24} color={theme.colors.text.tertiary} />
    </View>
  );
}

function statusLabelKey(status: ProductListItem['status']): string {
  switch (status) {
    case 'active':
      return 'product.warrantyActive';
    case 'ending_soon':
      return 'product.warrantyEndingSoon';
    case 'expired':
      return 'product.warrantyExpired';
    default:
      return 'product.warrantyUnknown';
  }
}

/**
 * "312 days remaining" while there is time to act, an explicit end date once the
 * number gets large enough to be meaningless, and "expired 12 days ago" afterwards.
 */
function remainingText(
  daysRemaining: number | null,
  warrantyEnd: string | null,
  t: (key: string, options?: Record<string, unknown>) => string,
  locale: string,
): string {
  if (daysRemaining === null) return '';
  if (daysRemaining < 0) {
    return t('product.expiredAgo', { count: Math.abs(daysRemaining) });
  }
  if (daysRemaining > 365 && warrantyEnd) {
    return t('product.endsOn', { date: formatDate(warrantyEnd, locale, 'medium') });
  }
  return t('product.daysRemaining', { count: daysRemaining });
}
