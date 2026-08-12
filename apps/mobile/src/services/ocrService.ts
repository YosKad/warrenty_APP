import { z } from 'zod';

import { toAppError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { isCalendarDate } from '@/domain/date';
import type { ProductSuggestions } from '@/domain/product';

/**
 * Receipt extraction.
 *
 * The pipeline runs server-side (see supabase/functions/ocr-extract) and returns
 * *candidates*, not values. Nothing here writes to a product: the review screen shows
 * every extracted field with its confidence and the user confirms or corrects it
 * before anything is saved. Blindly trusting OCR is how you end up with a warranty
 * expiring on the wrong date and a user who finds out at the worst moment.
 */

const extractedFieldSchema = z.object({
  value: z.union([z.string(), z.number()]),
  confidence: z.number().min(0).max(1),
});

const extractionResultSchema = z.object({
  jobId: z.string().uuid(),
  status: z.enum(['queued', 'processing', 'succeeded', 'failed']),
  fields: z
    .object({
      retailerName: extractedFieldSchema.optional(),
      purchaseDate: extractedFieldSchema.optional(),
      productName: extractedFieldSchema.optional(),
      brandName: extractedFieldSchema.optional(),
      model: extractedFieldSchema.optional(),
      serialNumber: extractedFieldSchema.optional(),
      invoiceNumber: extractedFieldSchema.optional(),
      purchasePrice: extractedFieldSchema.optional(),
      currency: extractedFieldSchema.optional(),
      warrantyDurationMonths: extractedFieldSchema.optional(),
    })
    .default({}),
  errorCode: z.string().nullable().default(null),
});

export type ExtractionResult = z.infer<typeof extractionResultSchema>;

export type ExtractionOutcome =
  | { status: 'succeeded'; jobId: string; suggestions: ProductSuggestions; foundCount: number }
  | { status: 'pending'; jobId: string }
  | { status: 'failed'; jobId: string; errorCode: string | null };

export async function extractFromDocument(documentId: string): Promise<ExtractionOutcome> {
  try {
    const { data, error } = await supabase.functions.invoke('ocr-extract', {
      body: { documentId },
    });
    if (error) throw error;

    const parsed = extractionResultSchema.safeParse(data);
    if (!parsed.success) {
      // A malformed response is a failure, not something to partially believe.
      return { status: 'failed', jobId: '', errorCode: 'invalid_response' };
    }
    return toOutcome(parsed.data);
  } catch (error) {
    throw toAppError(error);
  }
}

export async function getExtractionJob(jobId: string): Promise<ExtractionOutcome> {
  try {
    const { data, error } = await supabase
      .from('ocr_jobs')
      .select('id, status, fields, error_code')
      .eq('id', jobId)
      .single();
    if (error) throw error;

    const parsed = extractionResultSchema.safeParse({
      jobId: data.id,
      status: data.status,
      fields: data.fields,
      errorCode: data.error_code,
    });
    if (!parsed.success) return { status: 'failed', jobId, errorCode: 'invalid_response' };
    return toOutcome(parsed.data);
  } catch (error) {
    throw toAppError(error);
  }
}

function toOutcome(result: ExtractionResult): ExtractionOutcome {
  if (result.status === 'failed') {
    return { status: 'failed', jobId: result.jobId, errorCode: result.errorCode };
  }
  if (result.status !== 'succeeded') {
    return { status: 'pending', jobId: result.jobId };
  }

  const suggestions: ProductSuggestions = {};
  const f = result.fields;

  if (f.productName) {
    suggestions.name = {
      value: String(f.productName.value),
      source: 'document_extraction',
      confidence: f.productName.confidence,
    };
  }
  if (f.brandName) {
    suggestions.brandName = {
      value: String(f.brandName.value),
      source: 'document_extraction',
      confidence: f.brandName.confidence,
    };
  }
  if (f.model) {
    suggestions.model = {
      value: String(f.model.value),
      source: 'document_extraction',
      confidence: f.model.confidence,
    };
  }
  // A date that doesn't parse is dropped rather than shown — an unparseable
  // suggestion is worse than no suggestion, because the user has to notice it's wrong.
  if (f.purchaseDate && isCalendarDate(String(f.purchaseDate.value))) {
    suggestions.purchaseDate = {
      value: String(f.purchaseDate.value),
      source: 'document_extraction',
      confidence: f.purchaseDate.confidence,
    };
  }
  if (f.retailerName) {
    suggestions.retailerName = {
      value: String(f.retailerName.value),
      source: 'document_extraction',
      confidence: f.retailerName.confidence,
    };
  }
  if (f.purchasePrice) {
    const numeric = Number(f.purchasePrice.value);
    if (Number.isFinite(numeric) && numeric >= 0) {
      suggestions.purchasePrice = {
        value: numeric,
        source: 'document_extraction',
        confidence: f.purchasePrice.confidence,
      };
    }
  }
  if (f.currency && /^[A-Z]{3}$/.test(String(f.currency.value))) {
    suggestions.currency = {
      value: String(f.currency.value),
      source: 'document_extraction',
      confidence: f.currency.confidence,
    };
  }
  if (f.warrantyDurationMonths) {
    const months = Number(f.warrantyDurationMonths.value);
    if (Number.isInteger(months) && months > 0 && months <= 600) {
      suggestions.warrantyDurationMonths = {
        value: months,
        source: 'document_extraction',
        confidence: f.warrantyDurationMonths.confidence,
      };
    }
  }

  return {
    status: 'succeeded',
    jobId: result.jobId,
    suggestions,
    foundCount: Object.keys(suggestions).length,
  };
}

/**
 * Fields below this are still shown, but pre-marked as needing a look. Above it, the
 * value is filled in normally — the user can always edit either way.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.7;

export function isLowConfidence(confidence: number): boolean {
  return confidence < LOW_CONFIDENCE_THRESHOLD;
}
