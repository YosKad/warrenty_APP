import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { isolateAuto } from '@/lib/format';
import type { ChainNode } from '@/domain/serviceConcierge';
import { Text } from '@/ui';

/**
 * "Your service route".
 *
 * The chain, collapsed. Samline imports the television *and* honours its
 * warranty, so it appears once with both roles — printing it twice makes a
 * three-company chain look like a five-company bureaucracy, which is the
 * opposite of what this screen is for.
 *
 * Rendered as a vertical sequence with connectors rather than a table, because
 * the thing a user needs to understand is an order: the manufacturer made it,
 * the importer owes you the warranty, and a third company will actually fix it.
 */

export type ServiceRouteCardProps = {
  chain: ChainNode[];
};

export function ServiceRouteCard({ chain }: ServiceRouteCardProps) {
  const theme = useTheme();
  const { t } = useTranslation();

  if (chain.length === 0) return null;

  return (
    <View
      style={{
        gap: theme.spacing.md,
        padding: theme.spacing.lg,
        borderRadius: theme.radii.xl,
        backgroundColor: theme.colors.bg.surface,
      }}
    >
      <Text variant="metadata" tone="tertiary">
        {t('service.route').toUpperCase()}
      </Text>

      {chain.map((node, index) => (
        <View key={node.organisationId} style={{ gap: theme.spacing.md }}>
          <View style={{ gap: 1 }}>
            {/* Isolated rather than writingDirection:'auto': a Latin company
                name inside an RTL screen should keep its own character order but
                still hug the line start, which is the right-hand edge there. */}
            <Text variant="bodyStrong" numberOfLines={1}>
              {isolateAuto(node.name)}
            </Text>
            {/* Every role this company plays, in one line. "Official importer &
                warranty provider" is a sentence; two rows saying the same
                company twice is a database dump. */}
            <Text variant="caption" tone="secondary" style={{ writingDirection: 'auto' }}>
              {node.roles.map((role) => t(`service.roleLabel.${role}`)).join(' · ')}
            </Text>
          </View>

          {index < chain.length - 1 ? (
            <View
              accessibilityElementsHidden
              style={{
                width: 2,
                height: 14,
                marginStart: 3,
                borderRadius: 1,
                backgroundColor: theme.colors.border.default,
              }}
            />
          ) : null}
        </View>
      ))}
    </View>
  );
}
