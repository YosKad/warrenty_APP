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
  quoteUntrusted,
  sanitiseUntrusted,
} from '../_shared/prompt-safety.ts';

/**
 * Receipt field extraction.
 *
 * Two stages, cheap before expensive:
 *
 *   1. **Deterministic parsing.** Dates, currency amounts and invoice numbers are
 *      regular enough to pull out with regexes. Anything matched this way is free,
 *      instant and more reliable than a model — so the model never sees those fields
 *      unless the regexes come up empty.
 *   2. **Model extraction.** Only for what stage 1 could not resolve: the product
 *      name, brand and model, which need judgement.
 *
 * Everything returned is a *candidate* with a confidence score. Nothing is written to
 * a product here — the app shows a review screen and the user confirms. That is the
 * rule that keeps a misread date from silently becoming someone's warranty expiry.
 */

const EXTRACTION_MODEL = Deno.env.get('EXTRACTION_MODEL') ?? 'claude-haiku-4-5-20251001';

const requestSchema = z.object({ documentId: z.string().uuid() });

const modelFieldsSchema = z.object({
  productName: z.string().max(160).nullable().default(null),
  brandName: z.string().max(120).nullable().default(null),
  model: z.string().max(120).nullable().default(null),
  retailerName: z.string().max(120).nullable().default(null),
  warrantyDurationMonths: z.number().int().min(1).max(600).nullable().default(null),
});

const SYSTEM_PROMPT = `
You extract structured purchase details from the text of a retail receipt or invoice.

${UNTRUSTED_CONTENT_RULE}

Rules:
- Extract only what is explicitly present in the receipt text. Never infer, complete or guess a value.
- Use null for anything not clearly stated. A null is always better than a plausible invention.
- productName is the item purchased, not the shop name. retailerName is the shop.
- Respond with a single JSON object and nothing else.
`.trim();

Deno.serve(async (request: Request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const user = await requireUser(request);
  if (!user) return errorResponse('unauthenticated');

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse('validation');

  const asUser = userClient(request);
  const admin = serviceClient();

  if (!(await checkRateLimit(admin, user.id, 'ocr', 40, 60))) {
    return errorResponse('rate_limited');
  }

  // RLS scopes this to the caller's own documents.
  const { data: document, error } = await asUser
    .from('product_documents')
    .select('id, owner_id, storage_path, mime_type, extracted_text')
    .eq('id', parsed.data.documentId)
    .is('deleted_at', null)
    .single();

  if (error || !document) return errorResponse('not_found');
  if (document.owner_id !== user.id) return errorResponse('forbidden');

  const { data: job } = await admin
    .from('ocr_jobs')
    .insert({
      owner_id: user.id,
      document_id: document.id,
      status: 'processing',
      provider: Deno.env.get('OCR_PROVIDER_URL') ? 'external' : 'internal',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  const jobId = job?.id ?? crypto.randomUUID();

  const rawText = document.extracted_text ?? (await runOcr(document.storage_path, admin));
  if (!rawText) {
    await admin
      .from('ocr_jobs')
      .update({
        status: 'failed',
        error_code: 'no_text',
        finished_at: new Date().toISOString(),
      })
      .eq('id', jobId);
    return jsonResponse({ jobId, status: 'failed', fields: {}, errorCode: 'no_text' });
  }

  const sanitised = sanitiseUntrusted(rawText);
  if (sanitised.flagged) {
    // Worth knowing about: a receipt containing instruction-shaped text is either an
    // attack or a very strange document. The structural defences still hold.
    await audit(admin, {
      actorId: user.id,
      action: 'ocr.injection_flagged',
      entityType: 'document',
      entityId: document.id,
      metadata: { matchedPatterns: sanitised.matchedPatterns },
    });
  }

  // Stage 1 — deterministic.
  const deterministic = extractDeterministic(sanitised.text);

  // Stage 2 — model, only for what remains.
  const needsModel =
    !deterministic.productName || !deterministic.retailerName || !deterministic.brandName;
  const modelFields = needsModel ? await extractWithModel(sanitised.text) : null;

  const fields = mergeFields(deterministic, modelFields);

  // Cache the extracted text on the document so a retry, or a later coverage
  // analysis, does not re-run OCR. It is personal data and is never logged.
  await admin
    .from('product_documents')
    .update({ extracted_text: sanitised.text, extracted_at: new Date().toISOString() })
    .eq('id', document.id);

  await admin
    .from('ocr_jobs')
    .update({ status: 'succeeded', fields, finished_at: new Date().toISOString() })
    .eq('id', jobId);

  return jsonResponse({ jobId, status: 'succeeded', fields, errorCode: null });
});

// --- stage 1: deterministic parsing ----------------------------------------

type Candidate = { value: string | number; confidence: number };
type Fields = Record<string, Candidate>;

type Deterministic = {
  purchaseDate?: Candidate;
  purchasePrice?: Candidate;
  currency?: Candidate;
  invoiceNumber?: Candidate;
  serialNumber?: Candidate;
  productName?: Candidate;
  retailerName?: Candidate;
  brandName?: Candidate;
};

const DATE_PATTERNS: { pattern: RegExp; order: 'dmy' | 'mdy' | 'ymd' }[] = [
  { pattern: /\b(\d{4})-(\d{2})-(\d{2})\b/, order: 'ymd' },
  { pattern: /\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/, order: 'dmy' },
  { pattern: /\b(\d{1,2})[./](\d{1,2})[./](\d{2})\b/, order: 'dmy' },
];

const CURRENCY_SYMBOLS: Record<string, string> = {
  '₪': 'ILS',
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
};

function extractDeterministic(text: string): Deterministic {
  const result: Deterministic = {};

  for (const { pattern, order } of DATE_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const iso = toIsoDate(match, order);
    if (iso) {
      // A date matched by an unambiguous pattern is about as reliable as extraction
      // gets, but day/month order is genuinely ambiguous in many locales — hence the
      // confidence below the "no review needed" threshold for the dmy patterns.
      result.purchaseDate = { value: iso, confidence: order === 'ymd' ? 0.95 : 0.68 };
      break;
    }
  }

  const totalMatch = text.match(
    /(?:total|sum|amount|סה"כ|לתשלום)\D{0,12}([₪$€£]?\s?[\d.,]+)/i,
  );
  if (totalMatch?.[1]) {
    const amount = Number(totalMatch[1].replace(/[^\d.]/g, ''));
    if (Number.isFinite(amount) && amount > 0) {
      result.purchasePrice = { value: amount, confidence: 0.8 };
    }
    for (const [symbol, code] of Object.entries(CURRENCY_SYMBOLS)) {
      if (totalMatch[1].includes(symbol)) {
        result.currency = { value: code, confidence: 0.9 };
        break;
      }
    }
  }

  const invoiceMatch = text.match(
    /(?:invoice|receipt|חשבונית|קבלה)\s*(?:no\.?|#|number|מס')?\s*([A-Z0-9-]{4,20})/i,
  );
  if (invoiceMatch?.[1]) {
    result.invoiceNumber = { value: invoiceMatch[1], confidence: 0.75 };
  }

  const serialMatch = text.match(/(?:s\/n|serial|מספר סידורי)\s*[:#]?\s*([A-Z0-9-]{6,32})/i);
  if (serialMatch?.[1]) {
    // Deliberately low confidence: a wrong serial number is worse than a blank one
    // when the user files a claim, so this always lands in the review-me state.
    result.serialNumber = { value: serialMatch[1], confidence: 0.55 };
  }

  return result;
}

function toIsoDate(match: RegExpMatchArray, order: 'dmy' | 'mdy' | 'ymd'): string | null {
  let year: number;
  let month: number;
  let day: number;

  if (order === 'ymd') {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else if (order === 'dmy') {
    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
    if (year < 100) year += 2000;
  } else {
    month = Number(match[1]);
    day = Number(match[2]);
    year = Number(match[3]);
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 1990 || year > 2100) return null;

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// --- stage 2: model extraction ---------------------------------------------

async function extractWithModel(text: string): Promise<z.infer<typeof modelFieldsSchema> | null> {
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
        model: EXTRACTION_MODEL,
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              quoteUntrusted('receipt text', text),
              '',
              'Return JSON with keys: productName, brandName, model, retailerName, warrantyDurationMonths.',
            ].join('\n'),
          },
        ],
      }),
    });

    if (!response.ok) return null;
    const json = await response.json();
    const raw = json?.content?.[0]?.text ?? '';
    const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
    const parsed = modelFieldsSchema.safeParse(JSON.parse(trimmed));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function mergeFields(
  deterministic: Deterministic,
  model: z.infer<typeof modelFieldsSchema> | null,
): Fields {
  const fields: Fields = {};

  for (const [key, candidate] of Object.entries(deterministic)) {
    if (candidate) fields[key] = candidate;
  }

  if (!model) return fields;

  // Model-derived values carry a lower confidence than regex matches, which lands
  // them in the "worth checking" state on the review screen.
  const add = (key: string, value: string | number | null, confidence: number) => {
    if (value === null || fields[key]) return;
    fields[key] = { value, confidence };
  };

  add('productName', model.productName, 0.7);
  add('brandName', model.brandName, 0.7);
  add('model', model.model, 0.65);
  add('retailerName', model.retailerName, 0.72);
  add('warrantyDurationMonths', model.warrantyDurationMonths, 0.5);

  return fields;
}

// --- OCR -------------------------------------------------------------------

/**
 * Runs OCR against the configured provider.
 *
 * With no provider configured this returns null and the job fails cleanly with
 * `no_text`, which the app presents as "we couldn't read that one — enter it
 * yourself". Failing visibly beats returning an empty extraction that looks like the
 * receipt simply had nothing on it.
 */
// deno-lint-ignore no-explicit-any
async function runOcr(storagePath: string, admin: any): Promise<string | null> {
  const providerUrl = Deno.env.get('OCR_PROVIDER_URL');
  const providerKey = Deno.env.get('OCR_PROVIDER_KEY');
  if (!providerUrl || !providerKey) return null;

  const { data: signed } = await admin.storage
    .from('documents')
    .createSignedUrl(storagePath, 120);
  if (!signed?.signedUrl) return null;

  try {
    const response = await fetch(providerUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${providerKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: signed.signedUrl }),
    });
    if (!response.ok) return null;
    const json = await response.json();
    return typeof json.text === 'string' ? json.text : null;
  } catch {
    return null;
  }
}
