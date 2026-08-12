import React, { useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { queryKeys } from '@/lib/queryClient';
import { formatDate } from '@/lib/format';
import { isAppError } from '@/lib/errors';
import { useLocale } from '@/hooks/useLocale';
import { useCreateProduct, useSubscriptionState } from '@/hooks/useProducts';
import { addMonths } from '@/domain/date';
import {
  isPurchaseDateSuspicious,
  productDraftSchema,
  type ProductDraft,
  type ProductDraftInput,
} from '@/domain/product';
import { listCategories } from '@/services/profileService';
import { useDraftStore } from '@/state/draftProduct';
import { PaywallSheet } from '@/features/paywall/PaywallSheet';
import {
  BackIcon,
  BottomSheet,
  Button,
  Input,
  ListRow,
  PickerField,
  Screen,
  ScreenFooter,
  Text,
  useToast,
} from '@/ui';

/**
 * Manual product entry.
 *
 * Four short sections rather than one long form. Only name, category and purchase
 * date are required — a product with just those three is genuinely useful, and
 * demanding a serial number up front is how you lose someone on their first product.
 *
 * The critical behaviour here: if the server rejects the insert because the plan
 * limit was reached, the form is *not* cleared. The paywall opens over a form that
 * still holds everything the user typed.
 */

const SUGGESTED_DURATIONS = [12, 24, 36, 60] as const;

export default function ManualAddScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const toast = useToast();
  const { locale, countryCode, currency, timeZone, language } = useLocale();
  const params = useLocalSearchParams<{ productId?: string }>();

  const draftStore = useDraftStore();
  const createProduct = useCreateProduct();
  const subscription = useSubscriptionState();

  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  const [paywallVisible, setPaywallVisible] = useState(false);

  const categories = useQuery({
    queryKey: queryKeys.taxonomy.categories,
    queryFn: () => listCategories(language),
  });

  // Three generics: the form holds the *input* shape (blank strings and all), the
  // resolver validates it, and `onSubmit` receives the parsed `ProductDraft`.
  const { control, handleSubmit, watch, setValue, formState } = useForm<
    ProductDraftInput,
    unknown,
    ProductDraft
  >({
    resolver: zodResolver(productDraftSchema),
    mode: 'onTouched',
    defaultValues: {
      name: '',
      categoryId: '',
      countryCode,
      currency,
      extensionMonths: 0,
      // Restores anything captured from a scan or preserved across a paywall.
      ...draftStore.draft,
    } as ProductDraftInput,
  });

  const purchaseDate = watch('purchaseDate');
  const durationMonths = watch('warrantyDurationMonths');
  const categoryId = watch('categoryId');

  const selectedCategory = useMemo(
    () => categories.data?.find((c) => c.id === categoryId),
    [categories.data, categoryId],
  );

  // Derived, not stored: showing the computed end date as the user picks a duration
  // is what makes "24 months" concrete.
  const derivedEnd =
    purchaseDate && durationMonths ? addMonths(purchaseDate, durationMonths) : null;

  const onSubmit = handleSubmit(async (values) => {
    if (isPurchaseDateSuspicious(values.purchaseDate, timeZone)) {
      const proceed = await confirmFutureDate(t('add.form.futureDateWarning'), t);
      if (!proceed) return;
    }

    try {
      const product = await createProduct.mutateAsync({
        draft: values,
        method: draftStore.method,
      });
      draftStore.clear();
      toast.show(t('common.done'));
      router.replace(`/product/${product.id}`);
    } catch (error) {
      if (isAppError(error) && error.code === 'quota_exceeded') {
        // Keep the draft alive across the paywall — this is the whole point.
        draftStore.setDraft(values);
        setPaywallVisible(true);
        return;
      }
      toast.show(t(isAppError(error) ? error.messageKey : 'errors.unknown'), 'error');
    }
  });

  return (
    <Screen scroll footerHeight={96}>
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

      <View style={{ gap: theme.spacing.xl, marginTop: theme.spacing.sm }}>
        <Text variant="h1" accessibilityRole="header">
          {params.productId ? t('common.edit') : t('add.title')}
        </Text>

        <Section title={t('add.form.sectionBasics')}>
          <Controller
            control={control}
            name="name"
            render={({ field, fieldState }) => (
              <Input
                label={t('add.form.productName')}
                required
                placeholder={t('add.form.productNamePlaceholder')}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error ? t(fieldState.error.message ?? '') : undefined}
                needsReview={draftStore.suggestions.name !== undefined}
              />
            )}
          />

          <Controller
            control={control}
            name="categoryId"
            render={({ fieldState }) => (
              <PickerField
                label={t('add.form.category')}
                required
                value={selectedCategory?.label}
                placeholder={t('common.notSet')}
                onPress={() => setCategorySheetOpen(true)}
                error={fieldState.error ? t(fieldState.error.message ?? '') : undefined}
              />
            )}
          />

          <Controller
            control={control}
            name="brandName"
            render={({ field }) => (
              <Input
                label={t('add.form.brand')}
                value={field.value ?? ''}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                autoCapitalize="words"
                needsReview={draftStore.suggestions.brandName !== undefined}
              />
            )}
          />

          <Controller
            control={control}
            name="model"
            render={({ field }) => (
              <Input
                label={t('add.form.model')}
                value={field.value ?? ''}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                autoCapitalize="characters"
              />
            )}
          />
        </Section>

        <Section title={t('add.form.sectionPurchase')}>
          <Controller
            control={control}
            name="purchaseDate"
            render={({ field, fieldState }) => (
              <Input
                label={t('add.form.purchaseDate')}
                required
                // ISO input keeps the field unambiguous while typing; the value is
                // rendered back in the user's locale in the hint below.
                placeholder="YYYY-MM-DD"
                value={field.value ?? ''}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                keyboardType="numbers-and-punctuation"
                hint={field.value ? formatDate(field.value, locale, 'long') : undefined}
                error={fieldState.error ? t(fieldState.error.message ?? '') : undefined}
                needsReview={draftStore.suggestions.purchaseDate !== undefined}
              />
            )}
          />

          <Controller
            control={control}
            name="retailerName"
            render={({ field }) => (
              <Input
                label={t('add.form.retailer')}
                value={field.value ?? ''}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                needsReview={draftStore.suggestions.retailerName !== undefined}
              />
            )}
          />

          <Controller
            control={control}
            name="purchasePrice"
            render={({ field, fieldState }) => (
              <Input
                label={t('add.form.price')}
                value={field.value === undefined ? '' : String(field.value)}
                onChangeText={(text) => {
                  const parsed = Number(text.replace(',', '.'));
                  field.onChange(text.length === 0 || Number.isNaN(parsed) ? undefined : parsed);
                }}
                onBlur={field.onBlur}
                keyboardType="decimal-pad"
                error={fieldState.error ? t(fieldState.error.message ?? '') : undefined}
              />
            )}
          />
        </Section>

        <Section title={t('add.form.sectionWarranty')}>
          <Controller
            control={control}
            name="warrantyDurationMonths"
            render={({ field }) => (
              <View style={{ gap: theme.spacing.sm }}>
                <Text variant="bodySmallStrong" tone="secondary">
                  {t('add.form.warrantyLength')}
                </Text>
                <View style={{ flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
                  {SUGGESTED_DURATIONS.map((months) => {
                    const selected = field.value === months;
                    return (
                      <Pressable
                        key={months}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={() => field.onChange(selected ? undefined : months)}
                        style={{
                          paddingHorizontal: theme.spacing.lg,
                          paddingVertical: theme.spacing.sm + 2,
                          borderRadius: theme.radii.pill,
                          borderWidth: theme.borderWidth.thin,
                          borderColor: selected
                            ? theme.colors.accent.solid
                            : theme.colors.border.subtle,
                          backgroundColor: selected
                            ? theme.colors.accent.soft
                            : 'transparent',
                        }}
                      >
                        <Text
                          variant="bodySmallStrong"
                          tone={selected ? 'accent' : 'secondary'}
                        >
                          {t('add.form.warrantyMonths', { count: months })}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {derivedEnd ? (
                  <Text variant="caption" tone="tertiary">
                    {t('add.form.warrantyEnds')}: {formatDate(derivedEnd, locale, 'long')}
                  </Text>
                ) : null}
              </View>
            )}
          />
        </Section>

        <Section title={t('add.form.sectionExtras')}>
          <Controller
            control={control}
            name="serialNumber"
            render={({ field, fieldState }) => (
              <Input
                label={t('add.form.serialNumber')}
                value={field.value ?? ''}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                autoCapitalize="characters"
                error={fieldState.error ? t(fieldState.error.message ?? '') : undefined}
              />
            )}
          />

          <Controller
            control={control}
            name="notes"
            render={({ field }) => (
              <Input
                label={t('add.form.notes')}
                value={field.value ?? ''}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                multiline
              />
            )}
          />
        </Section>
      </View>

      <ScreenFooter>
        <Button
          label={t('add.form.save')}
          fullWidth
          loading={formState.isSubmitting || createProduct.isPending}
          onPress={() => void onSubmit()}
        />
      </ScreenFooter>

      <BottomSheet
        visible={categorySheetOpen}
        onDismiss={() => setCategorySheetOpen(false)}
        title={t('add.form.category')}
      >
        {(categories.data ?? []).map((category) => (
          <ListRow
            key={category.id}
            label={category.label}
            onPress={() => {
              setValue('categoryId', category.id, { shouldValidate: true });
              // Offering the category's typical duration is a suggestion the user can
              // take or ignore — it is never applied silently.
              if (category.typicalWarrantyMonths && !durationMonths) {
                setValue('warrantyDurationMonths', category.typicalWarrantyMonths);
              }
              setCategorySheetOpen(false);
            }}
          />
        ))}
      </BottomSheet>

      <PaywallSheet
        visible={paywallVisible}
        onDismiss={() => setPaywallVisible(false)}
        trigger="product_limit"
        offerings={[]}
        currentPlan={subscription.data?.plan ?? 'free'}
        purchasing={false}
        onPurchase={() => undefined}
        onRestore={() => undefined}
      />
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.md }}>
      <Text variant="metadata" tone="tertiary" accessibilityRole="header">
        {title}
      </Text>
      <View style={{ gap: theme.spacing.lg }}>{children}</View>
    </View>
  );
}

function confirmFutureDate(
  message: string,
  t: (key: string) => string,
): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(message, undefined, [
      { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
      { text: t('common.save'), onPress: () => resolve(true) },
    ]);
  });
}
