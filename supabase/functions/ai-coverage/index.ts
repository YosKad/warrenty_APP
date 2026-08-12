import { z } from 'npm:zod@4';

import { errorResponse, handlePreflight, jsonResponse } from '../_shared/cors.ts';
import {
  audit,
  checkRateLimit,
  requireUser,
  serviceClient,
  userClient,
} from '../_shared/supabase.ts';
import {
  UNTRUSTED_CONTENT_RULE,
  boundUserText,
  quoteUntrusted,
  sanitiseUntrusted,
} from '../_shared/prompt-safety.ts';

/**
 * Coverage analysis.
 *
 * The pipeline, cheapest step first — the expensive model is the *last* resort, not
 * the first move:
 *
 *   1. authorise the caller and confirm they own the product
 *   2. check the entitlement and the rate limit
 *   3. resolve the warranty policy that applied at purchase (a plain SQL lookup)
 *   4. embed the user's problem description (small model, ~1k tokens)
 *   5. retrieve the handful of relevant clauses by vector search, inside Postgres
 *   6. send only those clauses to the reasoning model
 *   7. validate the response against a strict schema, then persist it with full
 *      provenance
 *
 * If step 3 finds nothing, we stop and say so. An assessment with no warranty
 * document behind it is a guess, and this product does not ship guesses about
 * whether someone's washing machine is covered.
 */

const PROMPT_VERSION = 'coverage-v1';
const COVERAGE_MODEL = Deno.env.get('COVERAGE_MODEL') ?? 'claude-sonnet-5';

/**
 * The disclaimer is a server-side constant. The model is never asked to produce it,
 * so it cannot soften, shorten or omit the sentence that says this is not a guarantee.
 */
const DISCLAIMER_KEY = 'coverage.disclaimer';

const requestSchema = z.object({
  productId: z.string().uuid(),
  issueDescription: z.string().min(10).max(4000),
  issueCategory: z.string().max(60).optional(),
  attachmentIds: z.array(z.string().uuid()).max(5).default([]),
});

/** What the model is allowed to return. Anything else is discarded. */
const modelOutputSchema = z.object({
  verdict: z.enum([
    'likely_covered',
    'possibly_covered',
    'likely_not_covered',
    'insufficient_information',
  ]),
  confidence: z.number().min(0).max(1),
  summary: z.string().min(1).max(600),
  reasoningSummary: z.string().max(1200).default(''),
  citedClauseIds: z.array(z.string()).max(8).default([]),
  exclusions: z.array(z.string().max(400)).max(8).default([]),
  recommendedAction: z.string().max(600).default(''),
});

const SYSTEM_PROMPT = `
You assess whether a described product fault is likely to fall within a warranty's stated coverage.

${UNTRUSTED_CONTENT_RULE}

Rules you must follow:
- Base your assessment ONLY on the warranty clauses provided. Do not use general knowledge about what warranties usually cover.
- You are not the warranty provider and cannot approve or deny a claim. Never state that something IS covered — the strongest available verdict is "likely_covered".
- Cite the id of every clause you relied on in citedClauseIds. A verdict of likely_covered with no cited clause is invalid.
- If the clauses do not address the described fault, return "insufficient_information".
- Write the summary in plain language for a consumer. No legal jargon, no mention of clauses by number, no hedging filler.
- Respond with a single JSON object matching the requested schema. No prose before or after it.
`.trim();

Deno.serve(async (request: Request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const startedAt = Date.now();

  const user = await requireUser(request);
  if (!user) return errorResponse('unauthenticated');

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse('validation');
  const { productId, issueDescription, issueCategory } = parsed.data;

  const asUser = userClient(request);
  const admin = serviceClient();

  // --- entitlement -------------------------------------------------------
  // Read through the *user* client so RLS confirms the row belongs to them.
  const { data: subscription } = await asUser
    .from('subscriptions')
    .select('plan, status')
    .single();

  const entitled =
    subscription &&
    subscription.plan !== 'free' &&
    ['active', 'in_trial', 'in_grace_period', 'in_billing_retry'].includes(
      subscription.status,
    );
  if (!entitled) return errorResponse('payment_required');

  // --- rate limit --------------------------------------------------------
  // Analyses are the most expensive thing a user can trigger, so this is a real
  // limit rather than a formality.
  const withinLimit = await checkRateLimit(admin, user.id, 'ai_coverage', 20, 60);
  if (!withinLimit) return errorResponse('rate_limited');

  // --- ownership + product facts ----------------------------------------
  // RLS already scopes this to the caller; the explicit ownership check below is a
  // second, independent barrier rather than the only one.
  const { data: product, error: productError } = await asUser
    .from('products')
    .select(
      'id, owner_id, name, model, brand_id, brand_name, category_id, country_code, purchase_date, warranty_id',
    )
    .eq('id', productId)
    .is('deleted_at', null)
    .single();

  if (productError || !product) return errorResponse('not_found');
  if (product.owner_id !== user.id) return errorResponse('forbidden');

  // --- resolve the applicable warranty policy ----------------------------
  const warrantyId = product.warranty_id ?? (await resolvePolicyId(admin, product));
  if (!warrantyId) {
    // No documentation, no assessment. Reported as a distinct outcome so the app can
    // explain the gap instead of showing a low-confidence guess.
    return jsonResponse({
      analysis: {
        verdict: 'insufficient_information',
        confidence: 0,
        summary: '',
        reasoningSummary: '',
        relevantClauses: [],
        exclusions: [],
        recommendedAction: '',
        disclaimer: DISCLAIMER_KEY,
        meta: {
          modelVersion: COVERAGE_MODEL,
          analysedAt: new Date().toISOString(),
          warrantyId: null,
          documentVersion: null,
          groundedInDocuments: false,
        },
      },
    });
  }

  // --- retrieve relevant clauses ----------------------------------------
  const problemText = boundUserText(issueDescription);
  const queryText = issueCategory ? `${issueCategory}: ${problemText}` : problemText;

  const embedding = await embed(queryText);
  const clauses = embedding
    ? await matchClauses(admin, warrantyId, embedding)
    : await fallbackClauses(admin, warrantyId);

  if (clauses.length === 0) {
    return jsonResponse({
      analysis: buildEmptyAnalysis(warrantyId),
    });
  }

  // --- reason over only the retrieved clauses ----------------------------
  const userMessage = buildUserMessage(product, problemText, issueCategory, clauses);
  const modelResult = await callModel(userMessage);
  if (!modelResult) return errorResponse('server');

  const validated = modelOutputSchema.safeParse(modelResult.output);
  if (!validated.success) {
    // Unparseable output is a failure, not something to partially render.
    await audit(admin, {
      actorId: user.id,
      action: 'ai.coverage.invalid_output',
      entityType: 'product',
      entityId: productId,
      metadata: { promptVersion: PROMPT_VERSION },
    });
    return errorResponse('server');
  }

  const output = validated.data;

  // Only clauses that were actually retrieved may be cited. A model that invents a
  // clause id gets it dropped rather than shown as a source.
  const citedClauses = clauses.filter((clause) =>
    output.citedClauseIds.includes(clause.id),
  );

  // The same demotion rule the client applies, enforced here too so it holds even if
  // a future client forgets it.
  const verdict =
    output.verdict === 'likely_covered' && citedClauses.length === 0
      ? 'possibly_covered'
      : output.verdict;
  const confidence =
    verdict !== output.verdict ? Math.min(output.confidence, 0.5) : output.confidence;

  const latencyMs = Date.now() - startedAt;

  // --- persist with full provenance -------------------------------------
  const { data: stored } = await admin
    .from('ai_analyses')
    .insert({
      owner_id: user.id,
      product_id: productId,
      verdict,
      confidence,
      summary: output.summary,
      reasoning_summary: output.reasoningSummary,
      recommended_action: output.recommendedAction,
      exclusions: output.exclusions,
      warranty_id: warrantyId,
      retrieved_term_ids: clauses.map((c) => c.id),
      model_version: COVERAGE_MODEL,
      prompt_version: PROMPT_VERSION,
      input_tokens: modelResult.inputTokens,
      output_tokens: modelResult.outputTokens,
      latency_ms: latencyMs,
      grounded_in_documents: true,
    })
    .select('id')
    .single();

  await bumpUsage(admin, user.id, modelResult);

  return jsonResponse({
    analysisId: stored?.id ?? null,
    analysis: {
      verdict,
      confidence,
      summary: output.summary,
      reasoningSummary: output.reasoningSummary,
      relevantClauses: citedClauses.map((clause) => ({
        clauseId: clause.id,
        section: clause.section,
        // Verbatim from the document. The model summarises; it never rewrites the
        // wording the user is shown as the source.
        excerpt: clause.clause_text.slice(0, 1200),
        relevance: clause.similarity ?? 0.5,
      })),
      exclusions: output.exclusions,
      recommendedAction: output.recommendedAction,
      disclaimer: DISCLAIMER_KEY,
      meta: {
        modelVersion: COVERAGE_MODEL,
        analysedAt: new Date().toISOString(),
        warrantyId,
        documentVersion: null,
        groundedInDocuments: true,
      },
    },
  });
});

// --- helpers ---------------------------------------------------------------

type ProductFacts = {
  name: string;
  model: string | null;
  brand_id: string | null;
  brand_name: string | null;
  category_id: string;
  country_code: string;
  purchase_date: string | null;
};

type Clause = {
  id: string;
  section: string | null;
  clause_text: string;
  clause_type: string;
  similarity?: number;
};

// deno-lint-ignore no-explicit-any
async function resolvePolicyId(admin: any, product: ProductFacts): Promise<string | null> {
  const { data } = await admin.rpc('resolve_warranty_policy', {
    p_brand_id: product.brand_id,
    p_category_id: product.category_id,
    p_model: product.model,
    p_country_code: product.country_code,
    p_purchase_date: product.purchase_date,
  });
  return data?.[0]?.id ?? null;
}

// deno-lint-ignore no-explicit-any
async function matchClauses(admin: any, warrantyId: string, embedding: number[]) {
  const { data } = await admin.rpc('match_warranty_terms', {
    p_warranty_id: warrantyId,
    p_embedding: embedding,
    p_match_count: 6,
  });
  return (data ?? []) as Clause[];
}

/**
 * When embeddings are unavailable, fall back to the policy's exclusion and coverage
 * clauses. Less precise than vector search, but grounded in the real document — which
 * is the property that matters.
 */
// deno-lint-ignore no-explicit-any
async function fallbackClauses(admin: any, warrantyId: string): Promise<Clause[]> {
  const { data } = await admin
    .from('warranty_terms')
    .select('id, section, clause_text, clause_type')
    .eq('warranty_id', warrantyId)
    .in('clause_type', ['coverage', 'exclusion'])
    .order('ordinal', { ascending: true })
    .limit(8);
  return (data ?? []) as Clause[];
}

async function embed(text: string): Promise<number[] | null> {
  const url = Deno.env.get('EMBEDDING_PROVIDER_URL');
  const key = Deno.env.get('EMBEDDING_API_KEY');
  const model = Deno.env.get('EMBEDDING_MODEL');
  if (!url || !key || !model) return null;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, input: text }),
    });
    if (!response.ok) return null;
    const json = await response.json();
    const vector = json?.data?.[0]?.embedding;
    return Array.isArray(vector) ? vector : null;
  } catch {
    return null;
  }
}

function buildUserMessage(
  product: ProductFacts,
  problem: string,
  category: string | undefined,
  clauses: Clause[],
): string {
  const clauseBlock = clauses
    .map(
      (clause) =>
        `[id: ${clause.id}] [${clause.clause_type}] ${clause.section ?? ''}\n${
          sanitiseUntrusted(clause.clause_text, 2000).text
        }`,
    )
    .join('\n\n');

  return [
    `Product: ${product.brand_name ?? ''} ${product.name} ${product.model ?? ''}`.trim(),
    `Country: ${product.country_code}`,
    category ? `Reported issue type: ${category}` : '',
    '',
    'The user describes the fault as follows:',
    // Both the user's text and the clause text are quoted as untrusted. The user is
    // no more privileged than the document here — either could contain injection.
    quoteUntrusted('user problem description', problem),
    '',
    'Relevant warranty clauses:',
    quoteUntrusted('warranty clauses', clauseBlock),
    '',
    'Return a single JSON object with keys: verdict, confidence, summary, reasoningSummary, citedClauseIds, exclusions, recommendedAction.',
  ]
    .filter(Boolean)
    .join('\n');
}

type ModelResult = {
  output: unknown;
  inputTokens: number | null;
  outputTokens: number | null;
};

async function callModel(userMessage: string): Promise<ModelResult | null> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return null;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: COVERAGE_MODEL,
        max_tokens: 1200,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!response.ok) return null;
    const json = await response.json();
    const text: string = json?.content?.[0]?.text ?? '';

    return {
      output: parseJsonLoosely(text),
      inputTokens: json?.usage?.input_tokens ?? null,
      outputTokens: json?.usage?.output_tokens ?? null,
    };
  } catch {
    return null;
  }
}

/** Tolerates a fenced code block; rejects anything that is not JSON. */
function parseJsonLoosely(text: string): unknown {
  const trimmed = text.trim();
  const unfenced = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '')
    : trimmed;
  try {
    return JSON.parse(unfenced);
  } catch {
    return null;
  }
}

function buildEmptyAnalysis(warrantyId: string | null) {
  return {
    verdict: 'insufficient_information',
    confidence: 0,
    summary: '',
    reasoningSummary: '',
    relevantClauses: [],
    exclusions: [],
    recommendedAction: '',
    disclaimer: DISCLAIMER_KEY,
    meta: {
      modelVersion: COVERAGE_MODEL,
      analysedAt: new Date().toISOString(),
      warrantyId,
      documentVersion: null,
      groundedInDocuments: false,
    },
  };
}

/** Per-user monthly usage, for the fair-use limits described in AI.md. */
// deno-lint-ignore no-explicit-any
async function bumpUsage(admin: any, userId: string, result: ModelResult) {
  const periodStart = new Date();
  periodStart.setUTCDate(1);
  const period = periodStart.toISOString().slice(0, 10);

  await admin.rpc('increment_ai_usage', {
    p_owner_id: userId,
    p_period_start: period,
    p_input_tokens: result.inputTokens ?? 0,
    p_output_tokens: result.outputTokens ?? 0,
  });
}
