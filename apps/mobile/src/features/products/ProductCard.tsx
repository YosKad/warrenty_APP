import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { formatDate } from '@/lib/format';
import { useLocale } from '@/hooks/useLocale';
import type { ProductListItem } from '@/services/productService';
import { ProductImage, Text } from '@/ui';

/**
 * Product card (V2).
 *
 * V1 wrapped four lines of text in a bordered box and showed the same grey mark
 * for every product, so a list read as rows in a table. V2 leads with the object
 * itself: you should recognise your television before you read its name.
 *
 * Four facts, in the order someone actually scans them — what it is, what state
 * it's in, how long that state lasts, and when. Model numbers, serials, prices
 * and categories belong on the detail screen; putting them here is what turned
 * the list into a table in the first place.
 *
 * The card has no border. Separation comes from the surface being brighter than
 * the warm canvas, which is why the canvas is warm.
 */

export type ProductCardProps = {
  product: ProductListItem;
  onPress: () => void;
  /** Compact variant for the Home rail. */
  dense?: boolean;
};

export function ProductCard({ product, onPress, dense = false }: ProductCardProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { locale } = useLocale();

  const tone = protectionTone(product.status, theme);
  const remaining = remainingLabel(product, t, locale);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('a11y.productCard', {
        name: product.name,
        status: t(statusLabelKey(product.status)),
        remaining,
      })}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.lg,
        paddingVertical: dense ? theme.spacing.md : theme.spacing.lg,
        paddingHorizontal: theme.spacing.lg,
        borderRadius: theme.radii.xl,
        backgroundColor: pressed ? theme.colors.bg.subtle : theme.colors.bg.surface,
        transform: [{ scale: pressed ? 0.99 : 1 }],
      })}
    >
      <ProductImage
        imagePath={product.imagePath}
        category={product.categorySlug}
        name={product.name}
        size={dense ? 52 : 60}
      />

      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text variant="bodyStrong" numberOfLines={1} style={{ writingDirection: 'auto' }}>
          {product.name}
        </Text>

        {product.brandName ? (
          <Text
            variant="caption"
            tone="tertiary"
            numberOfLines={1}
            style={{ writingDirection: 'auto' }}
          >
            {product.brandName}
          </Text>
        ) : null}

        {/* Status as a coloured dot plus words, not a filled pill. A list of
            eight pills is louder than the products themselves. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.sm,
            marginTop: 3,
          }}
        >
          <View
            style={{
              width: 7,
              height: 7,
              borderRadius: 4,
              backgroundColor: tone,
              // Ring for ending-soon and hollow for expired, so state survives
              // greyscale and colour-vision deficiency.
              borderWidth: product.status === 'active' ? 0 : 1.5,
              borderColor: tone,
              ...(product.status !== 'active' ? { backgroundColor: 'transparent' } : {}),
            }}
          />
          <Text variant="bodySmallStrong" style={{ color: tone }}>
            {t(statusLabelKey(product.status))}
          </Text>
          {remaining ? (
            <>
              <Text variant="caption" tone="tertiary">
                ·
              </Text>
              <Text variant="caption" tone="secondary" numberOfLines={1}>
                {remaining}
              </Text>
            </>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

function protectionTone(
  status: ProductListItem['status'],
  theme: ReturnType<typeof useTheme>,
): string {
  switch (status) {
    case 'active':
      return theme.colors.protection.activeFg;
    case 'ending_soon':
      return theme.colors.protection.endingFg;
    case 'expired':
      return theme.colors.protection.expiredFg;
    default:
      return theme.colors.protection.unknownFg;
  }
}

function statusLabelKey(status: ProductListItem['status']): string {
  switch (status) {
    case 'active':
      return 'product.protected';
    case 'ending_soon':
      return 'product.endingSoon';
    case 'expired':
      return 'product.expired';
    default:
      return 'product.warrantyUnknown';
  }
}

/**
 * "312 days remaining" while there's time to act; an explicit date once the
 * number stops meaning anything; "expired 12 days ago" afterwards.
 */
function remainingLabel(
  product: ProductListItem,
  t: (key: string, options?: Record<string, unknown>) => string,
  locale: string,
): string {
  if (product.daysRemaining === null) return '';
  if (product.daysRemaining < 0) {
    return t('product.expiredAgo', { count: Math.abs(product.daysRemaining) });
  }
  if (product.daysRemaining > 365 && product.warrantyEnd) {
    return t('product.endsOn', { date: formatDate(product.warrantyEnd, locale, 'medium') });
  }
  return t('product.daysRemaining', { count: product.daysRemaining });
}
