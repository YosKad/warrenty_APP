import { Alert, Pressable, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { queryKeys } from '@/lib/queryClient';
import { formatCurrency, formatDate, isolateLtr } from '@/lib/format';
import { useLocale } from '@/hooks/useLocale';
import { useDeleteProduct, useProduct, useSubscriptionState } from '@/hooks/useProducts';
import { useProductProtection } from '@/hooks/useProtection';
import { useWarrantyIntelligence } from '@/hooks/useWarrantyIntelligence';
import {
  canStartClaim,
  confidenceForSource,
  getWarrantySnapshot,
  requiresUserVerification,
} from '@/domain/warranty';
import { hasEntitlement } from '@/domain/entitlements';
import { listDocuments } from '@/services/documentService';
import { refreshWarrantyMatch } from '@/services/warrantyIntelligenceService';
import { ProtectionBreakdown } from '@/features/protection/ProtectionBreakdown';
import { WarrantyIntelligenceSection } from '@/features/warranty/WarrantyIntelligenceSection';
import { SomethingWrongCard } from '@/features/warranty/SomethingWrongCard';
import {
  BackIcon,
  Button,
  Card,
  DocumentIcon,
  ListGroup,
  ListRow,
  ProductImage,
  ProvenanceNote,
  Screen,
  StatusBadge,
  Text,
  VerifyPrompt,
  WarrantyTimeline,
  useToast,
} from '@/ui';

/**
 * Product detail — the digital warranty card.
 *
 * The hierarchy answers, in order: what is this, is it still covered, how long have I
 * got, and what can I do about it. Identifiers (model, serial) sit below that: needed
 * when filing a claim, irrelevant the rest of the time.
 */
export default function ProductDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { locale, today } = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();
  const productId = id ?? '';

  const product = useProduct(productId);
  const subscription = useSubscriptionState();
  const deleteProduct = useDeleteProduct();

  const documents = useQuery({
    queryKey: queryKeys.products.documents(productId),
    queryFn: () => listDocuments(productId),
    enabled: productId.length > 0,
  });

  const protection = useProductProtection(productId);
  const intelligence = useWarrantyIntelligence(productId);

  // "Search again" is a request to the resolver, not a client-side write: the
  // match row is service-role only, deliberately.
  const resolveMatch = useMutation({
    mutationFn: () => refreshWarrantyMatch(productId),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.warranty.intelligence(productId),
      }),
    onError: () => toast.show(t('errors.unknown'), 'error'),
  });

  if (product.isLoading || !product.data) {
    return (
      <Screen>
        <Text tone="secondary">{t('common.loading')}</Text>
      </Screen>
    );
  }

  const item = product.data;
  const snapshot = getWarrantySnapshot(
    {
      purchaseDate: item.purchaseDate,
      warrantyStart: item.warrantyStart,
      warrantyEnd: item.warrantyEnd,
      durationMonths: item.warrantyDurationMonths,
      extensionMonths: item.extensionMonths,
    },
    today,
  );

  const confidence = confidenceForSource(item.warrantySource, null);
  const needsVerification =
    !item.warrantyVerifiedByUser &&
    requiresUserVerification(item.warrantySource, confidence);

  const claimable = canStartClaim(snapshot.status, item.lifecycle);
  const canUseCoverage = hasEntitlement(
    subscription.data?.entitlements ?? {
      product_limit: 3,
      unlimited_products: false,
      ai_coverage: false,
      smart_scan: false,
      advanced_notifications: false,
      provider_lookup: false,
      priority_analysis: false,
      document_export: false,
    },
    'ai_coverage',
  );

  const confirmDelete = () => {
    Alert.alert(t('product.deleteTitle'), t('product.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          deleteProduct.mutate(productId, {
            onSuccess: () => {
              toast.show(t('common.done'));
              router.back();
            },
            onError: () => toast.show(t('errors.unknown'), 'error'),
          });
        },
      },
    ]);
  };

  return (
    <Screen scroll>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 44,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('a11y.back')}
          onPress={() => router.back()}
          hitSlop={12}
        >
          <BackIcon color={theme.colors.text.primary} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.edit')}
          onPress={() => router.push(`/add/manual?productId=${productId}`)}
          hitSlop={12}
        >
          <Text variant="bodySmall" tone="accent">
            {t('common.edit')}
          </Text>
        </Pressable>
      </View>

      <View style={{ gap: theme.spacing.lg, marginTop: theme.spacing.sm }}>
        {/* The product, not a record of it. V1 opened with a dark card carrying four
            lines of text and no indication of what the thing actually was; the image
            is what makes this read as an object you own. */}
        <View style={{ gap: theme.spacing.lg, alignItems: 'center' }}>
          <ProductImage
            imagePath={item.imagePath}
            category={item.categorySlug}
            name={item.name}
            size={120}
            radius={theme.radii.xxl}
          />

          <View style={{ gap: theme.spacing.xs, alignItems: 'center' }}>
            <Text
              variant="h1"
              align="center"
              accessibilityRole="header"
              style={{ writingDirection: 'auto' }}
            >
              {item.name}
            </Text>
            {item.brandName || item.model ? (
              <Text
                variant="bodySmall"
                tone="tertiary"
                align="center"
                style={{ writingDirection: 'auto' }}
              >
                {[item.brandName, item.model ? isolateLtr(item.model) : null]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            ) : null}
          </View>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.sm,
              flexWrap: 'wrap',
              justifyContent: 'center',
            }}
          >
            <StatusBadge status={snapshot.status} />
            {snapshot.daysRemaining !== null ? (
              <Text variant="bodySmall" tone="secondary">
                {snapshot.daysRemaining >= 0
                  ? t('product.daysRemaining', { count: snapshot.daysRemaining })
                  : t('product.expiredAgo', { count: Math.abs(snapshot.daysRemaining) })}
              </Text>
            ) : null}
          </View>
        </View>

        {needsVerification ? <VerifyPrompt /> : null}

        {snapshot.start && snapshot.end ? (
          <View
            style={{
              padding: theme.spacing.lg,
              borderRadius: theme.radii.xl,
              backgroundColor: theme.colors.bg.surface,
              gap: theme.spacing.md,
            }}
          >
            <WarrantyTimeline
              start={snapshot.start}
              end={snapshot.end}
              progress={snapshot.progress}
              status={snapshot.status}
              locale={locale}
            />
            {snapshot.end ? (
              <Text variant="caption" tone="tertiary">
                {t('product.endsOn', { date: formatDate(snapshot.end, locale, 'long') })}
              </Text>
            ) : null}
          </View>
        ) : (
          <View
            style={{
              padding: theme.spacing.lg,
              borderRadius: theme.radii.xl,
              backgroundColor: theme.colors.bg.surface,
              gap: theme.spacing.md,
            }}
          >
            <Text variant="bodySmall" tone="secondary">
              {t('product.warrantyUnknown')}
            </Text>
            <Button
              label={t('product.setWarranty')}
              variant="secondary"
              size="sm"
              onPress={() => router.push(`/add/manual?productId=${productId}`)}
            />
          </View>
        )}

        {protection ? (
          <ProtectionBreakdown
            completeness={protection.scored.completeness}
            onFix={(key) =>
              router.push(
                key === 'proof_of_purchase'
                  ? `/add/document?productId=${productId}`
                  : `/add/manual?productId=${productId}`,
              )
            }
          />
        ) : null}

        <View style={{ gap: theme.spacing.sm }}>
          <ProvenanceNote
            source={item.warrantySource}
            confidence={item.warrantyVerifiedByUser ? 'high' : confidence}
          />
        </View>

        {/* Warranty Intelligence. Sits directly under the timeline because "what
            does my warranty actually say" is the question the countdown provokes. */}
        {intelligence.data ? (
          <WarrantyIntelligenceSection
            intelligence={intelligence.data}
            onOpenCoverage={() => router.push(`/warranty/${productId}`)}
            onOpenSource={() => router.push(`/warranty/${productId}`)}
            onResolveConflict={() => router.push(`/warranty/${productId}`)}
            onAddWarranty={() => router.push(`/add/manual?productId=${productId}`)}
            onUploadDocument={() => router.push(`/add/document?productId=${productId}`)}
            onScanReceipt={() => router.push('/add/scan')}
            onSearchAgain={() => resolveMatch.mutate()}
            searching={resolveMatch.isPending}
          />
        ) : null}

        {/* A product-specific action, not a chat box. Only offered while there is
            a live warranty to check the fault against. */}
        {claimable ? (
          <SomethingWrongCard
            productName={item.name}
            locked={!canUseCoverage}
            onSubmit={(description) =>
              router.push(
                `/coverage/${productId}?issue=${encodeURIComponent(description)}`,
              )
            }
          />
        ) : null}

        <ListGroup title={t('add.form.sectionPurchase')}>
          <ListRow
            label={t('product.purchased')}
            value={formatDate(item.purchaseDate, locale)}
          />
          {item.retailerName ? (
            <ListRow label={t('product.retailer')} value={item.retailerName} />
          ) : null}
          {item.purchasePrice !== null ? (
            <ListRow
              label={t('product.price')}
              value={formatCurrency(item.purchasePrice, item.currency, locale)}
            />
          ) : null}
        </ListGroup>

        {item.model || item.serialNumber ? (
          <ListGroup title={t('add.form.sectionBasics')}>
            {item.model ? (
              <ListRow label={t('product.model')} value={isolateLtr(item.model)} />
            ) : null}
            {item.serialNumber ? (
              <ListRow
                label={t('product.serialNumber')}
                // Latin-script identifier pinned LTR so its digits don't reorder in
                // a Hebrew layout.
                value={isolateLtr(item.serialNumber)}
              />
            ) : null}
          </ListGroup>
        ) : null}

        <ListGroup title={t('product.documents')}>
          {(documents.data ?? []).map((doc) => (
            <ListRow
              key={doc.id}
              label={doc.fileName}
              description={t(`documents.${doc.kind}`)}
              leading={<DocumentIcon size={20} color={theme.colors.text.tertiary} />}
              onPress={() => router.push(`/document/${doc.id}`)}
            />
          ))}
          <ListRow
            label={t('product.addDocument')}
            onPress={() => router.push(`/add/document?productId=${productId}`)}
          />
        </ListGroup>

        {item.notes ? (
          <Card>
            <View style={{ gap: theme.spacing.sm }}>
              <Text variant="metadata" tone="tertiary">
                {t('product.notes')}
              </Text>
              <Text variant="bodySmall">{item.notes}</Text>
            </View>
          </Card>
        ) : null}

        <Button label={t('common.delete')} variant="danger" onPress={confirmDelete} />
      </View>
    </Screen>
  );
}
