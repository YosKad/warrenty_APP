#!/usr/bin/env node
/**
 * Israel corpus pilot — measurement harness.
 *
 * Runs a test suite through `probe_resolution` and scores it with the real
 * `@mw/domain` evaluator, so the numbers in docs/ISRAEL_CORPUS_PILOT.md come
 * out of the same code the app runs rather than out of a spreadsheet somebody
 * filled in by hand.
 *
 * It talks to PostgreSQL through `psql` on purpose: the console already proves
 * the Supabase path works, and this script needs to run against a throwaway
 * local database without adding a driver dependency to the repo.
 *
 *   node scripts/pilot-measure.mjs --db mw --host /tmp --port 5439
 *
 * Add `--ablate` to re-measure with parts of the chain withheld, which is what
 * turns "the rate is 75%" into "the rate is 75% and the last 25% is contacts".
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Bundled by esbuild before it runs (`npm run pilot`), because the shared
// package uses extensionless imports for the bundlers the apps actually use.
import {
  evaluateResolution,
  rankCandidates,
  rankFailureReasons,
  resolveModel,
  resolutionRates,
} from '../packages/domain/src/index.ts';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg.startsWith('--')) {
    const next = process.argv[i + 1];
    if (next && !next.startsWith('--')) {
      args.set(arg.slice(2), next);
      i += 1;
    } else {
      args.set(arg.slice(2), true);
    }
  }
}

const DB = args.get('db') ?? 'mw';
const HOST = args.get('host') ?? '/tmp';
const PORT = args.get('port') ?? '5439';
const USER = args.get('user') ?? 'postgres';

function sql(query) {
  const out = execFileSync(
    'psql',
    ['-h', HOST, '-p', String(PORT), '-U', USER, '-d', DB, '-tAqc', query],
    { encoding: 'utf8' },
  );
  return out.trim();
}

/** The demo corpus is what the pilot measures, so the probe has to see it. */
const DEMO_ON = "set app.include_demo_data = 'on'; ";

// Read from the repository root, which is where `npm run pilot` runs from —
// the bundled script does not live next to this file.
const suite = JSON.parse(readFileSync('scripts/pilot-cases.json', 'utf8'));

/**
 * Withholding one layer at a time.
 *
 * The ablations run inside a transaction that is rolled back, so the corpus is
 * unchanged afterwards. Each one answers "what would the rate be if we had not
 * done this part", which is the only way to say what a part is worth.
 */
const ABLATIONS = {
  full: null,
  'no-contacts': "update provider_contact_methods set publication_status = 'candidate';",
  'no-relationships': "update organisation_relationships set publication_status = 'candidate';",
  'no-clauses': "update warranty_terms set publication_status = 'candidate';",
  // What the corpus was before Phase I.5: policy patterns and nothing else.
  'no-model-corpus':
    "update product_models set publication_status = 'candidate';" +
    "update model_aliases set publication_status = 'candidate';",
  'policies-only':
    "update provider_contact_methods set publication_status = 'candidate';" +
    "update service_locations set publication_status = 'candidate';" +
    "update service_capabilities set publication_status = 'candidate';",
};

/**
 * The model corpus for a brand, so the harness can run the staged matcher
 * exactly as the console and the app do rather than relying on the SQL
 * pattern check alone.
 */
function probeModels(testCase, setup) {
  const query =
    'begin; ' +
    DEMO_ON +
    (setup ?? '') +
    ` select probe_models(${lit(testCase.brandName)}, ${lit(testCase.countryCode)});` +
    ' rollback;';
  const line = sql(query).split('\n').filter(Boolean).pop();
  return JSON.parse(line);
}

/**
 * Policies reachable through a resolved model, which is the Phase I.5 path.
 *
 * The old `probe_resolution` finds policies by `model_pattern`; this one finds
 * them by `model_id`, which is how "MacBook Air M4" reaches terms that a `M4%`
 * pattern could never match.
 */
function probePoliciesForModel(modelId, testCase, setup) {
  const query =
    'begin; ' +
    DEMO_ON +
    (setup ?? '') +
    ` select probe_policies_for_model(${lit(modelId)}, ${lit(testCase.countryCode)},` +
    ` ${lit(testCase.purchaseDate)}, null);` +
    ' rollback;';
  const line = sql(query).split('\n').filter(Boolean).pop();
  return JSON.parse(line);
}

function probe(testCase, setup) {
  const query =
    'begin; ' +
    DEMO_ON +
    (setup ?? '') +
    ` select probe_resolution(${lit(testCase.brandName)}, ${lit(testCase.model)}, null,` +
    ` ${lit(testCase.countryCode)}, ${lit(testCase.purchaseDate)}, ${lit(testCase.importerName)});` +
    ' rollback;';
  const raw = sql(query);
  const line = raw.split('\n').filter(Boolean).pop();
  return JSON.parse(line);
}

function lit(value) {
  if (value === null || value === undefined) return 'null';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function evaluate(testCase, found, corpus, setup) {
  // Phase I.5: the staged matcher decides whether the product was identified.
  // Passing it in is what turns "model_unknown" into a reason somebody can act
  // on — and what makes the MacBook Air M4 case resolve at all.
  const modelResolution = resolveModel(testCase.model ?? '', corpus.models ?? [], {
    patterns: corpus.patterns ?? [],
    ...(corpus.brand ? { brands: [corpus.brand.name] } : {}),
  });

  // When the model resolved, the policies come from the model link. The pattern
  // path stays as the fallback for a corpus that has no models yet.
  const viaModel = modelResolution.resolved?.model
    ? probePoliciesForModel(modelResolution.resolved.model.id, testCase, setup)
    : null;

  const candidates =
    viaModel && (viaModel.candidates ?? []).length > 0
      ? viaModel.candidates
      : (found.candidates ?? []);
  const providers =
    viaModel && (viaModel.candidates ?? []).length > 0
      ? (viaModel.providers ?? {})
      : (found.providers ?? {});

  const leader = candidates.length > 0 ? rankCandidates(candidates)[0] : null;
  const facts = leader ? providers[leader.warrantyId] : undefined;

  return evaluateResolution({
    modelResolution,
    brandName: testCase.brandName,
    model: testCase.model,
    categoryKnown: true,
    countryCode: testCase.countryCode,
    purchaseDate: testCase.purchaseDate,
    brandResolvedToOrganisation: found.brandResolvedToOrganisation,
    modelRecognised: found.modelRecognised,
    candidates,
    policyCountryCode: leader?.countryCode ?? null,
    importerKnown: found.importerKnown,
    warrantyProviderKnown: facts?.warrantyProviderKnown ?? false,
    serviceProviderKnown: facts?.serviceProviderKnown ?? false,
    serviceOptionKnown: facts?.serviceOptionKnown ?? false,
    actionableContactCount: facts?.actionableContactCount ?? 0,
    contactVerifiedAt: facts?.contactVerifiedAt ?? null,
  });
}

function pct(value) {
  return `${(value * 100).toFixed(0)}%`;
}

// ---- corpus shape ---------------------------------------------------------

const shape = JSON.parse(
  sql(`${DEMO_ON} select jsonb_pretty(jsonb_build_object(
    'organisations', (select count(*) from organisations where data_environment = 'demo'),
    'relationships', (select count(*) from organisation_relationships where data_environment = 'demo'),
    'policies',      (select count(*) from warranties where data_environment = 'demo'),
    'clauses',       (select count(*) from warranty_terms where data_environment = 'demo'),
    'contacts',      (select count(*) from provider_contact_methods where data_environment = 'demo'),
    'locations',     (select count(*) from service_locations where data_environment = 'demo'),
    'capabilities',  (select count(*) from service_capabilities where data_environment = 'demo')
  ))`).split('SET\n').pop(),
);

console.log('\n=== Corpus shape (pilot fixtures) ===');
for (const [key, value] of Object.entries(shape)) {
  console.log(`  ${key.padEnd(16)} ${value}`);
}
console.log(`  ${'total records'.padEnd(16)} ${Object.values(shape).reduce((a, b) => a + b, 0)}`);

// ---- the suite ------------------------------------------------------------

const variants = args.has('ablate') ? Object.keys(ABLATIONS) : ['full'];
const table = [];

for (const variant of variants) {
  const started = Date.now();
  const outcomes = suite.map((testCase) =>
    evaluate(
      testCase,
      probe(testCase, ABLATIONS[variant]),
      probeModels(testCase, ABLATIONS[variant]),
      ABLATIONS[variant],
    ),
  );
  const rates = resolutionRates(outcomes);
  const elapsed = Date.now() - started;

  table.push({ variant, rates, elapsed, outcomes });

  if (variant === 'full') {
    console.log(`\n=== Case by case (${suite.length} cases) ===`);
    suite.forEach((testCase, index) => {
      const outcome = outcomes[index];
      const marks = [
        outcome.stages.product_identified,
        outcome.stages.warranty_resolved,
        outcome.stages.provider_resolved,
        outcome.stages.service_route_resolved,
        outcome.stages.contact_actionable,
      ]
        .map((passed) => (passed ? '#' : '.'))
        .join('');
      console.log(
        `  ${marks}  ${testCase.label.padEnd(34)} ${
          outcome.failureReasons.join(', ') || 'fully resolved'
        }`,
      );
    });

    console.log('\n=== Why cases fail ===');
    for (const { reason, count } of rankFailureReasons(outcomes)) {
      console.log(`  ${String(count).padStart(3)}  ${reason}`);
    }
  }
}

console.log('\n=== Full Resolution Rate ===');
console.log('  variant            product  warranty  provider  route   FULL   AUTO  AMBIG    ms');
for (const row of table) {
  console.log(
    `  ${row.variant.padEnd(18)} ${pct(row.rates.productIdentificationRate).padStart(6)}` +
      `  ${pct(row.rates.warrantyResolutionRate).padStart(7)}` +
      `  ${pct(row.rates.providerResolutionRate).padStart(7)}` +
      `  ${pct(row.rates.serviceRouteResolutionRate).padStart(6)}` +
      `  ${pct(row.rates.fullResolutionRate).padStart(5)}` +
      `  ${pct(row.rates.autoResolutionRate).padStart(5)}` +
      `  ${pct(row.rates.ambiguityRate).padStart(5)}` +
      `  ${String(row.elapsed).padStart(5)}`,
  );
}
console.log();
