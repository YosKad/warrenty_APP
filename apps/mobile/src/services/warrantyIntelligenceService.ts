import { supabase } from '@/lib/supabase';
import { toAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type { CalendarDate } from '@/domain/date';
import type { ConfidenceLevel, WarrantySource } from '@/domain/warranty';
import {
  detectConflicts,
  groupClauses,
  intelligenceCompleteness,
  matchState,
  rankCandidates,
  scoreMatch,
  type ClauseType,
  type MatchSignals,
  type OverrideField,
  type PolicyCandidate,
  type ProviderLink,
  type ProviderRole,
  type VerificationState,
  type WarrantyClause,
  type WarrantyIntelligence,
  type WarrantyOverride,
  type WarrantySourceRef,
} from '@/domain/warrantyIntelligence';
import { analyseCoverage, type CoverageOutcome } from './aiCoverageService';

/**
 * WarrantyIntelligenceService.
 *
 * The one place that knows how to turn warranty rows into an answer. Screens
 * consume the typed `WarrantyIntelligence` object and never see a database row;
 * Ask MY will consume the same four capabilities rather than reimplementing
 * them, which is the reason this is a service and not a hook.
 *
 *   getApplicableWarranty(productId)
 *   getCoverageSummary(productId)
 *   getRelevantClauses(productId, issue)
 *   analyzeProblem(productId, issue)
 *
 * Matching itself is a single SQL round trip plus pure scoring — cheap enough to
 * run on demand, which is why it does not depend on the cache being warm. The
 * expensive step, extracting structure from a document, happens once and is
 * persisted; nothing here re-runs it.
 */

// --------------------------------------------------------------------------
// Row shapes, kept private. Nothing below this line escapes to a screen.
// --------------------------------------------------------------------------

type CandidateRow = {
  warranty_id: string;
  duration_months: number | null;
  verification: VerificationState;
  confidence: ConfidenceLevel;
  source_kind: WarrantySource;
  provider_id: string | null;
  policy_version: string | null;
  valid_from: string | null;
  valid_to: string | null;
  matched_brand: boolean;
  matched_model: boolean;
  matched_category: boolean;
  matched_country: boolean;
  matched_importer: boolean;
  matched_retailer: boolean;
  matched_serial: boolean;
  within_validity: boolean;
};

function toSignals(row: CandidateRow): MatchSignals {
  return {
    model: row.matched_model,
    brand: row.matched_brand,
    country: row.matched_country,
    importer: row.matched_importer,
    serial: row.matched_serial,
    category: row.matched_category,
    validity: row.within_validity,
    // An official record is evidence about the match, not only about the policy:
    // a curated row for this exact model is less likely to be a coincidence.
    officialSource: row.verification === 'official' || row.verification === 'verified',
  };
}

// --------------------------------------------------------------------------
// getApplicableWarranty
// --------------------------------------------------------------------------

export async function getApplicableWarranty(
  productId: string,
): Promise<WarrantyIntelligence> {
  try {
    const [{ data: candidateRows, error: matchError }, overrides] = await Promise.all([
      supabase.rpc('match_warranty_policies', { p_product_id: productId }),
      listOverrides(productId),
    ]);
    if (matchError) throw matchError;

    const candidates: PolicyCandidate[] = (candidateRows ?? []).map((row) => ({
      warrantyId: row.warranty_id,
      durationMonths: row.duration_months,
      providerId: row.provider_id,
      providerName: null,
      policyVersion: row.policy_version,
      source: row.source_kind,
      verification: row.verification,
      confidence: row.confidence,
      validFrom: row.valid_from as CalendarDate | null,
      validTo: row.valid_to as CalendarDate | null,
      signals: toSignals(row),
    }));

    const ranked = rankCandidates(candidates);
    // A user who has overridden the policy has settled the question; their choice
    // leads even when our own matching preferred something else.
    const pinned = overrides.find((o) => o.field === 'policy');
    const leader =
      (pinned && ranked.find((c) => c.warrantyId === String(pinned.value))) ?? ranked[0];

    const cached = await readCachedMatch(productId);

    if (!leader) {
      return emptyIntelligence(productId, cached?.resolvedAt ?? null);
    }

    const [policy, clauses] = await Promise.all([
      loadPolicy(leader.warrantyId),
      getRelevantClauses(leader.warrantyId),
    ]);

    const groups = groupClauses(clauses);
    const providerChain = await buildProviderChain(productId, policy, overrides);
    const score = scoreMatch(leader.signals);

    const source = policy?.source ?? null;
    const intelligence: WarrantyIntelligence = {
      productId,
      policy: policy
        ? {
            warrantyId: policy.warrantyId,
            durationMonths: durationWithOverride(policy.durationMonths, overrides),
            policyVersion: policy.policyVersion,
            coverageSummary: policy.coverageSummary,
            exclusionsSummary: policy.exclusionsSummary,
            specialConditionsSummary: policy.specialConditionsSummary,
            validFrom: policy.validFrom,
            validTo: policy.validTo,
          }
        : null,
      providerChain,
      clauses: groups,
      source,
      matchState: matchState(score, leader.verification),
      matchScore: score,
      signals: leader.signals,
      conflicts: detectConflicts(candidates),
      resolvedAt: cached?.resolvedAt ?? null,
      completeness: 0,
    };

    intelligence.completeness = intelligenceCompleteness(intelligence);
    return intelligence;
  } catch (error) {
    throw toAppError(error);
  }
}

function emptyIntelligence(
  productId: string,
  resolvedAt: string | null,
): WarrantyIntelligence {
  // Note what this does *not* do: no category-typical fallback, no "most
  // televisions are 24 months". An unidentified warranty stays unidentified.
  return {
    productId,
    policy: null,
    providerChain: [],
    clauses: {
      covered: [],
      notCovered: [],
      specialConditions: [],
      claimRequirements: [],
      geographic: [],
    },
    source: null,
    matchState: 'unknown',
    matchScore: 0,
    signals: {},
    conflicts: [],
    resolvedAt,
    completeness: 0,
  };
}

// --------------------------------------------------------------------------
// Policy and clauses
// --------------------------------------------------------------------------

type LoadedPolicy = {
  warrantyId: string;
  durationMonths: number | null;
  policyVersion: string | null;
  coverageSummary: string | null;
  exclusionsSummary: string | null;
  specialConditionsSummary: string | null;
  validFrom: CalendarDate | null;
  validTo: CalendarDate | null;
  providerId: string | null;
  importerId: string | null;
  source: WarrantySourceRef | null;
};

async function loadPolicy(warrantyId: string): Promise<LoadedPolicy | null> {
  const { data, error } = await supabase
    .from('warranties')
    .select(
      `id, duration_months, policy_version, coverage_summary, exclusions_summary,
       special_conditions_summary, valid_from, valid_to, warranty_provider_id, importer_id,
       source:source_id ( id, kind, document_title, document_version, source_url,
                          document_id, page_count, retrieved_at, last_verified_at,
                          effective_from, verification )`,
    )
    .eq('id', warrantyId)
    .single();

  if (error || !data) return null;
  const source = firstRelation(data.source);

  return {
    warrantyId: data.id,
    durationMonths: data.duration_months,
    policyVersion: data.policy_version,
    coverageSummary: data.coverage_summary,
    exclusionsSummary: data.exclusions_summary,
    specialConditionsSummary: data.special_conditions_summary,
    validFrom: data.valid_from as CalendarDate | null,
    validTo: data.valid_to as CalendarDate | null,
    providerId: data.warranty_provider_id,
    importerId: data.importer_id,
    source: source
      ? {
          sourceId: source.id,
          kind: source.kind,
          documentTitle: source.document_title,
          documentVersion: source.document_version,
          sourceUrl: source.source_url,
          documentId: source.document_id,
          pageCount: source.page_count,
          retrievedAt: source.retrieved_at,
          lastVerifiedAt: source.last_verified_at,
          effectiveFrom: source.effective_from as CalendarDate | null,
          verification: source.verification,
        }
      : null,
  };
}

/**
 * Every clause of a policy, grouped-ready and without the embedding column —
 * vectors have no client use and shipping them is pure waste.
 */
export async function getRelevantClauses(
  warrantyId: string,
  clauseIds?: string[],
): Promise<WarrantyClause[]> {
  const { data, error } = await supabase.rpc('get_warranty_clauses', {
    p_warranty_id: warrantyId,
  });
  if (error) throw toAppError(error);

  const rows = clauseIds
    ? (data ?? []).filter((row) => clauseIds.includes(row.id))
    : (data ?? []);

  return rows.map((row) => ({
    id: row.id,
    clauseType: row.clause_type as ClauseType,
    title: row.title,
    summary: row.summary,
    sourceText: row.clause_text,
    section: row.section,
    sourceSection: row.source_section,
    sourcePage: row.source_page,
    coverageCategories: row.coverage_categories,
    confidence: row.confidence,
    verification: row.verification,
  }));
}

/** The coverage/exclusion/conditions split, for the "What's covered" screen. */
export async function getCoverageSummary(productId: string) {
  const intelligence = await getApplicableWarranty(productId);
  return {
    clauses: intelligence.clauses,
    policy: intelligence.policy,
    source: intelligence.source,
    matchState: intelligence.matchState,
  };
}

// --------------------------------------------------------------------------
// Provider chain
// --------------------------------------------------------------------------

/**
 * The five roles, as five separate entities.
 *
 * Samsung makes the television, Samline imports it and honours the warranty, and
 * a third company repairs it. Collapsing those into "provider" is how an app
 * ends up telling someone to phone the wrong company, so the chain is assembled
 * role by role and a role we do not know is simply absent.
 */
async function buildProviderChain(
  productId: string,
  policy: LoadedPolicy | null,
  overrides: WarrantyOverride[],
): Promise<ProviderLink[]> {
  const { data: product } = await supabase
    .from('products')
    .select('brand_id, brand_name, importer_id, retailer_id, retailer_name, warranty_provider_id, service_provider_id')
    .eq('id', productId)
    .single();

  if (!product) return [];

  const overrideFor = (field: OverrideField) => overrides.find((o) => o.field === field);

  const wanted: { role: ProviderRole; id: string | null; fallbackName: string | null }[] = [
    { role: 'manufacturer', id: product.brand_id, fallbackName: product.brand_name },
    {
      role: 'importer',
      id: String(overrideFor('importer')?.value ?? product.importer_id ?? '') || null,
      fallbackName: null,
    },
    { role: 'retailer', id: product.retailer_id, fallbackName: product.retailer_name },
    {
      role: 'warranty_provider',
      id:
        String(
          overrideFor('warranty_provider')?.value ??
            product.warranty_provider_id ??
            policy?.providerId ??
            '',
        ) || null,
      fallbackName: null,
    },
    {
      role: 'service_provider',
      id: String(overrideFor('service_provider')?.value ?? product.service_provider_id ?? '') || null,
      fallbackName: null,
    },
  ];

  const ids = wanted.map((w) => w.id).filter((id): id is string => Boolean(id));
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: orgs } = await supabase
      .from('organisations')
      .select('id, name')
      .in('id', ids);
    for (const org of orgs ?? []) names.set(org.id, org.name);
  }

  // Only these three roles are user-correctable, and only those can read as
  // user-provided in the source line.
  const overriddenRoles = new Set<string>(
    overrides
      .filter((o) => ['importer', 'warranty_provider', 'service_provider'].includes(o.field))
      .map((o) => o.field as string),
  );

  return wanted
    .map((entry) => {
      const name = (entry.id ? names.get(entry.id) : null) ?? entry.fallbackName;
      if (!name) return null;
      return {
        role: entry.role,
        organisationId: entry.id,
        name,
        isUserProvided: overriddenRoles.has(entry.role as string),
      } satisfies ProviderLink;
    })
    .filter((link): link is ProviderLink => link !== null);
}

// --------------------------------------------------------------------------
// Overrides
// --------------------------------------------------------------------------

export async function listOverrides(productId: string): Promise<WarrantyOverride[]> {
  const { data, error } = await supabase
    .from('product_warranty_overrides')
    .select('field, value, previous_value, created_at')
    .eq('product_id', productId);

  if (error) {
    // An override table that fails to read must not take the whole warranty
    // section down with it — the matched values are still worth showing.
    logger.warn('warranty overrides unavailable');
    return [];
  }

  return (data ?? []).map((row) => ({
    field: row.field as OverrideField,
    value: row.value as string | number,
    previousValue: (row.previous_value ?? null) as string | number | null,
    createdAt: row.created_at,
  }));
}

export async function saveOverride(input: {
  productId: string;
  ownerId: string;
  field: OverrideField;
  value: string | number;
  previousValue: string | number | null;
  reason?: string;
}): Promise<void> {
  try {
    const { error } = await supabase.from('product_warranty_overrides').upsert(
      {
        product_id: input.productId,
        owner_id: input.ownerId,
        field: input.field,
        value: input.value,
        previous_value: input.previousValue,
        reason: input.reason ?? null,
      },
      { onConflict: 'product_id,field' },
    );
    if (error) throw error;
  } catch (error) {
    throw toAppError(error);
  }
}

function durationWithOverride(
  matched: number | null,
  overrides: WarrantyOverride[],
): number | null {
  const override = overrides.find((o) => o.field === 'duration_months');
  return override ? Number(override.value) : matched;
}

// --------------------------------------------------------------------------
// Cached match
// --------------------------------------------------------------------------

type CachedMatch = {
  warrantyId: string | null;
  resolvedAt: string;
  sourceCheckedAt: string | null;
  resolverVersion: string;
};

/**
 * The persisted match, when the resolver has run. Read for freshness only: the
 * live SQL match is authoritative, so a missing or stale row degrades to "we
 * don't know when this was last checked" rather than to a wrong answer.
 */
async function readCachedMatch(productId: string): Promise<CachedMatch | null> {
  const { data } = await supabase
    .from('product_warranty_matches')
    .select('warranty_id, resolved_at, source_checked_at, resolver_version')
    .eq('product_id', productId)
    .maybeSingle();

  if (!data) return null;
  return {
    warrantyId: data.warranty_id,
    resolvedAt: data.resolved_at,
    sourceCheckedAt: data.source_checked_at,
    resolverVersion: data.resolver_version,
  };
}

/**
 * Asks the resolver to run again and persist a fresh match.
 *
 * The client cannot write `product_warranty_matches` — a client that could write
 * its own match could make the app assert a warranty that does not exist, to its
 * own user. So "search again" is a request, not a write.
 */
export async function refreshWarrantyMatch(productId: string): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke('warranty-resolve', {
      body: { productId },
    });
    if (error) throw error;
  } catch (error) {
    throw toAppError(error);
  }
}

// --------------------------------------------------------------------------
// analyzeProblem
// --------------------------------------------------------------------------

/**
 * Delegates to the coverage Edge Function, which is where the retrieval and the
 * model call belong — the client never sees a clause it was not shown, and never
 * holds an API key.
 *
 * Present here so the four capabilities live behind one interface, which is what
 * stops Ask MY from growing its own copy of this logic later.
 */
export async function analyzeProblem(input: {
  productId: string;
  issueDescription: string;
  issueCategory?: string;
  attachmentIds?: string[];
  /** Answers to a previous round's follow-up questions, keyed by question id. */
  followUpAnswers?: Record<string, string>;
}): Promise<CoverageOutcome> {
  return analyseCoverage(input);
}

/** PostgREST returns an embedded relation as an object or an array by shape. */
function firstRelation<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
