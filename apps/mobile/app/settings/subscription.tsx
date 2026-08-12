import { useState } from 'react';
import { Linking, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { queryKeys } from '@/lib/queryClient';
import { formatDate } from '@/lib/format';
import { track } from '@/lib/analytics';
import { useLocale } from '@/hooks/useLocale';
import { useProductQuota, useSubscriptionState } from '@/hooks/useProducts';
import { isOverLimit } from '@/domain/entitlements';
import {
  getManageSubscriptionUrl,
  restorePurchases,
} from '@/services/subscriptionService';
import { PaywallSheet } from '@/features/paywall/PaywallSheet';
import { SettingsScreen } from '@/features/settings/SettingsScreen';
import { Button, Card, ListGroup, ListRow, Text, useToast } from '@/ui';

/**
 * Subscription management.
 *
 * Cancellation and plan changes deep-link to the platform's own UI, because both
 * stores require it. What we own is the honest explanation of the current state —
 * including the downgrade case, where the user keeps everything they saved and is
 * only prevented from adding more.
 */
export default function SubscriptionScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();

  const subscription = useSubscriptionState();
  const quota = useProductQuota();
  const [paywallVisible, setPaywallVisible] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const plan = subscription.data?.plan ?? 'free';
  const planLabel = t(`paywall.plan${plan.charAt(0).toUpperCase()}${plan.slice(1)}`);
  const overLimit = isOverLimit(quota.entitlements, quota.current);

  const onRestore = async () => {
    setRestoring(true);
    try {
      // With no live store transactions to replay, this re-reads the server's record,
      // which is where entitlement actually lives.
      await restorePurchases([]);
      await queryClient.invalidateQueries({ queryKey: queryKeys.entitlement });
      track({ name: 'purchases_restored', props: { found: 0 } });
      toast.show(t('common.done'));
    } catch {
      toast.show(t('errors.unknown'), 'error');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <SettingsScreen title={t('subscription.title')}>
      <Card>
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="metadata" tone="tertiary">
            {t('paywall.currentPlan')}
          </Text>
          <Text variant="h2">MY Warranty {planLabel}</Text>
          {subscription.data?.expiresAt ? (
            <Text variant="bodySmall" tone="secondary">
              {t(
                subscription.data.autoRenew
                  ? 'subscription.renewsOn'
                  : 'subscription.expiresOn',
                { date: formatDate(subscription.data.expiresAt.slice(0, 10), locale, 'long') },
              )}
            </Text>
          ) : null}
        </View>
      </Card>

      {overLimit ? (
        <Card variant="subtle">
          <Text variant="bodySmall" tone="secondary">
            {t('subscription.downgradeNote', { count: quota.current })}
          </Text>
        </Card>
      ) : null}

      <ListGroup>
        <ListRow
          label={t('subscription.changePlan')}
          onPress={() => setPaywallVisible(true)}
        />
        <ListRow
          label={t('paywall.manage')}
          onPress={() => void Linking.openURL(getManageSubscriptionUrl())}
        />
      </ListGroup>

      <Button
        label={t('paywall.restore')}
        variant="secondary"
        fullWidth
        loading={restoring}
        onPress={() => void onRestore()}
      />

      <Text variant="caption" tone="tertiary">
        {t('paywall.renewalNote')}
      </Text>

      <PaywallSheet
        visible={paywallVisible}
        onDismiss={() => setPaywallVisible(false)}
        trigger="profile"
        offerings={[]}
        currentPlan={plan}
        purchasing={false}
        onPurchase={() => undefined}
        onRestore={() => void onRestore()}
      />
    </SettingsScreen>
  );
}
