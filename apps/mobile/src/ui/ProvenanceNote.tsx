import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import type { ConfidenceLevel, WarrantySource } from '@/domain/warranty';
import { Text } from './Text';
import { InfoIcon } from './icons';

/**
 * Provenance note — the trust layer, made visible.
 *
 * Wherever the app shows information it worked out rather than information the user
 * typed, this component says where it came from and how sure we are. It is small and
 * quiet by design; the point is that it is always there, not that it shouts.
 *
 * This is a product principle, not decoration: an app that silently presents guessed
 * warranty terms as fact is worse than useless, because people will act on it.
 */

export type ProvenanceNoteProps = {
  source: WarrantySource | 'categoryTypical';
  confidence?: ConfidenceLevel;
  lastVerifiedAt?: string | null;
  onPress?: () => void;
  compact?: boolean;
};

export function ProvenanceNote({
  source,
  confidence,
  lastVerifiedAt,
  onPress,
  compact = false,
}: ProvenanceNoteProps) {
  const theme = useTheme();
  const { t, i18n } = useTranslation();

  const sourceLabel = t(`warranty.source.${source}`);
  const confidenceLabel = confidence ? t(`warranty.confidence.${confidence}`) : null;

  const verifiedLabel = lastVerifiedAt
    ? t('detect.lastChecked', {
        date: new Intl.DateTimeFormat(i18n.language, {
          month: 'short',
          year: 'numeric',
        }).format(new Date(lastVerifiedAt)),
      })
    : null;

  const tone =
    confidence === 'high'
      ? theme.colors.feedback.successFg
      : confidence === 'medium'
        ? theme.colors.feedback.infoFg
        : theme.colors.text.tertiary;

  const content = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.xs + 2,
        flexWrap: 'wrap',
      }}
    >
      <InfoIcon size={compact ? 13 : 15} color={theme.colors.text.tertiary} />
      <Text variant="caption" tone="tertiary">
        {sourceLabel}
      </Text>
      {confidenceLabel ? (
        <>
          <Text variant="caption" tone="tertiary">
            ·
          </Text>
          <Text variant="caption" style={{ color: tone }}>
            {confidenceLabel}
          </Text>
        </>
      ) : null}
      {verifiedLabel && !compact ? (
        <>
          <Text variant="caption" tone="tertiary">
            ·
          </Text>
          <Text variant="caption" tone="tertiary">
            {verifiedLabel}
          </Text>
        </>
      ) : null}
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${sourceLabel}. ${confidenceLabel ?? ''}`}
      onPress={onPress}
      hitSlop={8}
    >
      {content}
    </Pressable>
  );
}

/**
 * The stronger treatment, used when a value is low-confidence enough that the user
 * really should confirm it before relying on it.
 */
export function VerifyPrompt({ message }: { message?: string }) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: 'row',
        gap: theme.spacing.sm,
        alignItems: 'flex-start',
        backgroundColor: theme.colors.feedback.warningBg,
        borderRadius: theme.radii.md,
        padding: theme.spacing.md,
      }}
    >
      <InfoIcon size={16} color={theme.colors.feedback.warningFg} />
      <Text variant="bodySmall" style={{ flex: 1, color: theme.colors.feedback.warningFg }}>
        {message ?? t('warranty.verifyPrompt')}
      </Text>
    </View>
  );
}
