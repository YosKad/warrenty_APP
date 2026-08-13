import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import type { SuggestedAction } from '@/domain/protection';
import type { ProtectionProductRow } from '@/hooks/useProtection';
import { CheckIcon, ProductImage, Text } from '@/ui';

/**
 * "Recommended actions".
 *
 * The point of scoring the portfolio is that a gap becomes a task. Each row names
 * the missing fact, the product it belongs to, and what closing it is worth — a
 * number the user can verify by doing it and watching the ring move.
 *
 * Ordering is by `buildSuggestedActions`, which weights the gap by how urgent the
 * product is, so a missing receipt on a warranty ending in twelve days outranks a
 * missing model number on one with two years left.
 */

export type SuggestedActionsProps = {
  actions: SuggestedAction[];
  productFor: (productId: string) => ProtectionProductRow | null;
  onSelect: (productId: string) => void;
};

export function SuggestedActions({ actions, productFor, onSelect }: SuggestedActionsProps) {
  const theme = useTheme();
  const { t } = useTranslation();

  if (actions.length === 0) {
    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          padding: theme.spacing.lg,
          borderRadius: theme.radii.xl,
          backgroundColor: theme.colors.protection.activeBg,
        }}
      >
        <CheckIcon size={18} color={theme.colors.protection.activeFg} />
        <Text variant="bodySmallStrong" style={{ color: theme.colors.protection.activeFg }}>
          {t('protection.complete')}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View style={{ gap: 2 }}>
        <Text variant="h3" accessibilityRole="header">
          {t('protection.recommendedActions')}
        </Text>
        <Text variant="caption" tone="tertiary">
          {t('protection.recommendedSubtitle')}
        </Text>
      </View>

      <View style={{ gap: theme.spacing.xs }}>
        {actions.map((action) => {
          const product = productFor(action.productId);
          if (!product) return null;

          const label = t(`protection.action.${action.key}`);

          return (
            <Pressable
              key={`${action.productId}:${action.key}`}
              accessibilityRole="button"
              accessibilityLabel={`${label}. ${product.name}`}
              onPress={() => onSelect(action.productId)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.md,
                padding: theme.spacing.md,
                borderRadius: theme.radii.lg,
                backgroundColor: pressed
                  ? theme.colors.bg.subtle
                  : theme.colors.bg.surface,
              })}
            >
              <ProductImage
                imagePath={product.imagePath}
                category={product.categorySlug}
                name={product.name}
                size={40}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="bodySmallStrong" numberOfLines={1}>
                  {label}
                </Text>
                <Text
                  variant="caption"
                  tone="tertiary"
                  numberOfLines={1}
                  style={{ writingDirection: 'auto' }}
                >
                  {product.name}
                </Text>
              </View>
              {/* What the action is worth. Shown because a score you can't move on
                  purpose is a score you stop believing. */}
              <Text variant="caption" style={{ color: theme.colors.text.accent }}>
                {t('protection.worth', { count: action.weight })}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
