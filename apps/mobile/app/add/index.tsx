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
      // Sits on the pine circle in the hero, not on a surface like the others.
      icon: <CameraIcon color={theme.colors.control.primaryFg} />,
      title: t('add.methodScan'),
      body: t('add.methodScanBody'),
      requiresPlan: !quota.entitlements.smart_scan,
    },
    {
      method: 'barcode' as const,
      href: '/add/barcode',
      icon: <BarcodeIcon color={theme.colors.text.secondary} />,
      title: t('add.methodBarcode'),
      body: t('add.methodBarcodeBody'),
      requiresPlan: !quota.entitlements.smart_scan,
    },
    {
      method: 'photo' as const,
      href: '/add/manual?withPhoto=1',
      icon: <DocumentIcon color={theme.colors.text.secondary} />,
      title: t('add.methodPhoto'),
      body: t('add.methodPhotoBody'),
      requiresPlan: false,
    },
    {
      method: 'manual' as const,
      href: '/add/manual',
      icon: <PencilIcon color={theme.colors.text.secondary} />,
      title: t('add.methodManual'),
      body: t('add.methodManualBody'),
      requiresPlan: false,
    },
  ];

  const [primary, ...rest] = methods;

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

        {/* V1 gave all four methods the same bordered box, which made the slowest
            one (typing it all in) look exactly as attractive as the fastest. The
            receipt scan leads; the rest are a quiet group beneath it. */}
        {primary ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${primary.title}. ${primary.body}`}
            onPress={() => start(primary.method, primary.href)}
            style={({ pressed }) => ({
              gap: theme.spacing.md,
              padding: theme.spacing.xl,
              borderRadius: theme.radii.xxl,
              backgroundColor: theme.colors.bg.brand,
              opacity: pressed ? 0.92 : 1,
            })}
          >
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: theme.radii.lg,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.colors.accent.solid,
              }}
            >
              {primary.icon}
            </View>
            <View style={{ gap: theme.spacing.xs }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.sm,
                }}
              >
                <Text variant="h3" tone="onBrand">
                  {primary.title}
                </Text>
                {primary.requiresPlan ? <PlanTag /> : null}
              </View>
              <Text variant="bodySmall" tone="onBrand" style={{ opacity: 0.72 }}>
                {primary.body}
              </Text>
            </View>
          </Pressable>
        ) : null}

        <View
          style={{
            borderRadius: theme.radii.xl,
            backgroundColor: theme.colors.bg.surface,
            overflow: 'hidden',
          }}
        >
          {rest.map((option, index) => (
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
                backgroundColor: pressed ? theme.colors.bg.subtle : 'transparent',
                borderTopWidth: index === 0 ? 0 : theme.borderWidth.hairline,
                borderTopColor: theme.colors.border.subtle,
              })}
            >
              {option.icon}
              <View style={{ flex: 1, gap: 2 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                  }}
                >
                  <Text variant="bodyStrong">{option.title}</Text>
                  {option.requiresPlan ? <PlanTag /> : null}
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

/**
 * The Plus badge. Shown on methods the current plan cannot use, so the limit is
 * visible before the tap rather than discovered by hitting a paywall.
 */
function PlanTag() {
  const theme = useTheme();
  const { t } = useTranslation();

  return (
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
  );
}
