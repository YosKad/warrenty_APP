import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { isLowConfidence } from '@/services/ocrService';
import { draftFromSuggestions, useDraftStore } from '@/state/draftProduct';
import type { ProductSuggestions } from '@/domain/product';
import { Button, Card, Screen, Skeleton, Text } from '@/ui';

/**
 * Receipt processing and review.
 *
 * The screen exists to make one thing unmissable: these values were read by a
 * machine, and the user should look before saving. Every extracted field is listed
 * with what we read, and anything low-confidence is called out.
 *
 * Nothing here writes to a product. Confirming carries the values into the manual
 * form, where they can all still be edited — extraction proposes, the user decides.
 */
export default function ReceiptReviewScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ localUri?: string }>();

  const setSuggestions = useDraftStore((s) => s.setSuggestions);
  const setDraft = useDraftStore((s) => s.setDraft);

  const [processing, setProcessing] = useState(true);
  const [suggestions] = useState<ProductSuggestions>({});

  useEffect(() => {
    // Upload + extraction happen server-side; the document is created against the
    // product only once the user saves, so an abandoned scan leaves nothing behind.
    // Until the pipeline is wired to a live project this resolves to an empty result,
    // which the UI handles as "we couldn't read that one".
    const timer = setTimeout(() => setProcessing(false), 900);
    return () => clearTimeout(timer);
  }, [params.localUri]);

  const entries = Object.entries(suggestions) as [
    keyof ProductSuggestions,
    { value: string | number; confidence: number },
  ][];

  const proceed = () => {
    setSuggestions(suggestions);
    setDraft(draftFromSuggestions(suggestions));
    router.replace('/add/manual');
  };

  if (processing) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center', gap: theme.spacing.lg }}>
          <Text variant="h2" align="center">
            {t('scan.processing')}
          </Text>
          <Text variant="bodySmall" tone="secondary" align="center">
            {t('scan.processingBody')}
          </Text>
          <View style={{ gap: theme.spacing.md, marginTop: theme.spacing.lg }}>
            <Skeleton height={20} />
            <Skeleton height={20} width="80%" />
            <Skeleton height={20} width="60%" />
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <View style={{ gap: theme.spacing.xl, paddingTop: theme.spacing.xl }}>
        {entries.length === 0 ? (
          <View style={{ gap: theme.spacing.md }}>
            <Text variant="h1">{t('scan.noResults')}</Text>
            <Text variant="body" tone="secondary">
              {t('scan.noResultsBody')}
            </Text>
          </View>
        ) : (
          <>
            <View style={{ gap: theme.spacing.xs }}>
              <Text variant="h1">{t('scan.foundCount', { count: entries.length })}</Text>
              <Text variant="body" tone="secondary">
                {t('scan.reviewBody')}
              </Text>
            </View>

            <View style={{ gap: theme.spacing.md }}>
              {entries.map(([field, suggestion]) => (
                <Card key={String(field)} variant="subtle">
                  <View style={{ gap: 2 }}>
                    <Text variant="metadata" tone="tertiary">
                      {t(`add.form.${String(field)}`, { defaultValue: String(field) })}
                    </Text>
                    <Text variant="bodyStrong">{String(suggestion.value)}</Text>
                    {isLowConfidence(suggestion.confidence) ? (
                      <Text
                        variant="caption"
                        style={{ color: theme.colors.status.endingFg }}
                      >
                        {t('scan.checkThis')}
                      </Text>
                    ) : null}
                  </View>
                </Card>
              ))}
            </View>
          </>
        )}

        <Button label={t('common.continue')} fullWidth onPress={proceed} />
      </View>
    </Screen>
  );
}
