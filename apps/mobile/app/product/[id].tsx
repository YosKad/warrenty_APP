import { Alert, Pressable, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { queryKeys } from '@/lib/queryClient';
import { formatCurrency, formatDate, isolateLtr } from '@/lib/format';
import { useLocale } from '@/hooks/useLocale';
import { useDeleteProduct, useProduct, useSubscriptionState } from '@/hooks/useProducts';
import {
  canStartClaim,
  confidenceForSource,
  getWarrantySnapshot,
  requiresUserVerification,
} from '@/domain/warranty';
import { hasEntitlement } from '@/domain/entitlements';
import { listDocuments } from '@/services/documentService';
import {
  BackIcon,
  Button,
  Card,
  DocumentIcon,
  ListGroup,
  ListRow,
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

      <View style={{ gap: theme.spacing.xl, marginTop: theme.spacing.sm }}>
        {/* The warranty card. The one place in the app that uses the brand surface,
            so it reads as an object you own rather than a row in a database. */}
        <Card variant="brand" padded>
          <View style={{ gap: theme.spacing.md }}>
            <View style={{ gap: theme.spacing.xs }}>
              <Text variant="h2" tone="onBrand">
                {item.name}
              </Text>
              {item.brandName ? (
                <Text variant="bodySmall" tone="onBrand" style={{ opacity: 0.7 }}>
                  {item.brandName}
                  {item.model ? ` · ${isolateLtr(item.model)}` : ''}
                </Text>
              ) : null}
            </View>

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.md,
                flexWrap: 'wrap',
              }}
            >
              <StatusBadge status={snapshot.status} />
              {snapshot.daysRemaining !== null ? (
                <Text variant="bodySmall" tone="onBrand" style={{ opacity: 0.75 }}>
                  {snapshot.daysRemaining >= 0
                    ? t('product.daysRemaining', { count: snapshot.daysRemaining })
                    : t('product.expiredAgo', { count: Math.abs(snapshot.daysRemaining) })}
                </Text>
              ) : null}
            </View>

            {snapshot.end ? (
              <Text variant="bodySmall" tone="onBrand" style={{ opacity: 0.6 }}>
                {t('product.endsOn', { date: formatDate(snapshot.end, locale, 'long') })}
              </Text>
            ) : null}
          </View>
        </Card>

        {needsVerification ? <VerifyPrompt /> : null}

        {snapshot.start && snapshot.end ? (
          <Card>
            <WarrantyTimeline
              start={snapshot.start}
              end={snapshot.end}
              progress={snapshot.progress}
              status={snapshot.status}
              locale={locale}
            />
          </Card>
        ) : (
          <Card>
            <View style={{ gap: theme.spacing.md }}>
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
          </Card>
        )}

        <View style={{ gap: theme.spacing.sm }}>
          <ProvenanceNote
            source={item.warrantySource}
            confidence={item.warrantyVerifiedByUser ? 'high' : confidence}
          />
        </View>

        {claimable ? (
          <View style={{ gap: theme.spacing.md }}>
            <Button
              label={t('product.reportProblem')}
              fullWidth
              onPress={() => router.push(`/coverage/${productId}`)}
            />
            {!canUseCoverage ? (
              <Text variant="caption" tone="tertiary" align="center">
                {t('paywall.aiCoverage')}
              </Text>
            ) : null}
          </View>
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
