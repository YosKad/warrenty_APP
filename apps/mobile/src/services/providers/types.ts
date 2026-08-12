import type { CalendarDate } from '@/domain/date';
import type { WarrantySource } from '@/domain/warranty';

/**
 * Provider abstractions.
 *
 * Product identification and warranty lookup will be served by different back-ends
 * over the product's life — a barcode database today, a retailer API next quarter,
 * an image model after that. These interfaces are the seam. Everything above them
 * (the add-product flow, the warranty confirmation screen) is written against the
 * interface and never learns which implementation answered.
 */

export type ProviderConfidence = number; // 0–1

export type ProductIdentity = {
  name: string;
  brandName?: string;
  model?: string;
  categorySlug?: string;
  imageUrl?: string;
  gtin?: string;
  confidence: ProviderConfidence;
  source: WarrantySource;
  sourceLabel: string;
};

export type ProductRecognitionInput =
  | { kind: 'barcode'; value: string; format: string }
  | { kind: 'image'; localUri: string }
  | { kind: 'text'; value: string };

export interface ProductRecognitionProvider {
  readonly id: string;
  /** Cheap providers are consulted first; see `identifyProduct` in productRecognition.ts. */
  readonly costTier: 'free' | 'cheap' | 'expensive';
  supports(input: ProductRecognitionInput): boolean;
  identify(input: ProductRecognitionInput): Promise<ProductIdentity | null>;
}

export type WarrantyLookupInput = {
  brandId?: string;
  brandName?: string;
  model?: string;
  categoryId?: string;
  countryCode: string;
  purchaseDate?: CalendarDate;
};

export type WarrantyLookupResult = {
  durationMonths: number | null;
  warrantyId: string | null;
  providerOrganisationId: string | null;
  providerName: string | null;
  coverageSummary: string | null;
  exclusionsSummary: string | null;
  source: WarrantySource;
  /** Human-readable provenance shown under the warranty card. */
  sourceLabel: string;
  sourceUrl: string | null;
  lastVerifiedAt: string | null;
  confidence: ProviderConfidence;
};

export interface WarrantyDataProvider {
  readonly id: string;
  readonly priority: number; // lower wins
  lookup(input: WarrantyLookupInput): Promise<WarrantyLookupResult | null>;
}
