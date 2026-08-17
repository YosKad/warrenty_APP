'use server';

import {
  evaluateResolution,
  rankCandidates,
  resolveModel,
  resolveOrganisation,
  type CanonicalModel,
  type ModelResolution,
  type OrganisationRecord,
  type PatternRule,
  type PolicyCandidate,
  type ResolutionOutcome,
} from '@mw/domain';

import { requireAdmin } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';

/**
 * The Model Resolver, and the staged resolution behind the tester.
 *
 * The database supplies the corpus; `@mw/domain` decides. Keeping the decision
 * in one place is what makes the console's answer, the app's answer and the
 * tester's answer the same answer — and it is why this file reads like glue
 * rather than like logic.
 */

export type ModelProbe = {
  brand: { id: string; name: string } | null;
  models: CanonicalModel[];
  patterns: PatternRule[];
};

export type StageReport = {
  stage:
    | 'product'
    | 'model'
    | 'warranty'
    | 'importer'
    | 'warranty_provider'
    | 'service_provider'
    | 'contact'
    | 'full_resolution';
  state: 'resolved' | 'ambiguous' | 'missing';
  /** What was matched, when something was. */
  record: string | null;
  /** Where that record came from. */
  source: string | null;
  /** Why — never a bare score. */
  why: string[];
  latencyMs: number;
};

export type ResolveModelResult =
  | {
      ok: true;
      resolution: ModelResolution;
      probe: ModelProbe;
      policies: PolicyCandidate[];
      latencyMs: number;
    }
  | { ok: false; error: string };

async function loadModelProbe(
  brandName: string,
  countryCode: string | null,
): Promise<ModelProbe> {
  const supabase = await supabaseServer();
  const { data } = await supabase.rpc('probe_models', {
    p_brand_name: brandName || null,
    p_country_code: countryCode || null,
  });

  const payload = (data ?? {}) as {
    brand: { id: string; name: string } | null;
    models: CanonicalModel[];
    patterns: PatternRule[];
  };

  return {
    brand: payload.brand ?? null,
    models: payload.models ?? [],
    patterns: payload.patterns ?? [],
  };
}

/**
 * Everything the resolver knows about one raw model string.
 *
 * Built for two audiences at once: an operator checking whether the corpus can
 * recognise a product they are about to research, and whoever is debugging why
 * a photographed receipt produced nothing.
 */
export async function resolveModelString(input: {
  brandName: string;
  model: string;
  countryCode: string;
  purchaseDate: string | null;
  importerName: string | null;
}): Promise<ResolveModelResult> {
  await requireAdmin();
  const started = Date.now();

  if (!input.model.trim()) return { ok: false, error: 'Enter a model to resolve.' };

  const probe = await loadModelProbe(input.brandName, input.countryCode);
  const resolution = resolveModel(input.model, probe.models, {
    patterns: probe.patterns,
    ...(probe.brand ? { brands: [probe.brand.name] } : {}),
  });

  let policies: PolicyCandidate[] = [];
  if (resolution.resolved?.model) {
    const supabase = await supabaseServer();
    const importerId = input.importerName
      ? await organisationIdFor(input.importerName, input.countryCode)
      : null;

    const { data } = await supabase.rpc('probe_policies_for_model', {
      p_model_id: resolution.resolved.model.id,
      p_country_code: input.countryCode || null,
      p_purchase_date: input.purchaseDate,
      p_importer_id: importerId,
    });
    policies = ((data as { candidates?: PolicyCandidate[] })?.candidates ?? []) as PolicyCandidate[];
  }

  return {
    ok: true,
    resolution,
    probe,
    policies,
    latencyMs: Date.now() - started,
  };
}

async function organisationIdFor(
  name: string,
  countryCode: string | null,
): Promise<string | null> {
  const supabase = await supabaseServer();
  const { data } = await supabase.rpc('resolve_receipt_names', {
    p_names: [name],
    p_country_code: countryCode || null,
  });

  const resolution = resolveOrganisation(name, (data ?? []) as OrganisationRecord[], {
    countryCode,
  });
  return resolution.resolved?.organisation.id ?? null;
}

export type StagedRunResult =
  | { ok: true; stages: StageReport[]; outcome: ResolutionOutcome; totalMs: number }
  | { ok: false; error: string };

/**
 * One case, reported stage by stage.
 *
 * Each stage says resolved / ambiguous / missing, what it matched, where that
 * came from, why, and how long it took. The brief asked for exactly that and it
 * is the right shape: a single score tells an operator nothing about which
 * table to go and fill in.
 */
export async function runStagedResolution(input: {
  brandName: string;
  model: string;
  countryCode: string;
  purchaseDate: string | null;
  importerName: string | null;
  retailerName: string | null;
  serialNumber: string | null;
}): Promise<StagedRunResult> {
  await requireAdmin();
  const supabase = await supabaseServer();
  const startedAll = Date.now();
  const stages: StageReport[] = [];

  const time = async <T>(fn: () => Promise<T> | T): Promise<[T, number]> => {
    const started = Date.now();
    const value = await fn();
    return [value, Date.now() - started];
  };

  // ---- product / brand ----------------------------------------------------
  const [brandProbe, brandMs] = await time(() =>
    loadModelProbe(input.brandName, input.countryCode),
  );

  stages.push({
    stage: 'product',
    state: brandProbe.brand ? 'resolved' : 'missing',
    record: brandProbe.brand?.name ?? null,
    source: brandProbe.brand ? 'organisations' : null,
    why: brandProbe.brand
      ? [`“${input.brandName}” is a published organisation`]
      : [`No published organisation is named “${input.brandName}”`],
    latencyMs: brandMs,
  });

  // ---- model --------------------------------------------------------------
  const [modelResolution, modelMs] = await time(() =>
    resolveModel(input.model, brandProbe.models, {
      patterns: brandProbe.patterns,
      ...(brandProbe.brand ? { brands: [brandProbe.brand.name] } : {}),
    }),
  );

  stages.push({
    stage: 'model',
    state:
      modelResolution.state === 'resolved'
        ? 'resolved'
        : modelResolution.state === 'ambiguous'
          ? 'ambiguous'
          : 'missing',
    record:
      modelResolution.resolved?.model?.canonicalModel ??
      (modelResolution.resolved?.warrantyId ? 'a policy pattern' : null),
    source: modelResolution.resolved
      ? `stage ${modelResolution.resolved.stage}`
      : brandProbe.models.length === 0
        ? 'no models recorded for this brand'
        : null,
    why: [
      ...modelResolution.explanation,
      ...(modelResolution.state === 'ambiguous'
        ? [`Ask for: ${modelResolution.distinguishers.join(', ')}`]
        : []),
    ],
    latencyMs: modelMs,
  });

  // ---- policies -----------------------------------------------------------
  const importerId = input.importerName
    ? await organisationIdFor(input.importerName, input.countryCode)
    : null;

  let candidates: PolicyCandidate[] = [];
  let policyMs = 0;
  let policyImporterId: string | null = null;

  if (modelResolution.resolved?.model) {
    const [payload, ms] = await time(async () => {
      const { data } = await supabase.rpc('probe_policies_for_model', {
        p_model_id: modelResolution.resolved!.model!.id,
        p_country_code: input.countryCode || null,
        p_purchase_date: input.purchaseDate,
        p_importer_id: importerId,
      });
      return data as { candidates?: (PolicyCandidate & { importerId?: string })[] } | null;
    });
    policyMs = ms;
    candidates = (payload?.candidates ?? []) as PolicyCandidate[];
    policyImporterId =
      (payload?.candidates ?? []).find((row) => row.importerId)?.importerId ?? null;
  }

  const leader = candidates.length > 0 ? rankCandidates(candidates)[0]! : null;

  stages.push({
    stage: 'warranty',
    state: leader ? 'resolved' : 'missing',
    record: leader ? `${leader.durationMonths ?? '?'} months` : null,
    source: leader?.policyVersion ?? null,
    why: leader
      ? [`${candidates.length} eligible polic${candidates.length === 1 ? 'y' : 'ies'} for this model`]
      : modelResolution.state === 'resolved'
        ? ['The model is known and no published policy covers it']
        : ['No model, so no policy'],
    latencyMs: policyMs,
  });

  // ---- provider chain -----------------------------------------------------
  const [reach, reachMs] = await time(async () => {
    if (!leader) return null;
    const { data } = await supabase.rpc('probe_policies_for_model', {
      p_model_id: modelResolution.resolved!.model!.id,
      p_country_code: input.countryCode || null,
      p_purchase_date: input.purchaseDate,
      p_importer_id: importerId,
    });
    const providers = (data as { providers?: Record<string, ProviderFacts> })?.providers ?? {};
    return providers[leader.warrantyId] ?? null;
  });

  stages.push({
    stage: 'importer',
    state: importerId || policyImporterId ? 'resolved' : 'missing',
    record: input.importerName ?? (policyImporterId ? 'named by the policy' : null),
    source: importerId ? 'the receipt' : policyImporterId ? 'the policy' : null,
    why:
      importerId && policyImporterId && importerId !== policyImporterId
        ? ['The receipt and the policy name different importers — likely a grey import']
        : importerId || policyImporterId
          ? ['An importer is established for this product']
          : ['Nothing establishes who imported this'],
    latencyMs: 0,
  });

  stages.push({
    stage: 'warranty_provider',
    state: reach?.warrantyProviderKnown ? 'resolved' : 'missing',
    record: leader?.providerName ?? null,
    source: leader ? 'the resolved policy' : null,
    why: reach?.warrantyProviderKnown
      ? ['The policy names the company that honours it']
      : ['No company is recorded as honouring this policy'],
    latencyMs: reachMs,
  });

  stages.push({
    stage: 'service_provider',
    state: reach?.serviceProviderKnown ? (reach.serviceOptionKnown ? 'resolved' : 'ambiguous') : 'missing',
    record: null,
    source: reach?.serviceProviderKnown ? 'organisation_relationships or a branch' : null,
    why: !reach?.serviceProviderKnown
      ? ['Nobody is recorded as repairing this brand in this country']
      : reach.serviceOptionKnown
        ? ['A capability or a branch covers this product']
        : ['The repairer is known but nothing says what they can do'],
    latencyMs: 0,
  });

  stages.push({
    stage: 'contact',
    state: (reach?.actionableContactCount ?? 0) > 0 ? 'resolved' : 'missing',
    record: reach ? `${reach.actionableContactCount} actionable` : null,
    source: 'provider_contact_methods',
    why:
      (reach?.actionableContactCount ?? 0) > 0
        ? [`Last confirmed ${reach?.contactVerifiedAt?.slice(0, 10) ?? 'never'}`]
        : ['No phone, form, chat or mail address a person could use'],
    latencyMs: 0,
  });

  const outcome = evaluateResolution({
    brandName: input.brandName || null,
    model: input.model || null,
    categoryKnown: true,
    countryCode: input.countryCode || null,
    purchaseDate: input.purchaseDate,
    brandResolvedToOrganisation: brandProbe.brand !== null,
    modelRecognised: modelResolution.state === 'resolved',
    modelResolution,
    candidates,
    policyCountryCode: leader ? ((leader as { countryCode?: string }).countryCode ?? null) : null,
    importerKnown: Boolean(importerId ?? policyImporterId),
    receiptImporterId: importerId,
    policyImporterId,
    warrantyProviderKnown: reach?.warrantyProviderKnown ?? false,
    serviceProviderKnown: reach?.serviceProviderKnown ?? false,
    serviceOptionKnown: reach?.serviceOptionKnown ?? false,
    actionableContactCount: reach?.actionableContactCount ?? 0,
    contactVerifiedAt: reach?.contactVerifiedAt ?? null,
  });

  stages.push({
    stage: 'full_resolution',
    state: outcome.fullyResolved ? 'resolved' : outcome.ambiguous ? 'ambiguous' : 'missing',
    record: outcome.fullyResolved ? 'the user gets an answer they can act on' : null,
    source: null,
    why:
      outcome.failureReasons.length === 0
        ? ['All five stages cleared']
        : outcome.failureReasons.map((reason) => reason.replace(/_/g, ' ')),
    latencyMs: Date.now() - startedAll,
  });

  return { ok: true, stages, outcome, totalMs: Date.now() - startedAll };
}

type ProviderFacts = {
  warrantyProviderKnown: boolean;
  serviceProviderKnown: boolean;
  serviceOptionKnown: boolean;
  actionableContactCount: number;
  contactVerifiedAt: string | null;
};
