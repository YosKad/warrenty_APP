import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import type { WarrantyStatus } from '@/domain/warranty';
import { Text } from './Text';

/**
 * Warranty status badge.
 *
 * Colour is never the only signal. Each state carries a written label and a distinct
 * dot shape, so the badge remains legible with colour-vision deficiency, in
 * greyscale, and to a screen reader. That rule is a WCAG requirement and also just
 * better design — "green" means nothing to someone who has not learned the code.
 */

export type StatusTone = 'active' | 'ending_soon' | 'expired' | 'unknown';

export type StatusBadgeProps = {
  status: WarrantyStatus;
  size?: 'sm' | 'md';
  /** Optional trailing detail, e.g. "312 days left". */
  detail?: string;
};

export function StatusBadge({ status, size = 'md', detail }: StatusBadgeProps) {
  const theme = useTheme();
  const { t } = useTranslation();

  const { fg, bg, labelKey } = (() => {
    switch (status) {
      case 'active':
        return {
          fg: theme.colors.protection.activeFg,
          bg: theme.colors.protection.activeBg,
          labelKey: 'home.statusActive',
        };
      case 'ending_soon':
        return {
          fg: theme.colors.protection.endingFg,
          bg: theme.colors.protection.endingBg,
          labelKey: 'home.statusEndingSoon',
        };
      case 'expired':
        return {
          fg: theme.colors.protection.expiredFg,
          bg: theme.colors.protection.expiredBg,
          labelKey: 'home.statusExpired',
        };
      default:
        return {
          fg: theme.colors.protection.unknownFg,
          bg: theme.colors.protection.unknownBg,
          labelKey: 'product.warrantyUnknown',
        };
    }
  })();

  const label = t(labelKey);

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.xs + 2,
        alignSelf: 'flex-start',
        backgroundColor: bg,
        paddingHorizontal: size === 'sm' ? theme.spacing.sm : theme.spacing.md,
        paddingVertical: size === 'sm' ? 3 : 5,
        borderRadius: theme.radii.pill,
      }}
    >
      <StatusDot status={status} color={fg} />
      <Text
        variant={size === 'sm' ? 'metadata' : 'bodySmallStrong'}
        tone="inherit"
        style={{ color: fg }}
      >
        {label}
      </Text>
    </View>
  );
}

/**
 * A second, non-colour channel: filled circle for active, ring for ending soon,
 * hollow square for expired.
 */
function StatusDot({ status, color }: { status: WarrantyStatus; color: string }) {
  if (status === 'ending_soon') {
    return (
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          borderWidth: 2,
          borderColor: color,
        }}
      />
    );
  }
  if (status === 'expired') {
    return (
      <View
        style={{ width: 8, height: 8, borderWidth: 1.5, borderColor: color }}
      />
    );
  }
  if (status === 'unknown') {
    return (
      <View
        style={{ width: 8, height: 2, backgroundColor: color, borderRadius: 1 }}
      />
    );
  }
  return <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />;
}
