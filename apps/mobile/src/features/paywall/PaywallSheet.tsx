import React from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { config } from '@/lib/config';
import { track } from '@/lib/analytics';
import type { PlanId } from '@/domain/entitlements';
import type { Offering } from '@/services/subscriptionService';
import { BottomSheet, Button, Card, CheckIcon, Text } from '@/ui';

/**
 * Paywall.
 *
 * Three deliberate choices here.
 *
 * — Prices come from `offerings`, which come from StoreKit / Play Billing. There is
 *   no price string in this file. A hard-coded "$5/month" is wrong in most countries
 *   and both stores reject it.
 * — No countdown, no "only today", no fake scarcity. The reason to upgrade is that
 *   the user has more than three products, and that reason is stated plainly.
 * — When it opens because a limit was reached, it says so and promises the draft is
 *   safe, because the user's half-finished product is the thing they are worried
 *   about at that moment.
 */

export type PaywallTrigger = 'product_limit' | 'ai_coverage' | 'smart_scan' | 'profile';

export type PaywallSheetProps = {
  visible: boolean;
  onDismiss: () => void;
  trigger: PaywallTrigger;
  offerings: Offering[];
  currentPlan: PlanId;
  purchasing: boolean;
  limit?: number;
  onPurchase: (offering: Offering) => void;
  onRestore: () => void;
};

export function PaywallSheet({
  visible,
  onDismiss,
  trigger,
  offerings,
  currentPlan,
  purchasing,
  limit,
  onPurchase,
  onRestore,
}: PaywallSheetProps) {
  const theme = useTheme();
  const { t } = useTranslation();

  React.useEffect(() => {
    if (visible) track({ name: 'paywall_viewed', props: { trigger } });
  }, [visible, trigger]);

  const headline =
    trigger === 'product_limit'
      ? t('paywall.limitReached', { limit: limit ?? 3 })
      : trigger === 'ai_coverage'
        ? t('paywall.aiCoverage')
        : trigger === 'smart_scan'
          ? t('paywall.smartScan')
          : t('paywall.title');

  const monthlyOfferings = offerings.filter((o) => o.period === 'monthly');

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss}>
      <View style={{ gap: theme.spacing.lg, paddingBottom: theme.spacing.md }}>
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="h2" accessibilityRole="header">
            {headline}
          </Text>
          {trigger === 'product_limit' ? (
            <>
              <Text variant="body" tone="secondary">
                {t('paywall.limitReachedBody')}
              </Text>
              <Text variant="bodySmall" tone="tertiary">
                {t('paywall.draftKept')}
              </Text>
            </>
          ) : null}
        </View>

        <View style={{ gap: theme.spacing.md }}>
          {monthlyOfferings.map((offering) => (
            <PlanOption
              key={offering.productId}
              offering={offering}
              recommended={offering.plan === 'plus'}
              isCurrent={offering.plan === currentPlan}
              disabled={purchasing}
              onPress={() => onPurchase(offering)}
            />
          ))}

          {monthlyOfferings.length === 0 ? (
            // The store hasn't returned products yet (or is unreachable). Say so
            // rather than showing an empty box or, worse, invented prices.
            <Card variant="subtle">
              <Text variant="bodySmall" tone="secondary">
                {t('errors.network')}
              </Text>
            </Card>
          ) : null}
        </View>

        {/* Required by both stores: renewal terms, restore, and reachable legal links. */}
        <Text variant="caption" tone="tertiary">
          {t('paywall.renewalNote')}
        </Text>

        <View style={{ gap: theme.spacing.sm }}>
          <Button
            label={t('paywall.restore')}
            variant="ghost"
            size="sm"
            onPress={onRestore}
            disabled={purchasing}
          />
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'center',
              gap: theme.spacing.lg,
            }}
          >
            <LegalLink label={t('profile.terms')} url={config.termsUrl} />
            <LegalLink label={t('profile.privacy')} url={config.privacyPolicyUrl} />
          </View>
        </View>

        <Button label={t('paywall.notNow')} variant="ghost" onPress={onDismiss} />
      </View>
    </BottomSheet>
  );
}

function PlanOption({
  offering,
  recommended,
  isCurrent,
  disabled,
  onPress,
}: {
  offering: Offering;
  recommended: boolean;
  isCurrent: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();

  const planLabel = t(`paywall.plan${capitalise(offering.plan)}`);
  const features = t(`paywall.${offering.plan}Features`);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || isCurrent, selected: recommended }}
      accessibilityLabel={`${planLabel}, ${offering.displayPrice}. ${features}`}
      disabled={disabled || isCurrent}
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: theme.radii.lg,
        borderWidth: recommended ? theme.borderWidth.thick : theme.borderWidth.thin,
        borderColor: recommended ? theme.colors.accent.solid : theme.colors.border.subtle,
        backgroundColor: pressed ? theme.colors.bg.subtle : theme.colors.bg.surface,
        padding: theme.spacing.lg,
        gap: theme.spacing.sm,
        opacity: isCurrent ? 0.6 : 1,
      })}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: theme.spacing.sm,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <Text variant="h3">{planLabel}</Text>
          {recommended && !isCurrent ? (
            <View
              style={{
                backgroundColor: theme.colors.accent.soft,
                paddingHorizontal: theme.spacing.sm,
                paddingVertical: 2,
                borderRadius: theme.radii.pill,
              }}
            >
              <Text variant="metadata" style={{ color: theme.colors.accent.text }}>
                {t('paywall.recommended')}
              </Text>
            </View>
          ) : null}
          {isCurrent ? (
            <Text variant="metadata" tone="tertiary">
              {t('paywall.currentPlan')}
            </Text>
          ) : null}
        </View>

        {/* Store-provided, already localised and in the right currency. */}
        <Text variant="bodyStrong">{offering.displayPrice}</Text>
      </View>

      <View style={{ flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'flex-start' }}>
        <CheckIcon size={16} color={theme.colors.feedback.successFg} />
        <Text variant="bodySmall" tone="secondary" style={{ flex: 1 }}>
          {features}
        </Text>
      </View>

      {offering.introOffer ? (
        <Text variant="caption" tone="tertiary">
          {offering.introOffer.displayPrice}
        </Text>
      ) : null}
    </Pressable>
  );
}

function LegalLink({ label, url }: { label: string; url: string }) {
  return (
    <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(url)} hitSlop={8}>
      <Text variant="caption" tone="accent">
        {label}
      </Text>
    </Pressable>
  );
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
