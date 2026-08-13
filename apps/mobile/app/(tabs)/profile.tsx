import { Alert, Linking, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { config } from '@/lib/config';
import { formatDate } from '@/lib/format';
import { useLocale } from '@/hooks/useLocale';
import { useSubscriptionState } from '@/hooks/useProducts';
import { signOut } from '@/services/authService';
import { useSessionStore } from '@/state/session';
import { ListGroup, ListRow, Screen, Text } from '@/ui';

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
        {/* Identity first, and a real avatar rather than a name in a heading slot.
            The monogram is derived from the display name, so an account with no
            photo still looks like an account rather than a blank. */}
        <View
          style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.lg }}
        >
          <View
            accessibilityElementsHidden
            style={{
              width: 60,
              height: 60,
              borderRadius: 30,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.colors.accent.soft,
            }}
          >
            <Text variant="h2" style={{ color: theme.colors.accent.text }}>
              {monogram(profile?.displayName ?? profile?.email ?? '')}
            </Text>
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text
              variant="h2"
              accessibilityRole="header"
              numberOfLines={1}
              style={{ writingDirection: 'auto' }}
            >
              {profile?.displayName ?? t('profile.title')}
            </Text>
            <Text variant="bodySmall" tone="tertiary" numberOfLines={1}>
              {profile?.email}
            </Text>
          </View>
        </View>

        {/* The plan panel is the one branded surface on this screen. It is also the
            only route to the paywall from here — pricing is never duplicated. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('subscription.title')}, ${planLabel}`}
          onPress={() => router.push('/settings/subscription')}
          style={({ pressed }) => ({
            gap: theme.spacing.xs,
            padding: theme.spacing.xl,
            borderRadius: theme.radii.xxl,
            backgroundColor: theme.colors.bg.brand,
            opacity: pressed ? 0.92 : 1,
          })}
        >
          <Text variant="metadata" tone="onBrand" style={{ opacity: 0.6 }}>
            {t('subscription.title').toUpperCase()}
          </Text>
          <Text variant="h2" tone="onBrand">
            MY Warranty {planLabel}
          </Text>
          {subscription.data?.expiresAt ? (
            <Text variant="bodySmall" tone="onBrand" style={{ opacity: 0.7 }}>
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
            <Text
              variant="bodySmall"
              style={{ color: theme.colors.protection.endingFg, marginTop: 2 }}
            >
              {t('subscription.gracePeriod')}
            </Text>
          ) : null}
        </Pressable>

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

/**
 * Up to two initials from a display name, falling back to the first letter of an
 * email. Works for Hebrew names as well — it takes graphemes, not ASCII.
 */
function monogram(source: string): string {
  const words = source.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return [...(words[0] ?? '')].slice(0, 1).join('').toUpperCase();
  return words
    .slice(0, 2)
    .map((word) => [...word][0] ?? '')
    .join('')
    .toUpperCase();
}
