import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { track } from '@/lib/analytics';
import { useProduct, useSubscriptionState } from '@/hooks/useProducts';
import { useSessionStore } from '@/state/session';
import { confidenceBand, verdictTone, type CoverageAnalysis } from '@/domain/coverage';
import { hasEntitlement } from '@/domain/entitlements';
import { analyseCoverage } from '@/services/aiCoverageService';
import { createClaim, ISSUE_CATEGORIES } from '@/services/claimService';
import { PaywallSheet } from '@/features/paywall/PaywallSheet';
import {
  Button,
  Card,
  CloseIcon,
  Input,
  Screen,
  Text,
  useToast,
} from '@/ui';

/**
 * Report a problem → coverage assessment.
 *
 * The result screen is where this product either earns trust or loses it, so the
 * rules are strict:
 *
 * — The verdict is never "covered", only "likely covered". We are not the warranty
 *   provider and cannot commit anyone to paying a claim.
 * — Every assessment shows the clauses it rests on, verbatim, so the user can read
 *   the actual wording rather than take our summary on faith.
 * — The disclaimer is always visible, not folded behind a tap.
 * — If the model's answer fails validation, or there is no warranty documentation to
 *   ground it, we say so plainly instead of showing a confident guess.
 */
export default function CoverageScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const toast = useToast();
  const { productId } = useLocalSearchParams<{ productId: string }>();
  const id = productId ?? '';

  const product = useProduct(id);
  const subscription = useSubscriptionState();
  const userId = useSessionStore((s) => s.session?.user.id);

  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [analysis, setAnalysis] = useState<CoverageAnalysis | null>(null);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
  const [paywallVisible, setPaywallVisible] = useState(false);

  const entitled = subscription.data
    ? hasEntitlement(subscription.data.entitlements, 'ai_coverage')
    : false;

  const analyse = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('not signed in');
      // The user's account of the problem is recorded first, so it survives even if
      // the analysis fails or they close the app mid-check.
      await createClaim({
        productId: id,
        ownerId: userId,
        issueDescription: description,
        issueCategory: category as (typeof ISSUE_CATEGORIES)[number] | undefined,
      });
      track({ name: 'problem_reported', props: { category: category ?? 'other' } });
      return analyseCoverage({ productId: id, issueDescription: description, issueCategory: category });
    },
    onSuccess: (outcome) => {
      if (outcome.status === 'ok') {
        setAnalysis(outcome.analysis);
        setUnavailableReason(null);
        track({
          name: 'coverage_analysis_completed',
          props: {
            verdict: outcome.analysis.verdict,
            confidenceBand: confidenceBand(outcome.analysis.confidence),
          },
        });
        return;
      }
      if (outcome.status === 'unavailable') {
        if (outcome.reason === 'not_entitled') {
          setPaywallVisible(true);
          return;
        }
        setUnavailableReason(
          outcome.reason === 'no_warranty_data'
            ? t('coverage.unavailableNoData')
            : t('errors.rate_limited'),
        );
        return;
      }
      setUnavailableReason(t('coverage.failed'));
    },
    onError: () => toast.show(t('coverage.failed'), 'error'),
  });

  return (
    <Screen scroll>
      <View style={{ height: 44, justifyContent: 'center', alignItems: 'flex-end' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('a11y.close')}
          onPress={() => router.back()}
          hitSlop={12}
        >
          <CloseIcon color={theme.colors.text.primary} />
        </Pressable>
      </View>

      <View style={{ gap: theme.spacing.xl, marginTop: theme.spacing.sm }}>
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="h1" accessibilityRole="header">
            {t('coverage.describeTitle')}
          </Text>
          {product.data ? (
            <Text variant="bodySmall" tone="secondary">
              {product.data.name}
            </Text>
          ) : null}
        </View>

        {analysis ? (
          <CoverageResult
            analysis={analysis}
            onStartClaim={() => router.push(`/claim/${id}`)}
          />
        ) : (
          <>
            <Input
              label={t('coverage.describeTitle')}
              hint={t('coverage.describeBody')}
              placeholder={t('coverage.describePlaceholder')}
              value={description}
              onChangeText={setDescription}
              multiline
              required
            />

            <View style={{ gap: theme.spacing.sm }}>
              <Text variant="bodySmallStrong" tone="secondary">
                {t('coverage.categoryLabel')}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                {ISSUE_CATEGORIES.map((option) => {
                  const selected = category === option;
                  return (
                    <Pressable
                      key={option}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => setCategory(selected ? undefined : option)}
                      style={{
                        paddingHorizontal: theme.spacing.md,
                        paddingVertical: theme.spacing.sm,
                        borderRadius: theme.radii.pill,
                        borderWidth: theme.borderWidth.thin,
                        borderColor: selected
                          ? theme.colors.accent.solid
                          : theme.colors.border.subtle,
                        backgroundColor: selected ? theme.colors.accent.soft : 'transparent',
                      }}
                    >
                      <Text variant="caption" tone={selected ? 'accent' : 'secondary'}>
                        {option.replace(/_/g, ' ')}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {unavailableReason ? (
              <Card variant="subtle">
                <Text variant="bodySmall" tone="secondary">
                  {unavailableReason}
                </Text>
              </Card>
            ) : null}

            <Button
              label={entitled ? t('coverage.analyse') : t('paywall.upgrade')}
              fullWidth
              loading={analyse.isPending}
              disabled={description.trim().length < 10}
              onPress={() => {
                if (!entitled) {
                  setPaywallVisible(true);
                  return;
                }
                analyse.mutate();
              }}
            />
          </>
        )}
      </View>

      <PaywallSheet
        visible={paywallVisible}
        onDismiss={() => setPaywallVisible(false)}
        trigger="ai_coverage"
        offerings={[]}
        currentPlan={subscription.data?.plan ?? 'free'}
        purchasing={false}
        onPurchase={() => undefined}
        onRestore={() => undefined}
      />
    </Screen>
  );
}

function CoverageResult({
  analysis,
  onStartClaim,
}: {
  analysis: CoverageAnalysis;
  onStartClaim: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();

  const tone = verdictTone(analysis.verdict);
  const toneColors = {
    success: { fg: theme.colors.feedback.successFg, bg: theme.colors.feedback.successBg },
    warning: { fg: theme.colors.feedback.warningFg, bg: theme.colors.feedback.warningBg },
    danger: { fg: theme.colors.feedback.dangerFg, bg: theme.colors.feedback.dangerBg },
    info: { fg: theme.colors.feedback.infoFg, bg: theme.colors.feedback.infoBg },
  }[tone];

  return (
    <View style={{ gap: theme.spacing.lg }}>
      <Card style={{ backgroundColor: toneColors.bg, borderWidth: 0 }}>
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="metadata" style={{ color: toneColors.fg }}>
            {t('coverage.title')}
          </Text>
          <Text variant="h2" style={{ color: toneColors.fg }}>
            {t(`coverage.verdict.${analysis.verdict}`)}
          </Text>
          <Text variant="body" tone="primary">
            {analysis.summary}
          </Text>
          <Text variant="caption" tone="tertiary">
            {t(`warranty.confidence.${confidenceBand(analysis.confidence)}`)}
          </Text>
        </View>
      </Card>

      {analysis.reasoningSummary ? (
        <Section title={t('coverage.whyThis')}>
          <Text variant="bodySmall" tone="secondary">
            {analysis.reasoningSummary}
          </Text>
        </Section>
      ) : null}

      {analysis.relevantClauses.length > 0 ? (
        <Section title={t('coverage.relevantClauses')}>
          <View style={{ gap: theme.spacing.md }}>
            {analysis.relevantClauses.map((clause, index) => (
              <Card key={clause.clauseId ?? index} variant="subtle">
                <View style={{ gap: theme.spacing.xs }}>
                  {clause.section ? (
                    <Text variant="metadata" tone="tertiary">
                      {clause.section}
                    </Text>
                  ) : null}
                  {/* Verbatim from the warranty document, never paraphrased. */}
                  <Text variant="bodySmall">{clause.excerpt}</Text>
                </View>
              </Card>
            ))}
          </View>
        </Section>
      ) : null}

      {analysis.exclusions.length > 0 ? (
        <Section title={t('coverage.exclusionsHeading')}>
          <View style={{ gap: theme.spacing.sm }}>
            {analysis.exclusions.map((exclusion) => (
              <Text key={exclusion} variant="bodySmall" tone="secondary">
                • {exclusion}
              </Text>
            ))}
          </View>
        </Section>
      ) : null}

      {analysis.recommendedAction ? (
        <Section title={t('coverage.nextStep')}>
          <Text variant="bodySmall" tone="secondary">
            {analysis.recommendedAction}
          </Text>
        </Section>
      ) : null}

      {/* Always visible. Never behind a disclosure. */}
      <Text variant="caption" tone="tertiary">
        {t('coverage.disclaimer')}
      </Text>

      <Button label={t('coverage.startClaim')} fullWidth onPress={onStartClaim} />
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Text variant="metadata" tone="tertiary" accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}
