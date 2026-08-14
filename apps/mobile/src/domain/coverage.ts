import { z } from 'zod';

/**
 * The contract for AI coverage analysis.
 *
 * Model output is untrusted input. It is validated against this schema at the app
 * boundary and, independently, inside the Edge Function before it is persisted. If
 * validation fails the app shows an honest "we couldn't analyse this" state — it
 * never renders a partially parsed verdict.
 *
 * Note what the verdict vocabulary deliberately excludes: there is no "covered". The
 * app is not the warranty provider and cannot commit anyone to honouring a claim, so
 * the strongest thing it may say is that cover is *likely*.
 */

export const coverageVerdictSchema = z.enum([
  'likely_covered',
  'possibly_covered',
  'likely_not_covered',
  'insufficient_information',
]);

export type CoverageVerdict = z.infer<typeof coverageVerdictSchema>;

export const relevantClauseSchema = z.object({
  /** FK into `warranty_terms` so the UI can deep-link to the real clause text. */
  clauseId: z.string().uuid().nullable(),
  section: z.string().max(200).nullable(),
  /** Verbatim excerpt from the warranty document. Never model-authored prose. */
  excerpt: z.string().max(1200),
  relevance: z.number().min(0).max(1),
});

export type RelevantClause = z.infer<typeof relevantClauseSchema>;

/**
 * A question the assessment needs answered before it can improve.
 *
 * The alternative to asking is guessing, and a guess about whether a screen line
 * appeared before or after a knock is the difference between a covered claim and
 * a rejected one. Options are offered when the answer is genuinely closed —
 * free text otherwise.
 */
export const followUpQuestionSchema = z.object({
  id: z.string().max(60),
  question: z.string().min(1).max(300),
  options: z.array(z.string().max(120)).max(5).default([]),
});

export type FollowUpQuestion = z.infer<typeof followUpQuestionSchema>;

export const coverageAnalysisSchema = z.object({
  verdict: coverageVerdictSchema,
  /** The model's own calibration, 0–1. Shown as a coarse band, never as a percentage. */
  confidence: z.number().min(0).max(1),
  /** One or two sentences, plain language, no jargon. */
  summary: z.string().min(1).max(600),
  reasoningSummary: z.string().max(1200).default(''),
  relevantClauses: z.array(relevantClauseSchema).max(8).default([]),
  exclusions: z.array(z.string().max(400)).max(8).default([]),
  recommendedAction: z.string().max(600).default(''),
  /**
   * Facts that would change the answer and that we do not have. Rendered as a
   * list the user can act on, not as an apology.
   */
  missingInformation: z.array(z.string().max(300)).max(6).default([]),
  /** Asked instead of guessing. See `followUpQuestionSchema`. */
  followUpQuestions: z.array(followUpQuestionSchema).max(3).default([]),
  /**
   * Attachments the user supplied. Carried through so the result can say what
   * was actually done with them — see `attachmentsAnalysed`.
   */
  attachmentCount: z.number().int().min(0).max(5).default(0),
  /**
   * False until multimodal analysis actually ships. The UI must not imply the
   * model looked at a photo it never received.
   */
  attachmentsAnalysed: z.boolean().default(false),
  /** Populated server-side from a constant, never by the model. */
  disclaimer: z.string().max(600),
  meta: z
    .object({
      modelVersion: z.string().max(120),
      analysedAt: z.string(),
      warrantyId: z.string().uuid().nullable(),
      documentVersion: z.string().max(120).nullable(),
      /** True when no warranty document was available and the answer is generic. */
      groundedInDocuments: z.boolean(),
    })
    .optional(),
});

export type CoverageAnalysis = z.infer<typeof coverageAnalysisSchema>;

export type CoverageParseResult =
  | { ok: true; analysis: CoverageAnalysis }
  | { ok: false; issues: string[] };

/**
 * Parses model output defensively. Accepts either a parsed object or a raw JSON
 * string (models occasionally wrap JSON in a fenced code block, which we strip).
 */
export function parseCoverageAnalysis(input: unknown): CoverageParseResult {
  let candidate: unknown = input;

  if (typeof input === 'string') {
    const unwrapped = stripCodeFence(input);
    try {
      candidate = JSON.parse(unwrapped);
    } catch {
      return { ok: false, issues: ['Response was not valid JSON'] };
    }
  }

  const result = coverageAnalysisSchema.safeParse(candidate);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      ),
    };
  }

  // A verdict of "likely covered" with no supporting clause is exactly the kind of
  // ungrounded assertion this product must not make. Demote it rather than show it.
  if (
    result.data.verdict === 'likely_covered' &&
    result.data.relevantClauses.length === 0
  ) {
    return {
      ok: true,
      analysis: {
        ...result.data,
        verdict: 'possibly_covered',
        confidence: Math.min(result.data.confidence, 0.5),
      },
    };
  }

  return { ok: true, analysis: result.data };
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim();
}

/**
 * Whether the assessment is asking rather than answering. A result with
 * follow-up questions and no usable verdict is a conversation, not a failure.
 */
export function needsClarification(analysis: CoverageAnalysis): boolean {
  return (
    analysis.verdict === 'insufficient_information' &&
    analysis.followUpQuestions.length > 0
  );
}

/** Coarse confidence band. Users read "high/medium/low", not "0.86". */
export function confidenceBand(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= 0.75) return 'high';
  if (confidence >= 0.45) return 'medium';
  return 'low';
}

/** Maps a verdict to a semantic status colour role. Always paired with a text label. */
export function verdictTone(
  verdict: CoverageVerdict,
): 'success' | 'warning' | 'danger' | 'info' {
  switch (verdict) {
    case 'likely_covered':
      return 'success';
    case 'possibly_covered':
      return 'warning';
    case 'likely_not_covered':
      return 'danger';
    case 'insufficient_information':
      return 'info';
    default:
      return 'info';
  }
}
