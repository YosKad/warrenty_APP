import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { queryKeys } from '@/lib/queryClient';
import { track } from '@/lib/analytics';
import { formatDate } from '@/lib/format';
import { useLocale } from '@/hooks/useLocale';
import { useProduct } from '@/hooks/useProducts';
import { useServiceRoute } from '@/hooks/useServiceRoute';
import { useWarrantyIntelligence } from '@/hooks/useWarrantyIntelligence';
import { useSessionStore } from '@/state/session';
import {
  buildServiceRequest,
  rankLocations,
  serviceReadiness,
  type Coordinates,
  type ReadinessItem,
} from '@/domain/serviceConcierge';
import { getWarrantySnapshot } from '@/domain/warranty';
import { listDocuments } from '@/services/documentService';
import { recordServiceActivity } from '@/services/serviceConciergeService';
import { ContactActions } from '@/features/service/ContactActions';
import { ServiceLocationCard } from '@/features/service/ServiceLocationCard';
import { ServiceOptions } from '@/features/service/ServiceOptions';
import { ServiceReadinessCard } from '@/features/service/ServiceReadinessCard';
import { ServiceRouteCard } from '@/features/service/ServiceRouteCard';
import { ReportDataSheet } from '@/features/service/ReportDataSheet';
import {
  BackIcon,
  Button,
  ChevronIcon,
  ListSkeleton,
  ProductImage,
  Screen,
  StatusBadge,
  Text,
  useToast,
} from '@/ui';

/**
 * Get service.
 *
 * The screen that has to replace an evening of searching: who is responsible,
 * how to reach them, what they can do, where to go, and what to have in hand.
 *
 * It is built around exactly one recommendation. The alternatives are there,
 * compactly, but a screen that offers six equally weighted contact cards has
 * given the user back the same problem they came here with.
 *
 * Nothing on it requires a location permission. Distance is an enhancement the
 * user can opt into; the default path is their own region, which they know.
 */
export default function ServiceScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const toast = useToast();
  const { locale, today } = useLocale();
  const { productId, issue, verdict, clause } = useLocalSearchParams<{
    productId: string;
    issue?: string;
    verdict?: string;
    clause?: string;
  }>();
  const id = productId ?? '';

  const profile = useSessionStore((s) => s.profile);
  const product = useProduct(id);
  const intelligence = useWarrantyIntelligence(id);
  const { route, locations, isLoading } = useServiceRoute(id, {
    region: profile?.region ?? null,
  });

  const documents = useQuery({
    queryKey: queryKeys.products.documents(id),
    queryFn: () => listDocuments(id),
    enabled: id.length > 0,
  });

  // Null until the user asks for it, and it never leaves the device. The whole
  // screen works without it — see `rankLocations`.
  const [origin, setOrigin] = useState<Coordinates | null>(null);
  const [cityQuery, setCityQuery] = useState('');
  const [reporting, setReporting] = useState<{ locationId?: string; orgId?: string } | null>(
    null,
  );

  useEffect(() => {
    if (!route) return;
    track({
      name: 'service_viewed',
      props: {
        route: route.recommendation.route,
        chainSize: route.chain.length,
        hasLocation: locations.length > 0,
      },
    });
    void recordServiceActivity({ productId: id, kind: 'service_route_viewed' });
  }, [route, locations.length, id]);

  const item = product.data;

  const snapshot = item
    ? getWarrantySnapshot(
        {
          purchaseDate: item.purchaseDate,
          warrantyStart: item.warrantyStart,
          warrantyEnd: item.warrantyEnd,
          durationMonths: item.warrantyDurationMonths,
          extensionMonths: item.extensionMonths,
        },
        today,
      )
    : null;

  const docs = documents.data ?? [];
  const readiness = serviceReadiness({
    hasProofDocument: docs.some((d) => d.kind === 'receipt' || d.kind === 'invoice'),
    serialNumber: item?.serialNumber ?? null,
    model: item?.model ?? null,
    hasWarrantyDocument:
      docs.some((d) => d.kind === 'warranty_certificate') ||
      Boolean(intelligence.data?.source),
    issueDescription: issue ?? null,
    photoCount: docs.filter((d) => d.kind === 'product_photo').length,
    // What the policy's own claim-requirement clauses insist on.
    requiredKeys: [
      'issue_description',
      ...(intelligence.data?.clauses.claimRequirements.length
        ? (['proof_of_purchase'] as ReadinessItem['key'][])
        : []),
    ],
  });

  const message = useMemo(() => {
    if (!item) return '';
    return buildServiceRequest({
      productName: item.name,
      brandName: item.brandName,
      model: item.model,
      serialNumber: item.serialNumber,
      purchaseDate: item.purchaseDate ? formatDate(item.purchaseDate, locale, 'long') : null,
      warrantyEnd: snapshot?.end ? formatDate(snapshot.end, locale, 'long') : null,
      issueDescription: issue ?? null,
      coverageVerdict: verdict ? t(`coverage.verdict.${verdict}`) : null,
      clauseReference: clause ?? null,
      providerName: route?.repairer?.name ?? route?.warrantyHolder?.name ?? null,
      labels: {
        greeting: t('service.requestGreeting'),
        intro: t('service.requestIntro'),
        product: t('service.requestProduct'),
        model: t('service.requestModel'),
        serial: t('service.requestSerial'),
        purchased: t('service.requestPurchased'),
        warrantyUntil: t('service.requestWarrantyUntil'),
        issue: t('service.requestIssue'),
        assessment: t('service.requestAssessment'),
        clause: t('service.requestClause'),
        closing: t('service.requestClosing'),
      },
    });
  }, [item, snapshot, issue, verdict, clause, route, locale, t]);

  const [draft, setDraft] = useState<string | null>(null);
  const requestText = draft ?? message;
  const subject = t('service.requestSubject', { product: item?.name ?? '' });

  const rankedLocations = useMemo(
    () =>
      rankLocations(locations, origin, {
        region: profile?.region ?? null,
        city: cityQuery.trim() || null,
      }),
    [locations, origin, profile?.region, cityQuery],
  );

  if (product.isLoading || !item) {
    return (
      <Screen>
        <Text tone="secondary">{t('common.loading')}</Text>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <View style={{ height: 44, justifyContent: 'center' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('a11y.back')}
          onPress={() => router.back()}
          hitSlop={12}
        >
          <BackIcon color={theme.colors.text.primary} />
        </Pressable>
      </View>

      <View style={{ gap: theme.spacing.lg, marginTop: theme.spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.lg }}>
          <ProductImage
            imagePath={item.imagePath}
            category={item.categorySlug}
            name={item.name}
            size={64}
          />
          <View style={{ flex: 1, minWidth: 0, gap: theme.spacing.xs }}>
            <Text variant="h2" numberOfLines={2} style={{ writingDirection: 'auto' }}>
              {item.name}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
              {snapshot ? <StatusBadge status={snapshot.status} /> : null}
              {snapshot?.daysRemaining !== null && snapshot?.daysRemaining !== undefined ? (
                <Text variant="caption" tone="secondary">
                  {snapshot.daysRemaining >= 0
                    ? t('product.daysRemaining', { count: snapshot.daysRemaining })
                    : t('product.expiredAgo', { count: Math.abs(snapshot.daysRemaining) })}
                </Text>
              ) : null}
            </View>
          </View>
        </View>

        {isLoading ? (
          <ListSkeleton count={3} />
        ) : !route || route.recommendation.route === 'none' ? (
          <UnknownRoute
            onSearchAgain={() => router.push(`/product/${id}`)}
            onOpenWarranty={() => router.push(`/warranty/${id}`)}
            onAddProvider={() => router.push(`/add/manual?productId=${id}`)}
          />
        ) : (
          <>
            {/* One recommendation, stated as an action and justified in a
                sentence. Everything else on the screen is an alternative. */}
            <View
              style={{
                gap: theme.spacing.md,
                padding: theme.spacing.xl,
                borderRadius: theme.radii.xxl,
                backgroundColor: theme.colors.bg.brand,
              }}
            >
              <Text variant="metadata" tone="onBrand" style={{ opacity: 0.65 }}>
                {t('service.recommended').toUpperCase()}
              </Text>
              <Text variant="h2" tone="onBrand">
                {t(`service.recommendedRoute.${route.recommendation.route}`)}
              </Text>
              <Text variant="bodySmall" tone="onBrand" style={{ opacity: 0.75 }}>
                {t(`service.recommendedWhy.${route.recommendation.route}`)}
              </Text>
              {route.repairer ? (
                <Text
                  variant="bodySmallStrong"
                  tone="onBrand"
                  style={{ writingDirection: 'auto' }}
                >
                  {route.repairer.name}
                </Text>
              ) : null}
            </View>

            <ContactActions
              contacts={route.contacts}
              message={requestText}
              subject={subject}
              onOpened={(contact) => {
                track({
                  name: 'service_provider_selected',
                  props: { role: route.repairer ? 'service_provider' : 'warranty_provider' },
                });
                void recordServiceActivity({
                  productId: id,
                  kind: 'provider_contacted',
                  payload: { channel: contact.kind },
                });
              }}
            />

            <ServiceRouteCard chain={route.chain} />

            <ServiceOptions capabilities={route.capabilities} />

            <ServiceReadinessCard
              readiness={readiness}
              onFix={(key) =>
                router.push(
                  key === 'proof_of_purchase' || key === 'warranty_document' || key === 'issue_photo'
                    ? `/add/document?productId=${id}`
                    : key === 'issue_description'
                      ? `/coverage/${id}`
                      : `/add/manual?productId=${id}`,
                )
              }
            />

            {/* Location is an enhancement, never a requirement. The manual
                search is offered first because it is the path that always
                works. */}
            <View style={{ gap: theme.spacing.md }}>
              <Text variant="h3" accessibilityRole="header">
                {t('service.nearest')}
              </Text>

              <View
                style={{
                  gap: theme.spacing.sm,
                  padding: theme.spacing.md,
                  borderRadius: theme.radii.lg,
                  backgroundColor: theme.colors.bg.surface,
                }}
              >
                <TextInput
                  accessibilityLabel={t('service.searchCity')}
                  placeholder={t('service.searchCityPlaceholder')}
                  placeholderTextColor={theme.colors.text.tertiary}
                  value={cityQuery}
                  onChangeText={setCityQuery}
                  style={{
                    minHeight: 44,
                    paddingHorizontal: theme.spacing.md,
                    borderRadius: theme.radii.md,
                    backgroundColor: theme.colors.bg.subtle,
                    color: theme.colors.text.primary,
                    fontSize: theme.typography.body.fontSize,
                    writingDirection: 'auto',
                  }}
                />
                <Text variant="caption" tone="tertiary">
                  {t('service.locationOptional')}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void requestCoordinates(setOrigin, () => toast.show(t('service.locationDenied')))}
                  hitSlop={8}
                >
                  <Text variant="caption" tone="accent">
                    {t('service.useMyLocation')}
                  </Text>
                </Pressable>
              </View>

              {rankedLocations.length === 0 ? (
                <Text variant="bodySmall" tone="secondary">
                  {t('service.nearestNone')}
                </Text>
              ) : (
                rankedLocations
                  .slice(0, 3)
                  .map((location) => (
                    <ServiceLocationCard
                      key={location.id}
                      location={location}
                      origin={origin}
                      onReport={() => setReporting({ locationId: location.id })}
                    />
                  ))
              )}
            </View>

            <PreparedRequest
              text={requestText}
              onChange={setDraft}
              onCopied={() => {
                track({
                  name: 'service_request_prepared',
                  props: {
                    channel: route.recommendation.contact?.kind ?? 'none',
                    readyCount: readiness.readyCount,
                  },
                });
                void recordServiceActivity({ productId: id, kind: 'service_request_prepared' });
                toast.show(t('service.copied'));
              }}
            />

            <Pressable
              accessibilityRole="button"
              onPress={() => setReporting({ orgId: route.repairer?.organisationId })}
              hitSlop={8}
              style={{ paddingVertical: theme.spacing.sm }}
            >
              <Text variant="caption" tone="tertiary">
                {t('service.reportTitle')}
              </Text>
            </Pressable>
          </>
        )}
      </View>

      <ReportDataSheet
        visible={reporting !== null}
        productId={id}
        organisationId={reporting?.orgId}
        serviceLocationId={reporting?.locationId}
        onDismiss={() => setReporting(null)}
      />
    </Screen>
  );
}

/**
 * The prepared request.
 *
 * Editable, and copied rather than sent. A message that leaves in the user's
 * name is a message they have to have seen — and every channel that could send
 * it (WhatsApp, mail) opens with it pre-filled and waits for them anyway.
 */
function PreparedRequest({
  text,
  onChange,
  onCopied,
}: {
  text: string;
  onChange: (value: string) => void;
  onCopied: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();

  return (
    <View
      style={{
        gap: theme.spacing.md,
        padding: theme.spacing.lg,
        borderRadius: theme.radii.xl,
        backgroundColor: theme.colors.bg.surface,
      }}
    >
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="h3" accessibilityRole="header">
          {t('service.requestTitle')}
        </Text>
        <Text variant="caption" tone="tertiary">
          {t('service.requestHint')}
        </Text>
      </View>

      <ScrollView
        style={{
          maxHeight: 220,
          borderRadius: theme.radii.md,
          backgroundColor: theme.colors.bg.subtle,
        }}
      >
        <TextInput
          accessibilityLabel={t('service.requestTitle')}
          value={text}
          onChangeText={onChange}
          multiline
          style={{
            padding: theme.spacing.md,
            color: theme.colors.text.primary,
            fontSize: theme.typography.bodySmall.fontSize,
            lineHeight: theme.typography.bodySmall.lineHeight,
            writingDirection: 'auto',
            textAlignVertical: 'top',
          }}
        />
      </ScrollView>

      <Button label={t('service.copyRequest')} variant="secondary" onPress={onCopied} />
    </View>
  );
}

/**
 * Warranty known, service route not.
 *
 * Item 29 of the brief, and the rule it encodes: no generic support number. A
 * number that cannot help costs the user an afternoon and costs us their trust
 * in every later recommendation.
 */
function UnknownRoute({
  onSearchAgain,
  onOpenWarranty,
  onAddProvider,
}: {
  onSearchAgain: () => void;
  onOpenWarranty: () => void;
  onAddProvider: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();

  const actions = [
    { key: 'again', label: t('service.unknownRouteSearch'), onPress: onSearchAgain },
    { key: 'source', label: t('service.unknownRouteSource'), onPress: onOpenWarranty },
    { key: 'add', label: t('service.unknownRouteAdd'), onPress: onAddProvider },
  ];

  return (
    <View
      style={{
        gap: theme.spacing.lg,
        padding: theme.spacing.lg,
        borderRadius: theme.radii.xl,
        backgroundColor: theme.colors.bg.surface,
      }}
    >
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="h3" accessibilityRole="header">
          {t('service.unknownRouteTitle')}
        </Text>
        <Text variant="bodySmall" tone="secondary">
          {t('service.unknownRouteBody')}
        </Text>
      </View>

      <View style={{ gap: theme.spacing.xs }}>
        {actions.map((action) => (
          <Pressable
            key={action.key}
            accessibilityRole="button"
            onPress={action.onPress}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingVertical: theme.spacing.md,
              paddingHorizontal: theme.spacing.md,
              borderRadius: theme.radii.md,
              backgroundColor: pressed ? theme.colors.bg.subtle : 'transparent',
            })}
          >
            <Text variant="bodySmall">{action.label}</Text>
            <ChevronIcon size={16} color={theme.colors.text.tertiary} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/**
 * Asks for a position only when the user taps for it, and shrugs when refused.
 *
 * `expo-location` is loaded lazily so a user who never taps this never triggers
 * the permission machinery at all.
 */
async function requestCoordinates(
  onGranted: (coords: Coordinates) => void,
  onDenied: () => void,
): Promise<void> {
  try {
    const Location = await import('expo-location');
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      onDenied();
      return;
    }
    const position = await Location.getLastKnownPositionAsync();
    const point = position ?? (await Location.getCurrentPositionAsync({}));
    onGranted({
      latitude: point.coords.latitude,
      longitude: point.coords.longitude,
    });
  } catch {
    onDenied();
  }
}
