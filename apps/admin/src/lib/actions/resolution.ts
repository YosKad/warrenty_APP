'use server';

import { revalidatePath } from 'next/cache';
import {
  evaluateResolution,
  rankCandidates,
  type PolicyCandidate,
  type ResolutionInput,
  type ResolutionOutcome,
} from '@mw/domain';

import { requireAdmin } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';

/**
 * The resolution tester.
 *
 * Runs a hypothetical product through the corpus and records what came back.
 * The probe reads the database; `evaluateResolution` decides — the same
 * function the rest of the system reasons with, so the KPI measures the
 * resolver rather than a friendlier copy of it.
 *
 * Every run is stored, including the failures. A KPI you can only see the
 * current value of is a KPI nobody can tell a story about.
 */

export type TestCase = {
  label: string;
  brandName: string;
  model: string;
  countryCode: string;
  purchaseDate: string | null;
  importerName: string | null;
  retailerName: string | null;
};

export type RunResult = {
  label: string;
  outcome: ResolutionOutcome;
};

export type ResolutionActionResult =
  | { ok: true; results: RunResult[] }
  | { ok: false; error: string };

type ProbeShape = {
  brandResolvedToOrganisation: boolean;
  modelRecognised: boolean;
  candidates: (PolicyCandidate & { countryCode: string | null })[];
  providers: Record<
    string,
    {
      warrantyProviderKnown: boolean;
      serviceProviderKnown: boolean;
      serviceOptionKnown: boolean;
      actionableContactCount: number;
      contactVerifiedAt: string | null;
    }
  >;
  importerKnown: boolean;
};

export async function runResolutionSuite(
  suite: string,
  synthetic: boolean,
  cases: TestCase[],
): Promise<ResolutionActionResult> {
  const identity = await requireAdmin('viewer');
  if (cases.length === 0) return { ok: false, error: 'Add at least one case.' };
  if (!suite.trim()) return { ok: false, error: 'Name the suite, so runs can be compared.' };

  const supabase = await supabaseServer();
  const results: RunResult[] = [];

  for (const testCase of cases) {
    const started = Date.now();

    const { data, error } = await supabase.rpc('probe_resolution', {
      p_brand_name: testCase.brandName,
      p_model: testCase.model || null,
      p_country_code: testCase.countryCode || null,
      p_purchase_date: testCase.purchaseDate,
      p_importer_name: testCase.importerName,
    });

    if (error) return { ok: false, error: error.message };

    const probe = data as ProbeShape;
    const candidates = probe.candidates ?? [];

    // Provider facts belong to whichever policy wins, and which one wins is a
    // scoring question the domain answers — so the probe returns facts for every
    // candidate and the leader is picked here, after scoring.
    const leaderId = pickLeader(candidates);
    const providerFacts = leaderId
      ? probe.providers?.[leaderId]
      : undefined;

    const input: ResolutionInput = {
      brandName: testCase.brandName || null,
      model: testCase.model || null,
      categoryKnown: true,
      countryCode: testCase.countryCode || null,
      purchaseDate: testCase.purchaseDate,
      brandResolvedToOrganisation: probe.brandResolvedToOrganisation,
      modelRecognised: probe.modelRecognised,
      candidates,
      policyCountryCode:
        candidates.find((candidate) => candidate.warrantyId === leaderId)?.countryCode ?? null,
      importerKnown: probe.importerKnown,
      warrantyProviderKnown: providerFacts?.warrantyProviderKnown ?? false,
      serviceProviderKnown: providerFacts?.serviceProviderKnown ?? false,
      serviceOptionKnown: providerFacts?.serviceOptionKnown ?? false,
      actionableContactCount: providerFacts?.actionableContactCount ?? 0,
      contactVerifiedAt: providerFacts?.contactVerifiedAt ?? null,
    };

    const outcome = evaluateResolution(input);
    results.push({ label: testCase.label, outcome });

    await supabase.from('resolution_runs').insert({
      created_by: identity.userId,
      suite: suite.trim(),
      label: testCase.label,
      brand_name: testCase.brandName,
      model: testCase.model || null,
      country_code: testCase.countryCode || null,
      purchase_date: testCase.purchaseDate,
      retailer_name: testCase.retailerName,
      importer_name: testCase.importerName,
      product_identified: outcome.stages.product_identified,
      warranty_resolved: outcome.stages.warranty_resolved,
      provider_resolved: outcome.stages.provider_resolved,
      service_route_resolved: outcome.stages.service_route_resolved,
      contact_actionable: outcome.stages.contact_actionable,
      matched_warranty_id: outcome.matchedWarrantyId,
      match_score: outcome.matchScore,
      match_state: outcome.matchState,
      failure_reasons: outcome.failureReasons,
      duration_ms: Date.now() - started,
      // Recorded on the run itself, not inferred from the suite's name. A
      // synthetic result that later gets quoted as a real-world accuracy figure
      // is the specific mistake this flag exists to prevent.
      detail: { synthetic, candidateCount: candidates.length },
    });
  }

  revalidatePath('/resolution');
  return { ok: true, results };
}

/**
 * Re-runs a suite against the corpus as it stands now.
 *
 * The inputs come from the most recent run of each labelled case, so a suite is
 * defined by its history rather than by a separate table nobody remembers to
 * update.
 */
export async function rerunSuite(suite: string): Promise<ResolutionActionResult> {
  await requireAdmin('viewer');
  const supabase = await supabaseServer();

  const { data: runs } = await supabase
    .from('resolution_runs')
    .select('label, brand_name, model, country_code, purchase_date, importer_name, retailer_name, detail')
    .eq('suite', suite)
    .order('created_at', { ascending: false })
    .limit(500);

  const seen = new Set<string>();
  const cases: TestCase[] = [];
  let synthetic = false;

  for (const run of runs ?? []) {
    const label = run.label ?? '';
    if (seen.has(label)) continue;
    seen.add(label);
    if ((run.detail as { synthetic?: boolean })?.synthetic) synthetic = true;
    cases.push({
      label,
      brandName: run.brand_name ?? '',
      model: run.model ?? '',
      countryCode: run.country_code ?? '',
      purchaseDate: run.purchase_date,
      importerName: run.importer_name,
      retailerName: run.retailer_name,
    });
  }

  if (cases.length === 0) return { ok: false, error: 'That suite has no recorded cases.' };
  return runResolutionSuite(suite, synthetic, cases);
}

/**
 * The leader, by the same rules the app uses.
 *
 * Imported rather than reimplemented: `rankCandidates` is what decides which
 * policy a user is shown, and a tester that ranked differently would be
 * measuring something nobody experiences.
 */
function pickLeader(candidates: PolicyCandidate[]): string | null {
  if (candidates.length === 0) return null;
  return rankCandidates(candidates)[0]?.warrantyId ?? null;
}
