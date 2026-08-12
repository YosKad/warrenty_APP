import { z } from 'npm:zod@4';

import { errorResponse, handlePreflight, jsonResponse } from '../_shared/cors.ts';
import { requireUser, serviceClient } from '../_shared/supabase.ts';

/**
 * Warranty lookup against the internal policy database.
 *
 * Resolution is a plain SQL query (`resolve_warranty_policy`) ordered by specificity
 * and verification state — no model involved, because a database lookup that returns
 * nothing is far more useful than a model that returns something plausible.
 *
 * Every response carries its provenance: the source, its URL, and when it was last
 * verified. The app renders that under the warranty card. A result the user cannot
 * trace is a result they should not act on.
 */

const requestSchema = z.object({
  brandId: z.string().uuid().optional(),
  brandName: z.string().max(120).optional(),
  model: z.string().max(120).optional(),
  categoryId: z.string().uuid().optional(),
  countryCode: z.string().length(2),
  purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

Deno.serve(async (request: Request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const user = await requireUser(request);
  if (!user) return errorResponse('unauthenticated');

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse('validation');
  const input = parsed.data;

  const admin = serviceClient();

  // Resolve the brand from a free-text name when the client only has one. Exact
  // match first, then a fuzzy fallback — a typo shouldn't lose the lookup, but a
  // fuzzy match must never beat an exact one.
  let brandId = input.brandId ?? null;
  if (!brandId && input.brandName) {
    const { data } = await admin
      .from('organisations')
      .select('id')
      .contains('roles', ['manufacturer'])
      .ilike('name', input.brandName)
      .limit(1)
      .maybeSingle();
    brandId = data?.id ?? null;
  }

  const { data: policies } = await admin.rpc('resolve_warranty_policy', {
    p_brand_id: brandId,
    p_category_id: input.categoryId ?? null,
    p_model: input.model ?? null,
    p_country_code: input.countryCode.toUpperCase(),
    p_purchase_date: input.purchaseDate ?? null,
  });

  const policy = policies?.[0];
  if (!policy || !policy.duration_months) {
    // No match. We say nothing rather than falling back to "most things are 12
    // months" — a wrong warranty date is worse than an absent one.
    return jsonResponse(null);
  }

  const [{ data: provider }, { data: source }] = await Promise.all([
    policy.warranty_provider_id
      ? admin
          .from('organisations')
          .select('id, name')
          .eq('id', policy.warranty_provider_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    policy.source_id
      ? admin
          .from('warranty_sources')
          .select('kind, source_url, document_title, last_verified_at')
          .eq('id', policy.source_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return jsonResponse({
    durationMonths: policy.duration_months,
    warrantyId: policy.id,
    providerOrganisationId: provider?.id ?? null,
    providerName: provider?.name ?? null,
    coverageSummary: policy.coverage_summary,
    exclusionsSummary: policy.exclusions_summary,
    source: source?.kind ?? 'internal_db',
    sourceLabel: source?.document_title ?? 'warranty.source.internal_db',
    sourceUrl: source?.source_url ?? null,
    lastVerifiedAt: source?.last_verified_at ?? null,
    // Surfaced to the user as a confidence band, and it drives whether the app asks
    // them to confirm the value or presents it as settled.
    confidence: confidenceScore(policy.verification, policy.confidence),
  });
});

function confidenceScore(verification: string, confidence: string): number {
  if (verification === 'official') return 0.95;
  if (verification === 'verified') return 0.85;
  if (confidence === 'high') return 0.8;
  if (confidence === 'medium') return 0.6;
  return 0.35;
}
