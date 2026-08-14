import { Linking, Pressable, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { formatDate, isolateLtr } from '@/lib/format';
import { useLocale } from '@/hooks/useLocale';
import { track } from '@/lib/analytics';
import type { WarrantyClause, WarrantySourceRef } from '@/domain/warrantyIntelligence';
import { BottomSheet, Text } from '@/ui';

/**
 * "View source".
 *
 * The affordance the product's credibility rests on. A user who is told their
 * screen fault is probably covered should be one tap from the sentence that says
 * so, in the words the warranty actually uses.
 *
 * So the order is deliberate: original text first and in full, then where it
 * came from, and only then our summary — labelled as ours. A summary shown above
 * its source invites the user to trust the paraphrase; shown below it, it reads
 * as what it is.
 */

export type ClauseSourceSheetProps = {
  clause: WarrantyClause | null;
  source: WarrantySourceRef | null;
  onDismiss: () => void;
};

export function ClauseSourceSheet({ clause, source, onDismiss }: ClauseSourceSheetProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { locale } = useLocale();

  if (!clause) return null;

  // The section is a Latin token ("Section 4.2") and the page label is
  // translated. Isolating the joined string would drag a Hebrew word inside an
  // LTR run and render it back to front, so only the section is isolated.
  const sectionLabel = clause.sourceSection ?? clause.section;
  const location = [
    sectionLabel ? isolateLtr(sectionLabel) : null,
    clause.sourcePage ? t('warrantyIntel.sourcePage', { page: clause.sourcePage }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <BottomSheet visible onDismiss={onDismiss} title={t('warrantyIntel.sourceTitle')}>
      <ScrollView contentContainerStyle={{ gap: theme.spacing.lg, paddingBottom: theme.spacing.lg }}>
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="metadata" tone="tertiary">
            {t('warrantyIntel.sourceOriginalText').toUpperCase()}
          </Text>
          {/* Verbatim. Never truncated with an ellipsis mid-sentence, never
              re-wrapped by a model. */}
          <View
            style={{
              padding: theme.spacing.md,
              borderRadius: theme.radii.md,
              backgroundColor: theme.colors.bg.subtle,
            }}
          >
            <Text variant="bodySmall" style={{ writingDirection: 'auto' }}>
              {clause.sourceText}
            </Text>
          </View>
        </View>

        <View style={{ gap: theme.spacing.sm }}>
          {source?.documentTitle ? (
            <SourceRow
              label={t('warrantyIntel.sourceDocument')}
              value={source.documentTitle}
            />
          ) : null}
          {location ? (
            <SourceRow label={t('warrantyIntel.sourceSection')} value={location} />
          ) : null}
          {source?.documentVersion ? (
            <SourceRow
              label={t('warrantyIntel.policyVersion')}
              value={isolateLtr(source.documentVersion)}
            />
          ) : null}
          {source?.effectiveFrom ? (
            <SourceRow
              label={t('warrantyIntel.effectiveFrom')}
              value={formatDate(source.effectiveFrom, locale, 'medium')}
            />
          ) : null}
          {source?.retrievedAt ? (
            <SourceRow
              label={t('warrantyIntel.sourceRetrieved')}
              value={formatDate(source.retrievedAt.slice(0, 10), locale, 'medium')}
            />
          ) : null}
          {source?.lastVerifiedAt ? (
            <SourceRow
              label={t('warrantyIntel.sourceVerified')}
              value={formatDate(source.lastVerifiedAt.slice(0, 10), locale, 'medium')}
            />
          ) : null}
        </View>

        {clause.summary ? (
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="bodySmall" tone="secondary" style={{ writingDirection: 'auto' }}>
              {clause.summary}
            </Text>
            <Text variant="caption" tone="tertiary">
              {t('warrantyIntel.summaryNote')}
            </Text>
          </View>
        ) : null}

        {source?.sourceUrl ? (
          <Pressable
            accessibilityRole="link"
            onPress={() => {
              track({
                name: 'warranty_source_opened',
                props: { clauseType: clause.clauseType, hasDocument: Boolean(source.documentId) },
              });
              void Linking.openURL(source.sourceUrl as string);
            }}
          >
            <Text variant="bodySmallStrong" tone="accent">
              {t('warrantyIntel.sourceUrl')}
            </Text>
          </Pressable>
        ) : null}

        {!source ? (
          <Text variant="caption" tone="tertiary">
            {t('warrantyIntel.sourceUnavailable')}
          </Text>
        ) : null}
      </ScrollView>
    </BottomSheet>
  );
}

function SourceRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: theme.spacing.lg,
      }}
    >
      <Text variant="caption" tone="tertiary">
        {label}
      </Text>
      <Text
        variant="caption"
        style={{ flex: 1, textAlign: 'right', writingDirection: 'auto' }}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}
