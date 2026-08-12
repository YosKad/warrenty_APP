import { Alert, Linking, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { config } from '@/lib/config';
import { formatDate } from '@/lib/format';
import { useLocale } from '@/hooks/useLocale';
import { useSubscriptionState } from '@/hooks/useProducts';
import { signOut } from '@/services/authService';
import { useSessionStore } from '@/state/session';
import {
  Card,
  ListGroup,
  ListRow,
  Screen,
  Text,
} from '@/ui';

/**
 * Profile.
 *
 * Settings, subscription and legal live here rather than as top-level tabs, so
 * navigation stays about the product rather than about the app's own machinery.
 *
 * Account deletion is present, reachable in two taps, and never hidden behind a
 * support email — both stores require it and it is the right thing to do.
 */
export default function ProfileScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const { locale } = useLocale();
  const profile = useSessionStore((s) => s.profile);
  const subscription = useSubscriptionState();

  const handleSignOut = () => {
    Alert.alert(t('auth.signOut'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('auth.signOut'),
        style: 'destructive',
        onPress: () => {
          void signOut('local').then(() => router.replace('/(auth)/welcome'));
        },
      },
    ]);
  };

  const planLabel = t(
    `paywall.plan${(subscription.data?.plan ?? 'free').charAt(0).toUpperCase()}${(subscription.data?.plan ?? 'free').slice(1)}`,
  );

  return (
    <Screen scroll>
      <View style={{ gap: theme.spacing.xl, paddingTop: theme.spacing.md }}>
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="h1" accessibilityRole="header">
            {profile?.displayName ?? t('profile.title')}
          </Text>
          <Text variant="bodySmall" tone="secondary">
            {profile?.email}
          </Text>
        </View>

        <Card
          onPress={() => router.push('/settings/subscription')}
          accessibilityLabel={`${t('subscription.title')}, ${planLabel}`}
        >
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="metadata" tone="tertiary">
              {t('subscription.title')}
            </Text>
            <Text variant="h3">MY Warranty {planLabel}</Text>
            {subscription.data?.expiresAt ? (
              <Text variant="bodySmall" tone="secondary">
                {t(
                  subscription.data.autoRenew
                    ? 'subscription.renewsOn'
                    : 'subscription.expiresOn',
                  {
                    date: formatDate(
                      subscription.data.expiresAt.slice(0, 10),
                      locale,
                      'long',
                    ),
                  },
                )}
              </Text>
            ) : null}
            {subscription.data?.status === 'in_grace_period' ||
            subscription.data?.status === 'in_billing_retry' ? (
              <Text variant="bodySmall" style={{ color: theme.colors.feedback.warningFg }}>
                {t('subscription.gracePeriod')}
              </Text>
            ) : null}
          </View>
        </Card>

        <ListGroup title={t('profile.preferences')}>
          <ListRow
            label={t('profile.notifications')}
            onPress={() => router.push('/settings/notifications')}
          />
          <ListRow
            label={t('profile.appearance')}
            onPress={() => router.push('/settings/appearance')}
          />
          <ListRow
            label={t('profile.language')}
            value={profile?.preferredLanguage === 'he' ? 'עברית' : 'English'}
            onPress={() => router.push('/settings/language')}
          />
          <ListRow
            label={t('profile.country')}
            value={profile?.countryCode}
            onPress={() => router.push('/settings/region')}
          />
        </ListGroup>

        <ListGroup title={t('profile.account')}>
          <ListRow
            label={t('profile.exportData')}
            description={t('profile.exportDataBody')}
            onPress={() => router.push('/settings/export')}
          />
          <ListRow label={t('auth.signOut')} onPress={handleSignOut} />
          <ListRow
            label={t('profile.deleteAccount')}
            destructive
            onPress={() => router.push('/settings/delete-account')}
          />
        </ListGroup>

        <ListGroup title={t('profile.legal')}>
          <ListRow
            label={t('profile.privacy')}
            onPress={() => void Linking.openURL(config.privacyPolicyUrl)}
          />
          <ListRow
            label={t('profile.terms')}
            onPress={() => void Linking.openURL(config.termsUrl)}
          />
          <ListRow
            label={t('profile.support')}
            onPress={() => void Linking.openURL(config.supportUrl)}
          />
        </ListGroup>

        <Text variant="caption" tone="tertiary" align="center">
          {t('app.name')} · {config.appEnv}
        </Text>
      </View>
    </Screen>
  );
}
