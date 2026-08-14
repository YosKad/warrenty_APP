import { z } from 'npm:zod@4';

import { errorResponse, handlePreflight, jsonResponse } from '../_shared/cors.ts';
import { requireUser, serviceClient, userClient } from '../_shared/supabase.ts';

/**
 * Warranty match resolution.
 *
 * Runs the eligible-policy query, scores it, and persists the result to
 * `product_warranty_matches`. No model is involved anywhere in this function —
 * which policy applies to your television is a question with a determinate
 * answer, and a determinate answer should not be produced by something that can
 * hallucinate.
 *
 * It exists as an Edge Function rather than client code for one reason: the
 * match row is written with the service role. A client that could write its own
 * match could make the app assert a warranty that does not exist — to its own
 * user, which is the entire product.
 *
 * The scoring below is a transcription of `src/domain/warrantyIntelligence.ts`.
 * The weights are stated once in each language and pinned by tests on the
 * TypeScript side; if you change one, change both.
 */

const RESOLVER_VERSION = 'g1';

const requestSchema = z.object({
  productId: z.string().uuid(),
});

const SIGNAL_WEIGHTS = {
  model: 22,
  brand: 14,
  country: 14,
  importer: 14,
  serial: 10,
  validity: 10,
  category: 8,
  officialSource: 8,
} as const;

const STRONG_THRESHOLD = 60;
const CONFIRM_THRESHOLD = 30;
const VERIFIED_THRESHOLD = 75;
const CONFLICT_SCORE_MARGIN = 15;

const SOURCE_PRIORITY: Record<string, number> = {
  manufacturer: 1,
  internal_db: 2,
  retailer: 3,
  document_extraction: 4,
  user_entered: 5,
  ai_inferred: 6,
};

type CandidateRow = {
  warranty_id: string;
  duration_months: number | null;
  verification: string;
  confidence: string;
  source_kind: string;
  provider_id: string | null;
  policy_version: string | null;
  matched_brand: boolean;
  matched_model: boolean;
  matched_category: boolean;
  matched_country: boolean;
  matched_importer: boolean;
  matched_retailer: boolean;
  matched_serial: boolean;
  within_validity: boolean;
};

Deno.serve(async (request: Request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const user = await requireUser(request);
  if (!user) return errorResponse('unauthenticated');

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse('validation');
  const { productId } = parsed.data;

  const asUser = userClient(request);
  const admin = serviceClient();

  // Ownership through the user client, so RLS is the barrier rather than this
  // comparison alone.
  const { data: product, error: productError } = await asUser
    .from('products')
    .select('id, owner_id')
    .eq('id', productId)
    .is('deleted_at', null)
    .single();

  if (productError || !product) return errorResponse('not_found');
  if (product.owner_id !== user.id) return errorResponse('forbidden');

  const { data: rows } = await admin.rpc('match_warranty_policies', {
    p_product_id: productId,
  });

  const candidates = ((rows ?? []) as CandidateRow[]).map((row) => ({
    row,
    signals: signalsFor(row),
    score: scoreOf(signalsFor(row)),
  }));

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (
      (SOURCE_PRIORITY[a.row.source_kind] ?? 9) - (SOURCE_PRIORITY[b.row.source_kind] ?? 9)
    );
  });

  const leader = candidates[0] ?? null;
  const conflicts = leader ? findConflicts(leader, candidates.slice(1)) : [];

  const payload = {
    product_id: productId,
    owner_id: user.id,
    warranty_id: leader?.row.warranty_id ?? null,
    match_score: leader?.score ?? 0,
    match_state: leader ? stateFor(leader.score, leader.row.verification) : 'unknown',
    signals: leader?.signals ?? {},
    has_conflict: conflicts.length > 0,
    conflict_summary: conflicts,
    candidate_ids: candidates.map((c) => c.row.warranty_id),
    resolved_at: new Date().toISOString(),
    resolver_version: RESOLVER_VERSION,
  };

  await admin
    .from('product_warranty_matches')
    .upsert(payload, { onConflict: 'product_id' });

  // Pin the resolved policy onto the product so historical analyses keep
  // pointing at the terms that applied — but only when nothing is pinned yet.
  // Silently re-pointing a product at newer terms is exactly what item 22 of the
  // brief forbids.
  if (leader) {
    await admin
      .from('products')
      .update({ warranty_id: leader.row.warranty_id })
      .eq('id', productId)
      .is('warranty_id', null);
  }

  return jsonResponse({
    warrantyId: payload.warranty_id,
    matchScore: payload.match_score,
    matchState: payload.match_state,
    hasConflict: payload.has_conflict,
    resolvedAt: payload.resolved_at,
  });
});

function signalsFor(row: CandidateRow): Record<string, boolean> {
  return {
    model: row.matched_model,
    brand: row.matched_brand,
    country: row.matched_country,
    importer: row.matched_importer,
    serial: row.matched_serial,
    validity: row.within_validity,
    category: row.matched_category,
    officialSource: row.verification === 'official' || row.verification === 'verified',
  };
}

function scoreOf(signals: Record<string, boolean>): number {
  let total = 0;
  for (const [key, weight] of Object.entries(SIGNAL_WEIGHTS)) {
    if (signals[key]) total += weight;
  }
  return total;
}

function stateFor(score: number, verification: string): string {
  const checked = verification === 'official' || verification === 'verified';
  if (checked && score >= VERIFIED_THRESHOLD) return 'verified';
  if (score >= STRONG_THRESHOLD) return 'strong';
  if (score >= CONFIRM_THRESHOLD) return 'needs_confirmation';
  return 'unknown';
}

type Scored = { row: CandidateRow; signals: Record<string, boolean>; score: number };

/**
 * A disagreement only counts when the evidence is comparable. A specific policy
 * beating a generic one is specificity working, not a coin toss the user has to
 * arbitrate.
 */
function findConflicts(leader: Scored, others: Scored[]) {
  const conflicts: {
    field: string;
    chosen: string;
    alternative: string;
    chosenWarrantyId: string;
    alternativeWarrantyId: string;
  }[] = [];

  for (const other of others) {
    if (leader.score - other.score > CONFLICT_SCORE_MARGIN) continue;
    if (dominates(leader.row, other.row)) continue;

    if (
      leader.row.duration_months !== null &&
      other.row.duration_months !== null &&
      leader.row.duration_months !== other.row.duration_months &&
      !conflicts.some((c) => c.field === 'duration_months')
    ) {
      conflicts.push({
        field: 'duration_months',
        chosen: String(leader.row.duration_months),
        alternative: String(other.row.duration_months),
        chosenWarrantyId: leader.row.warranty_id,
        alternativeWarrantyId: other.row.warranty_id,
      });
    }

    if (
      leader.row.provider_id &&
      other.row.provider_id &&
      leader.row.provider_id !== other.row.provider_id &&
      !conflicts.some((c) => c.field === 'warranty_provider')
    ) {
      conflicts.push({
        field: 'warranty_provider',
        chosen: leader.row.provider_id,
        alternative: other.row.provider_id,
        chosenWarrantyId: leader.row.warranty_id,
        alternativeWarrantyId: other.row.warranty_id,
      });
    }
  }

  return conflicts;
}

/** Only a guess arguing with a document, or an unchecked record arguing with a
 *  verified one, is silenced. Source tier alone must not settle it. */
function dominates(leader: CandidateRow, other: CandidateRow): boolean {
  if (other.source_kind === 'ai_inferred' && leader.source_kind !== 'ai_inferred') {
    return true;
  }
  const leaderChecked =
    leader.verification === 'official' || leader.verification === 'verified';
  const otherUnchecked =
    other.verification === 'unverified' || other.verification === 'ai_extracted';
  return leaderChecked && otherUnchecked;
}
