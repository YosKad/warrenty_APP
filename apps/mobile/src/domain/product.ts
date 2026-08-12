import { z } from 'zod';

import { isCalendarDate, todayInTimeZone, type CalendarDate } from './date';
import type { ProductLifecycle, WarrantySource } from './warranty';

/**
 * Product domain types and the validation schemas behind every product form.
 *
 * Schemas live here rather than beside the screens so the same rules apply to manual
 * entry, OCR-prefilled entry and barcode-prefilled entry. There is exactly one
 * definition of "a valid product".
 */

export const CURRENCY_PATTERN = /^[A-Z]{3}$/;
/** Serial numbers vary wildly; we only reject characters that indicate a bad OCR read. */
export const SERIAL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9\- /.]{0,63}$/;

const calendarDate = z.string().refine(isCalendarDate, {
  message: 'validation.invalidDate',
});

const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { message: 'validation.tooLong' })
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined));

export const productDraftSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { message: 'validation.required' })
      .max(160, { message: 'validation.tooLong' }),
    categoryId: z.string().uuid({ message: 'validation.required' }),
    brandId: z.string().uuid().optional(),
    /** Free-text brand for when the user's brand isn't in the taxonomy yet. */
    brandName: optionalTrimmed(120),
    model: optionalTrimmed(120),
    serialNumber: z
      .string()
      .trim()
      .regex(SERIAL_PATTERN, { message: 'validation.invalidSerial' })
      .optional()
      .transform((value) => (value && value.length > 0 ? value : undefined)),
    purchaseDate: calendarDate,
    retailerId: z.string().uuid().optional(),
    retailerName: optionalTrimmed(120),
    purchasePrice: z
      .number()
      .nonnegative({ message: 'validation.nonNegative' })
      .max(10_000_000, { message: 'validation.tooLarge' })
      .optional(),
    currency: z
      .string()
      .regex(CURRENCY_PATTERN, { message: 'validation.invalidCurrency' })
      .optional(),
    countryCode: z
      .string()
      .length(2, { message: 'validation.invalidCountry' })
      .toUpperCase(),
    warrantyStart: calendarDate.optional(),
    warrantyEnd: calendarDate.optional(),
    warrantyDurationMonths: z
      .number()
      .int({ message: 'validation.wholeNumber' })
      .min(1, { message: 'validation.min' })
      .max(600, { message: 'validation.tooLarge' })
      .optional(),
    extensionMonths: z.number().int().min(0).max(600).optional(),
    warrantyProviderId: z.string().uuid().optional(),
    serviceProviderId: z.string().uuid().optional(),
    notes: optionalTrimmed(2000),
    imagePath: optionalTrimmed(512),
  })
  .superRefine((value, ctx) => {
    // A price without a currency is unusable — we can neither display nor convert it.
    if (value.purchasePrice !== undefined && !value.currency) {
      ctx.addIssue({
        code: 'custom',
        path: ['currency'],
        message: 'validation.currencyRequiredWithPrice',
      });
    }
    if (
      value.warrantyStart &&
      value.purchaseDate &&
      value.warrantyStart < value.purchaseDate
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['warrantyStart'],
        message: 'validation.warrantyStartBeforePurchase',
      });
    }
    const start = value.warrantyStart ?? value.purchaseDate;
    if (value.warrantyEnd && start && value.warrantyEnd < start) {
      ctx.addIssue({
        code: 'custom',
        path: ['warrantyEnd'],
        message: 'validation.warrantyEndBeforeStart',
      });
    }
  });

export type ProductDraft = z.infer<typeof productDraftSchema>;

/**
 * A purchase date in the future is almost always a typo or a misread receipt. We
 * warn rather than block: pre-orders and gifts are real, and refusing to save the
 * user's own fact is worse than letting them confirm it.
 */
export function isPurchaseDateSuspicious(
  purchaseDate: CalendarDate,
  timeZone: string,
): boolean {
  return purchaseDate > todayInTimeZone(timeZone);
}

export type Product = {
  id: string;
  ownerId: string;
  workspaceId: string | null;
  name: string;
  categoryId: string;
  categorySlug: string | null;
  brandId: string | null;
  brandName: string | null;
  model: string | null;
  serialNumber: string | null;
  purchaseDate: CalendarDate | null;
  purchasePrice: number | null;
  currency: string | null;
  retailerId: string | null;
  retailerName: string | null;
  countryCode: string;
  warrantyStart: CalendarDate | null;
  warrantyEnd: CalendarDate | null;
  warrantyDurationMonths: number | null;
  extensionMonths: number | null;
  warrantySource: WarrantySource;
  warrantyVerifiedByUser: boolean;
  warrantyProviderId: string | null;
  serviceProviderId: string | null;
  imagePath: string | null;
  notes: string | null;
  lifecycle: ProductLifecycle;
  createdAt: string;
  updatedAt: string;
};

export type ProductListFilters = {
  query?: string;
  status?: ('active' | 'ending_soon' | 'expired' | 'unknown')[];
  categoryIds?: string[];
  brandIds?: string[];
  purchasedAfter?: CalendarDate;
  purchasedBefore?: CalendarDate;
  expiringBefore?: CalendarDate;
  sort?: 'urgency' | 'recent' | 'name' | 'expiry';
};

/**
 * Fields the app is allowed to prefill from an automated source. Anything outside
 * this list stays under the user's control — notably, we never auto-fill a serial
 * number the user then has no reason to double-check, because a wrong serial is
 * worse than a blank one when they file a claim.
 */
export const AUTO_FILLABLE_FIELDS = [
  'name',
  'brandName',
  'model',
  'purchaseDate',
  'purchasePrice',
  'currency',
  'retailerName',
  'warrantyDurationMonths',
] as const satisfies readonly (keyof ProductDraft)[];

export type AutoFillableField = (typeof AUTO_FILLABLE_FIELDS)[number];

/** A prefilled value plus where it came from, so the UI can show provenance per field. */
export type FieldSuggestion<T> = {
  value: T;
  source: WarrantySource;
  confidence: number;
};

export type ProductSuggestions = Partial<{
  [K in AutoFillableField]: FieldSuggestion<NonNullable<ProductDraft[K]>>;
}>;
