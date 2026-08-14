import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { isolateLtr } from '@/lib/format';
import { track } from '@/lib/analytics';
import { useProduct, useSubscriptionState } from '@/hooks/useProducts';
import { useSessionStore } from '@/state/session';
import {
  confidenceBand,
  needsClarification,
  verdictTone,
  type CoverageAnalysis,
} from '@/domain/coverage';
import type { MatchState, WarrantyClause } from '@/domain/warrantyIntelligence';
import { hasEntitlement } from '@/domain/entitlements';
import { analyzeProblem } from '@/services/warrantyIntelligenceService';
import { useWarrantyIntelligence } from '@/hooks/useWarrantyIntelligence';
import { ClauseSourceSheet } from '@/features/warranty/ClauseSourceSheet';
import { MatchChip } from '@/features/warranty/WarrantyIntelligenceSection';
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
  const { productId, issue } = useLocalSearchParams<{ productId: string; issue?: string }>();
  const id = productId ?? '';

  const product = useProduct(id);
  const intelligence = useWarrantyIntelligence(id);
  const subscription = useSubscriptionState();
  const userId = useSessionStore((s) => s.session?.user.id);

  // Prefilled from the "Something wrong?" card, so the sentence the user already
  // typed is not thrown away by the navigation.
  const [description, setDescription] = useState(issue ?? '');
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [analysis, setAnalysis] = useState<CoverageAnalysis | null>(null);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
  const [paywallVisible, setPaywallVisible] = useState(false);
  /** Answers to a previous round's questions, carried into the next analysis. */
  const [followUpAnswers, setFollowUpAnswers] = useState<Record<string, string>>({});
  const [openClause, setOpenClause] = useState<WarrantyClause | null>(null);

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
      track({
        name: 'coverage_check_started',
        props: {
          hasAttachments: false,
          isFollowUp: Object.keys(followUpAnswers).length > 0,
        },
      });
      return analyzeProblem({
        productId: id,
        issueDescription: description,
        issueCategory: category,
        followUpAnswers,
      });
    },
    onSuccess: (outcome) => {
      if (outcome.status === 'ok') {
        setAnalysis(outcome.analysis);
        setUnavailableReason(null);
        track({
          name: 'coverage_check_completed',
          props: {
            verdict: outcome.analysis.verdict,
            confidenceBand: confidenceBand(outcome.analysis.confidence),
            clauseCount: outcome.analysis.relevantClauses.length,
          },
        });
        if (needsClarification(outcome.analysis)) {
          track({
            name: 'coverage_followup_requested',
            props: { questionCount: outcome.analysis.followUpQuestions.length },
          });
        }
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
            matchState={intelligence.data?.matchState ?? null}
            onStartClaim={() =>
              router.push(
                `/service/${id}?issue=${encodeURIComponent(description)}` +
                  `&verdict=${analysis.verdict}` +
                  (analysis.relevantClauses[0]?.section
                    ? `&clause=${encodeURIComponent(analysis.relevantClauses[0].section)}`
                    : ''),
              )
            }
            onAskAnother={() => {
              setAnalysis(null);
              setDescription('');
              setFollowUpAnswers({});
            }}
            onOpenClause={(clauseId, section, excerpt) =>
              setOpenClause(
                intelligence.data
                  ? (intelligence.data.clauses.covered
                      .concat(intelligence.data.clauses.notCovered)
                      .concat(intelligence.data.clauses.specialConditions)
                      .find((c) => c.id === clauseId) ?? syntheticClause(clauseId, section, excerpt))
                  : syntheticClause(clauseId, section, excerpt),
              )
            }
            onAnswerFollowUp={(questionId, answer) => {
              const next = { ...followUpAnswers, [questionId]: answer };
              setFollowUpAnswers(next);
            }}
            followUpAnswers={followUpAnswers}
            onResubmit={() => analyse.mutate()}
            resubmitting={analyse.isPending}
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

      <ClauseSourceSheet
        clause={openClause}
        source={intelligence.data?.source ?? null}
        onDismiss={() => setOpenClause(null)}
      />

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

/**
 * The result.
 *
 * Where this product either earns trust or loses it, so the order is fixed:
 * verdict, why, the clause it rests on, the exclusion that might still bite,
 * and only then what to do. The clause is tappable — a user told their screen
 * fault is probably covered should be one tap from the sentence that says so.
 */
function CoverageResult({
  analysis,
  matchState,
  followUpAnswers,
  onStartClaim,
  onAskAnother,
  onOpenClause,
  onAnswerFollowUp,
  onResubmit,
  resubmitting,
}: {
  analysis: CoverageAnalysis;
  matchState: MatchState | null;
  followUpAnswers: Record<string, string>;
  onStartClaim: () => void;
  onAskAnother: () => void;
  onOpenClause: (clauseId: string | null, section: string | null, excerpt: string) => void;
  onAnswerFollowUp: (questionId: string, answer: string) => void;
  onResubmit: () => void;
  resubmitting: boolean;
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

  const grounded = analysis.meta?.groundedInDocuments ?? false;
  const clarifying = needsClarification(analysis);
  const answered = analysis.followUpQuestions.every((q) => followUpAnswers[q.id]);

  return (
    <View style={{ gap: theme.spacing.lg }}>
      <View
        style={{
          gap: theme.spacing.sm,
          padding: theme.spacing.lg,
          borderRadius: theme.radii.xl,
          backgroundColor: toneColors.bg,
        }}
      >
        <Text variant="h2" style={{ color: toneColors.fg }}>
          {t(`coverage.verdict.${analysis.verdict}`)}
        </Text>
        {matchState ? <MatchChip state={matchState} /> : null}
        {analysis.summary ? (
          <Text variant="body" tone="primary">
            {analysis.summary}
          </Text>
        ) : null}
        {grounded ? (
          <Text variant="caption" tone="tertiary">
            {t('coverage.basedOn')}
          </Text>
        ) : null}
      </View>

      {/* No document, no assessment. Said plainly rather than dressed up as a
          low-confidence answer. */}
      {!grounded && !clarifying ? (
        <View
          style={{
            gap: theme.spacing.xs,
            padding: theme.spacing.lg,
            borderRadius: theme.radii.xl,
            backgroundColor: theme.colors.bg.surface,
          }}
        >
          <Text variant="bodySmallStrong">{t('coverage.noPolicyTitle')}</Text>
          <Text variant="bodySmall" tone="secondary">
            {t('coverage.noPolicyBody')}
          </Text>
        </View>
      ) : null}

      {analysis.reasoningSummary ? (
        <Section title={t('coverage.whyThis')}>
          <Text variant="bodySmall" tone="secondary">
            {analysis.reasoningSummary}
          </Text>
        </Section>
      ) : null}

      {analysis.relevantClauses.length > 0 ? (
        <Section title={t('coverage.relevantClauses')}>
          <View style={{ gap: theme.spacing.sm }}>
            {analysis.relevantClauses.map((clause, index) => (
              <Pressable
                key={clause.clauseId ?? index}
                accessibilityRole="button"
                accessibilityLabel={`${clause.section ?? ''} ${t('warrantyIntel.viewSource')}`}
                onPress={() => onOpenClause(clause.clauseId, clause.section, clause.excerpt)}
                style={({ pressed }) => ({
                  gap: theme.spacing.xs,
                  padding: theme.spacing.md,
                  borderRadius: theme.radii.md,
                  backgroundColor: pressed
                    ? theme.colors.bg.subtle
                    : theme.colors.bg.surface,
                })}
              >
                {clause.section ? (
                  <Text variant="metadata" tone="tertiary">
                    {isolateLtr(clause.section)}
                  </Text>
                ) : null}
                {/* Verbatim from the warranty document, never paraphrased. */}
                <Text variant="bodySmall" numberOfLines={4}>
                  {clause.excerpt}
                </Text>
                <Text variant="caption" tone="accent">
                  {t('warrantyIntel.viewSource')}
                </Text>
              </Pressable>
            ))}
          </View>
        </Section>
      ) : null}

      {analysis.exclusions.length > 0 ? (
        <Section title={t('coverage.possibleExclusion')}>
          <View style={{ gap: theme.spacing.sm }}>
            {analysis.exclusions.map((exclusion) => (
              <View
                key={exclusion}
                style={{ flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'flex-start' }}
              >
                <Text variant="bodySmall" tone="secondary">
                  ·
                </Text>
                <Text variant="bodySmall" tone="secondary" style={{ flex: 1 }}>
                  {exclusion}
                </Text>
              </View>
            ))}
          </View>
        </Section>
      ) : null}

      {analysis.missingInformation.length > 0 ? (
        <Section title={t('coverage.missingInformation')}>
          <View style={{ gap: theme.spacing.xs }}>
            {analysis.missingInformation.map((item) => (
              <Text key={item} variant="bodySmall" tone="secondary">
                · {item}
              </Text>
            ))}
          </View>
        </Section>
      ) : null}

      {/* Asking beats guessing. The original description is retained, so the next
          analysis reasons about the whole problem rather than only the answer. */}
      {clarifying ? (
        <View
          style={{
            gap: theme.spacing.md,
            padding: theme.spacing.lg,
            borderRadius: theme.radii.xl,
            backgroundColor: theme.colors.intelligence.bg,
          }}
        >
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="h3" style={{ color: theme.colors.intelligence.fg }}>
              {t('coverage.followUpTitle')}
            </Text>
            <Text variant="caption" style={{ color: theme.colors.intelligence.fg }}>
              {t('coverage.followUpBody')}
            </Text>
          </View>

          {analysis.followUpQuestions.map((question) => (
            <View key={question.id} style={{ gap: theme.spacing.sm }}>
              <Text variant="bodySmall">{question.question}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                {question.options.map((option) => {
                  const selected = followUpAnswers[question.id] === option;
                  return (
                    <Pressable
                      key={option}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => onAnswerFollowUp(question.id, option)}
                      style={{
                        paddingHorizontal: theme.spacing.md,
                        paddingVertical: theme.spacing.sm,
                        borderRadius: theme.radii.pill,
                        borderWidth: theme.borderWidth.thin,
                        borderColor: selected
                          ? theme.colors.intelligence.fg
                          : theme.colors.intelligence.border,
                        backgroundColor: selected
                          ? theme.colors.bg.surface
                          : 'transparent',
                      }}
                    >
                      <Text variant="caption">{option}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}

          <Button
            label={t('coverage.followUpSubmit')}
            fullWidth
            disabled={!answered}
            loading={resubmitting}
            onPress={onResubmit}
          />
        </View>
      ) : null}

      {analysis.attachmentCount > 0 && !analysis.attachmentsAnalysed ? (
        // Honest about what was and was not done. Implying the model looked at a
        // photo it never received would be the cheapest lie in the app to tell.
        <Text variant="caption" tone="tertiary">
          {t('coverage.attachmentsStored')}
        </Text>
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

      <View style={{ gap: theme.spacing.sm }}>
        <Button label={t('coverage.getService')} fullWidth onPress={onStartClaim} />
        <Button
          label={t('coverage.askAnother')}
          variant="secondary"
          fullWidth
          onPress={onAskAnother}
        />
      </View>
    </View>
  );
}

/**
 * A clause cited by an analysis that is not in the policy's own clause list —
 * for example when the policy changed between the analysis and now. Carries the
 * verbatim excerpt so "view source" still shows real wording rather than nothing.
 */
function syntheticClause(
  clauseId: string | null,
  section: string | null,
  excerpt: string,
): WarrantyClause {
  return {
    id: clauseId ?? 'cited',
    clauseType: 'other',
    title: null,
    summary: null,
    sourceText: excerpt,
    section,
    sourceSection: section,
    sourcePage: null,
    coverageCategories: [],
    confidence: 'low',
    verification: 'unverified',
  };
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
