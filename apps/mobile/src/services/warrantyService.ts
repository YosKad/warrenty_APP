import { toAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import type { CalendarDate } from '@/domain/date';
import type { ConfidenceLevel, WarrantySource } from '@/domain/warranty';
import type {
  WarrantyDataProvider,
  WarrantyLookupInput,
  WarrantyLookupResult,
} from './providers/types';

/**
 * Warranty lookup.
 *
 * Providers are consulted in priority order and the first usable answer wins. The
 * result always carries where it came from, because the app's contract with the user
 * is that automatically-filled warranty data is labelled, never presented as fact.
 *
 * What this module will not do: invent a duration. If no provider knows, the answer
 * is `null` and the user is asked. A plausible-looking guess that turns out to be
 * wrong when someone tries to claim is the worst outcome this product can produce.
 */

/** Our own curated policy database, resolved server-side by specificity. */
const internalProvider: WarrantyDataProvider = {
  id: 'internal_db',
  priority: 0,
  async lookup(input) {
    const { data, error } = await supabase.functions.invoke<WarrantyLookupResult | null>(
      'warranty-lookup',
      { body: input },
    );
    if (error) throw error;
    return data ?? null;
  },
};

/**
 * Category-level fallback: "TVs are typically 24 months". Explicitly low confidence
 * and labelled as a typical value, so the confirmation screen asks the user to check
 * rather than stating it.
 */
const categoryHeuristicProvider: WarrantyDataProvider = {
  id: 'category_typical',
  priority: 100,
  async lookup(input) {
    if (!input.categoryId) return null;
    const { data, error } = await supabase
      .from('product_categories')
      .select('typical_warranty_months')
      .eq('id', input.categoryId)
      .single();
    if (error || !data?.typical_warranty_months) return null;
    return {
      durationMonths: data.typical_warranty_months,
      warrantyId: null,
      providerOrganisationId: null,
      providerName: null,
      coverageSummary: null,
      exclusionsSummary: null,
      source: 'ai_inferred',
      sourceLabel: 'warranty.source.categoryTypical',
      sourceUrl: null,
      lastVerifiedAt: null,
      confidence: 0.3,
    };
  },
};

const providers: WarrantyDataProvider[] = [internalProvider, categoryHeuristicProvider];

export function registerWarrantyProvider(provider: WarrantyDataProvider): void {
  providers.push(provider);
  providers.sort((a, b) => a.priority - b.priority);
}

export async function lookupWarranty(
  input: WarrantyLookupInput,
): Promise<WarrantyLookupResult | null> {
  for (const provider of [...providers].sort((a, b) => a.priority - b.priority)) {
    try {
      const result = await provider.lookup(input);
      if (result && result.durationMonths !== null) return result;
    } catch (error) {
      // One provider failing must not block the others, or the add flow dies with it.
      logger.warn('warranty provider failed', { provider: provider.id });
    }
  }
  return null;
}

export type WarrantyDetail = {
  warrantyId: string | null;
  durationMonths: number | null;
  coverageSummary: string | null;
  exclusionsSummary: string | null;
  providerName: string | null;
  providerPhone: string | null;
  providerWebsite: string | null;
  source: WarrantySource;
  sourceUrl: string | null;
  sourceLabel: string | null;
  lastVerifiedAt: string | null;
  confidence: ConfidenceLevel;
  validFrom: CalendarDate | null;
  validTo: CalendarDate | null;
};

export async function getWarrantyDetail(
  warrantyId: string,
): Promise<WarrantyDetail | null> {
  try {
    const { data, error } = await supabase
      .from('warranties')
      .select(
        `id, duration_months, coverage_summary, exclusions_summary, confidence,
         valid_from, valid_to,
         provider:warranty_provider_id ( name, support_phone, website ),
         source:source_id ( kind, source_url, document_title, last_verified_at )`,
      )
      .eq('id', warrantyId)
      .single();
    if (error) throw error;
    if (!data) return null;

    const provider = firstRelation(data.provider);
    const source = firstRelation(data.source);

    return {
      warrantyId: data.id,
      durationMonths: data.duration_months,
      coverageSummary: data.coverage_summary,
      exclusionsSummary: data.exclusions_summary,
      providerName: provider?.name ?? null,
      providerPhone: provider?.support_phone ?? null,
      providerWebsite: provider?.website ?? null,
      source: (source?.kind as WarrantySource) ?? 'internal_db',
      sourceUrl: source?.source_url ?? null,
      sourceLabel: source?.document_title ?? null,
      lastVerifiedAt: source?.last_verified_at ?? null,
      confidence: data.confidence,
      validFrom: data.valid_from as CalendarDate | null,
      validTo: data.valid_to as CalendarDate | null,
    };
  } catch (error) {
    throw toAppError(error);
  }
}

export type WarrantyClause = {
  id: string;
  section: string | null;
  clauseText: string;
  clauseType: string;
};

/** The clauses behind an assessment, for the "view warranty clause" affordance. */
export async function getWarrantyClauses(
  warrantyId: string,
  clauseIds?: string[],
): Promise<WarrantyClause[]> {
  try {
    let query = supabase
      .from('warranty_terms')
      // Never select `embedding`: it is megabytes of vectors with no client use.
      .select('id, section, clause_text, clause_type, ordinal')
      .eq('warranty_id', warrantyId)
      .order('ordinal', { ascending: true });
    if (clauseIds && clauseIds.length > 0) query = query.in('id', clauseIds);

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: row.id,
      section: row.section,
      clauseText: row.clause_text,
      clauseType: row.clause_type,
    }));
  } catch (error) {
    throw toAppError(error);
  }
}

/** PostgREST returns embedded relations as an object or an array depending on shape. */
function firstRelation<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
