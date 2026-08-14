import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import type { ReadinessItem, ServiceReadiness } from '@/domain/serviceConcierge';
import { CheckIcon, Text } from '@/ui';

/**
 * "Have these ready".
 *
 * A checklist, not a score. "4 of 6 ready, missing the serial number" is
 * something a person can finish in a minute; a percentage is something they can
 * only feel bad about.
 *
 * Items the warranty's own claim-requirement clauses demand are marked, so
 * "you need the receipt" is the document talking rather than us inventing an
 * obstacle.
 */

export type ServiceReadinessCardProps = {
  readiness: ServiceReadiness;
  onFix: (key: ReadinessItem['key']) => void;
};

export function ServiceReadinessCard({ readiness, onFix }: ServiceReadinessCardProps) {
  const theme = useTheme();
  const { t } = useTranslation();

  return (
    <View
      style={{
        gap: theme.spacing.md,
        padding: theme.spacing.lg,
        borderRadius: theme.radii.xl,
        backgroundColor: theme.colors.bg.surface,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: theme.spacing.sm,
        }}
      >
        <Text variant="h3" accessibilityRole="header">
          {t('service.prepare')}
        </Text>
        <Text variant="caption" tone="tertiary">
          {t('service.readyCount', {
            ready: readiness.readyCount,
            total: readiness.total,
          })}
        </Text>
      </View>

      <View style={{ gap: theme.spacing.xs }}>
        {readiness.items.map((item) => (
          <Pressable
            key={item.key}
            accessibilityRole={item.ready ? 'text' : 'button'}
            accessibilityLabel={
              item.ready
                ? t(`service.readiness.${item.key}`)
                : t('service.addMissing', { item: t(`service.readiness.${item.key}`) })
            }
            disabled={item.ready}
            onPress={() => onFix(item.key)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.md,
              paddingVertical: theme.spacing.sm,
              paddingHorizontal: theme.spacing.sm,
              borderRadius: theme.radii.md,
              backgroundColor: pressed && !item.ready ? theme.colors.bg.subtle : 'transparent',
            })}
          >
            {item.ready ? (
              <CheckIcon size={16} color={theme.colors.protection.activeFg} />
            ) : (
              <View
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 7,
                  borderWidth: 1.5,
                  // A blocking gap is the one thing here that earns a colour:
                  // it is what will actually stop the claim at the counter.
                  borderColor: item.required
                    ? theme.colors.protection.endingFg
                    : theme.colors.border.default,
                }}
              />
            )}

            <Text
              variant="bodySmall"
              tone={item.ready ? 'primary' : 'secondary'}
              style={{ flex: 1 }}
            >
              {t(`service.readiness.${item.key}`)}
            </Text>

            {!item.ready ? (
              <Text variant="caption" tone="accent">
                {t('common.edit')}
              </Text>
            ) : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}
