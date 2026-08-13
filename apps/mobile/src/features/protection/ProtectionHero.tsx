import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import type { PortfolioProtection } from '@/domain/protection';
import { ProtectionRing, Text } from '@/ui';

/**
 * The Protection Score hero.
 *
 * This replaced V1's three counter tiles ("6 active / 2 ending soon / 1 expired").
 * Those tiles stated facts without ever implying an action, and three numbers of
 * equal visual weight say nothing about which one matters. One number, one
 * sentence about it, and the actions that raise it directly below.
 *
 * The score is deterministic — see `src/domain/protection.ts`. Nothing here is
 * inferred or model-generated, which is the only reason it earns this much space.
 */

export type ProtectionHeroProps = {
  portfolio: PortfolioProtection;
};

const BAND_KEY: Record<PortfolioProtection['band'], string> = {
  strong: 'protection.bandStrong',
  fair: 'protection.bandFair',
  needs_attention: 'protection.bandNeedsAttention',
  empty: 'protection.bandEmpty',
};

export function ProtectionHero({ portfolio }: ProtectionHeroProps) {
  const theme = useTheme();
  const { t } = useTranslation();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.xl,
        padding: theme.spacing.xl,
        borderRadius: theme.radii.xxl,
        backgroundColor: theme.colors.bg.surface,
      }}
    >
      <ProtectionRing
        score={portfolio.score}
        band={portfolio.band}
        size={116}
        caption={t('protection.caption')}
      />

      <View style={{ flex: 1, minWidth: 0, gap: theme.spacing.xs }}>
        <Text variant="metadata" tone="tertiary">
          {t('protection.title').toUpperCase()}
        </Text>
        <Text variant="h3">{t(BAND_KEY[portfolio.band])}</Text>
        {portfolio.productCount > 0 ? (
          <Text variant="caption" tone="secondary">
            {t('home.trackedCount', { count: portfolio.productCount })}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
