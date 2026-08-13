import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import type { ProtectionCompleteness, ProtectionFactorKey } from '@/domain/protection';
import { CheckIcon, ChevronIcon, ProtectionMeter, Text } from '@/ui';

/**
 * Per-product claim readiness.
 *
 * The same score as Home, broken into the facts it is made of. Every missing
 * factor is a row you can act on, and the weight next to it is what closing it is
 * worth — so the number stops being a judgement and becomes a checklist.
 *
 * Satisfied factors are listed too, quietly. Seeing "receipt attached" is what
 * makes the score credible; showing only what's missing reads as nagging.
 */

export type ProtectionBreakdownProps = {
  completeness: ProtectionCompleteness;
  /** Opens the right place to supply the missing fact. */
  onFix: (key: ProtectionFactorKey) => void;
};

export function ProtectionBreakdown({ completeness, onFix }: ProtectionBreakdownProps) {
  const theme = useTheme();
  const { t } = useTranslation();

  return (
    <View
      style={{
        gap: theme.spacing.lg,
        padding: theme.spacing.lg,
        borderRadius: theme.radii.xl,
        backgroundColor: theme.colors.bg.surface,
      }}
    >
      <View style={{ gap: theme.spacing.sm }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Text variant="h3" accessibilityRole="header">
            {t('protection.detailTitle')}
          </Text>
          <Text variant="caption" tone="tertiary">
            {completeness.gaps.length > 0
              ? t('protection.gapsRemaining', { count: completeness.gaps.length })
              : t('protection.complete')}
          </Text>
        </View>
        <ProtectionMeter score={completeness.score} />
      </View>

      {completeness.gaps.length > 0 ? (
        <View style={{ gap: theme.spacing.xs }}>
          {completeness.gaps.map((gap) => (
            <Pressable
              key={gap.key}
              accessibilityRole="button"
              accessibilityLabel={t(`protection.action.${gap.key}`)}
              onPress={() => onFix(gap.key)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.md,
                paddingVertical: theme.spacing.md,
                paddingHorizontal: theme.spacing.md,
                borderRadius: theme.radii.md,
                backgroundColor: pressed ? theme.colors.bg.subtle : 'transparent',
              })}
            >
              {/* A hollow ring, matching the empty part of the meter above. */}
              <View
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 8,
                  borderWidth: 1.5,
                  borderColor: theme.colors.border.default,
                }}
              />
              <Text variant="bodySmall" style={{ flex: 1 }} numberOfLines={1}>
                {t(`protection.action.${gap.key}`)}
              </Text>
              <Text variant="caption" style={{ color: theme.colors.text.accent }}>
                {t('protection.worth', { count: gap.weight })}
              </Text>
              <ChevronIcon size={16} color={theme.colors.text.tertiary} />
            </Pressable>
          ))}
        </View>
      ) : null}

      {completeness.satisfied.length > 0 ? (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: theme.spacing.sm,
          }}
        >
          {completeness.satisfied.map((key) => (
            <View
              key={key}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.xs,
                paddingVertical: 5,
                paddingHorizontal: theme.spacing.sm,
                borderRadius: theme.radii.pill,
                backgroundColor: theme.colors.protection.activeBg,
              }}
            >
              <CheckIcon size={12} color={theme.colors.protection.activeFg} />
              <Text variant="caption" style={{ color: theme.colors.protection.activeFg }}>
                {t(`protection.factor.${key}`)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
