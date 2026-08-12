import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { formatDate } from '@/lib/format';
import type { CalendarDate } from '@/domain/date';
import type { WarrantyStatus } from '@/domain/warranty';
import { Text } from './Text';

/**
 * Warranty timeline.
 *
 * Purchase → today → expiry, as one horizontal track. A person understands "I'm
 * three quarters of the way through" from a glance at a bar in a way they never will
 * from two dates and a subtraction.
 *
 * The track is decorative for assistive tech; the accompanying labels carry the same
 * information as text, so nothing is conveyed by the graphic alone.
 */

export type WarrantyTimelineProps = {
  start: CalendarDate | null;
  end: CalendarDate | null;
  progress: number | null;
  status: WarrantyStatus;
  locale: string;
};

export function WarrantyTimeline({
  start,
  end,
  progress,
  status,
  locale,
}: WarrantyTimelineProps) {
  const theme = useTheme();
  const { t } = useTranslation();

  if (!start || !end || progress === null) return null;

  const trackColor = theme.colors.bg.subtle;
  const fillColor =
    status === 'expired'
      ? theme.colors.status.expiredFg
      : status === 'ending_soon'
        ? theme.colors.status.endingFg
        : theme.colors.status.activeFg;

  const clamped = Math.min(1, Math.max(0, progress));

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Text variant="metadata" tone="tertiary" accessibilityRole="header">
        {t('product.timeline')}
      </Text>

      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          height: 6,
          borderRadius: 3,
          backgroundColor: trackColor,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            width: `${clamped * 100}%`,
            height: '100%',
            backgroundColor: fillColor,
            borderRadius: 3,
          }}
        />
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <View style={{ gap: 1 }}>
          <Text variant="caption" tone="tertiary">
            {t('product.timelinePurchase')}
          </Text>
          <Text variant="bodySmallStrong">{formatDate(start, locale, 'short')}</Text>
        </View>
        <View style={{ gap: 1, alignItems: 'flex-end' }}>
          <Text variant="caption" tone="tertiary">
            {t('product.timelineEnd')}
          </Text>
          <Text variant="bodySmallStrong">{formatDate(end, locale, 'short')}</Text>
        </View>
      </View>
    </View>
  );
}
