import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { useProductQuota, useSubscriptionState } from '@/hooks/useProducts';
import { useDraftStore, type AddMethod } from '@/state/draftProduct';
import { PaywallSheet } from '@/features/paywall/PaywallSheet';
import {
  BarcodeIcon,
  CameraIcon,
  ChevronIcon,
  CloseIcon,
  DocumentIcon,
  PencilIcon,
  Screen,
  Text,
} from '@/ui';

/**
 * Add product — method chooser.
 *
 * The quota is checked *here*, before the user types anything, so the paywall
 * appears at the moment they ask to add rather than after they have filled in a form.
 * If they somehow get past this (a stale quota, a race), the insert is still rejected
 * server-side and the draft is preserved — see the create mutation's error handling.
 */
export default function AddMethodScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const quota = useProductQuota();
  const subscription = useSubscriptionState();
  const setMethod = useDraftStore((s) => s.setMethod);
  const [paywallVisible, setPaywallVisible] = useState(false);

  const start = (method: AddMethod, href: string) => {
    if (!quota.check.allowed) {
      setPaywallVisible(true);
      return;
    }
    setMethod(method);
    router.push(href);
  };

  const methods = [
    {
      method: 'receipt' as const,
      href: '/add/scan',
      icon: <CameraIcon color={theme.colors.text.primary} />,
      title: t('add.methodScan'),
      body: t('add.methodScanBody'),
      requiresPlan: !quota.entitlements.smart_scan,
    },
    {
      method: 'barcode' as const,
      href: '/add/barcode',
      icon: <BarcodeIcon color={theme.colors.text.primary} />,
      title: t('add.methodBarcode'),
      body: t('add.methodBarcodeBody'),
      requiresPlan: !quota.entitlements.smart_scan,
    },
    {
      method: 'photo' as const,
      href: '/add/manual?withPhoto=1',
      icon: <DocumentIcon color={theme.colors.text.primary} />,
      title: t('add.methodPhoto'),
      body: t('add.methodPhotoBody'),
      requiresPlan: false,
    },
    {
      method: 'manual' as const,
      href: '/add/manual',
      icon: <PencilIcon color={theme.colors.text.primary} />,
      title: t('add.methodManual'),
      body: t('add.methodManualBody'),
      requiresPlan: false,
    },
  ];

  return (
    <Screen scroll>
      <View
        style={{ height: 44, justifyContent: 'center', alignItems: 'flex-end' }}
      >
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
            {t('add.title')}
          </Text>
          <Text variant="body" tone="secondary">
            {t('add.subtitle')}
          </Text>
        </View>

        <View style={{ gap: theme.spacing.md }}>
          {methods.map((option) => (
            <Pressable
              key={option.method}
              accessibilityRole="button"
              accessibilityLabel={`${option.title}. ${option.body}`}
              onPress={() => start(option.method, option.href)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.md,
                padding: theme.spacing.lg,
                borderRadius: theme.radii.lg,
                borderWidth: theme.borderWidth.hairline,
                borderColor: theme.colors.border.subtle,
                backgroundColor: pressed
                  ? theme.colors.bg.subtle
                  : theme.colors.bg.surface,
              })}
            >
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: theme.radii.md,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: theme.colors.bg.subtle,
                }}
              >
                {option.icon}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                  }}
                >
                  <Text variant="bodyStrong">{option.title}</Text>
                  {option.requiresPlan ? (
                    <View
                      style={{
                        backgroundColor: theme.colors.accent.soft,
                        paddingHorizontal: theme.spacing.sm,
                        paddingVertical: 1,
                        borderRadius: theme.radii.pill,
                      }}
                    >
                      <Text variant="metadata" style={{ color: theme.colors.accent.text }}>
                        {t('paywall.planPlus')}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text variant="bodySmall" tone="tertiary">
                  {option.body}
                </Text>
              </View>
              <ChevronIcon color={theme.colors.text.tertiary} />
            </Pressable>
          ))}
        </View>
      </View>

      <PaywallSheet
        visible={paywallVisible}
        onDismiss={() => setPaywallVisible(false)}
        trigger="product_limit"
        limit={quota.entitlements.product_limit ?? 3}
        offerings={[]}
        currentPlan={subscription.data?.plan ?? 'free'}
        purchasing={false}
        onPurchase={() => undefined}
        onRestore={() => undefined}
      />
    </Screen>
  );
}
