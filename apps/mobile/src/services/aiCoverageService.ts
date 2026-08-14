import { AppError, toAppError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import {
  parseCoverageAnalysis,
  type CoverageAnalysis,
} from '@/domain/coverage';

/**
 * AI coverage analysis.
 *
 * The client's job here is narrow: send the user's description, receive a structured
 * verdict, validate it, and refuse to render anything that doesn't validate. All
 * retrieval, prompting and model access happens in the Edge Function — the app has
 * no model API key and no prompt text, so neither can be extracted from the binary.
 */

export type CoverageRequest = {
  productId: string;
  issueDescription: string;
  issueCategory?: string;
  /** Document ids the user attached to the problem report (photos of the fault). */
  attachmentIds?: string[];
  /**
   * Answers to the previous round's follow-up questions, keyed by question id.
   * Sent alongside the original description rather than replacing it, so the
   * second analysis reasons about the whole problem and not just the answer.
   */
  followUpAnswers?: Record<string, string>;
};

export type CoverageOutcome =
  | { status: 'ok'; analysis: CoverageAnalysis; analysisId: string }
  | { status: 'unavailable'; reason: 'not_entitled' | 'rate_limited' | 'no_warranty_data' }
  | { status: 'failed' };

export async function analyseCoverage(
  request: CoverageRequest,
): Promise<CoverageOutcome> {
  try {
    const { data, error } = await supabase.functions.invoke('ai-coverage', {
      body: {
        productId: request.productId,
        // Trimmed and bounded before it leaves the device. The function treats it
        // strictly as data — see the injection isolation notes in AI.md.
        issueDescription: request.issueDescription.trim().slice(0, 4000),
        issueCategory: request.issueCategory,
        attachmentIds: request.attachmentIds?.slice(0, 5) ?? [],
        followUpAnswers: request.followUpAnswers ?? {},
      },
    });

    if (error) {
      const appError = toAppError(error);
      if (appError.code === 'payment_required') {
        return { status: 'unavailable', reason: 'not_entitled' };
      }
      if (appError.code === 'rate_limited') {
        return { status: 'unavailable', reason: 'rate_limited' };
      }
      throw appError;
    }

    const envelope = data as { analysisId?: string; analysis?: unknown } | null;
    if (!envelope?.analysis) return { status: 'failed' };

    const parsed = parseCoverageAnalysis(envelope.analysis);
    if (!parsed.ok) {
      // Showing half a verdict would be worse than showing none.
      return { status: 'failed' };
    }
    if (!parsed.analysis.meta?.groundedInDocuments && parsed.analysis.relevantClauses.length === 0) {
      return { status: 'unavailable', reason: 'no_warranty_data' };
    }

    return {
      status: 'ok',
      analysis: parsed.analysis,
      analysisId: envelope.analysisId ?? '',
    };
  } catch (error) {
    throw toAppError(error);
  }
}

export type StoredAnalysis = CoverageAnalysis & { id: string; createdAt: string };

/** Past analyses for a product — part of its permanent service history. */
export async function listAnalyses(productId: string): Promise<StoredAnalysis[]> {
  try {
    const { data, error } = await supabase
      .from('ai_analyses')
      .select('*')
      .eq('product_id', productId)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw error;

    return (data ?? []).flatMap((row) => {
      const parsed = parseCoverageAnalysis({
        verdict: row.verdict,
        confidence: Number(row.confidence),
        summary: row.summary,
        reasoningSummary: row.reasoning_summary ?? '',
        relevantClauses: [],
        exclusions: row.exclusions ?? [],
        recommendedAction: row.recommended_action ?? '',
        disclaimer: COVERAGE_DISCLAIMER_KEY,
        meta: {
          modelVersion: row.model_version,
          analysedAt: row.created_at,
          warrantyId: row.warranty_id,
          documentVersion: row.document_version,
          groundedInDocuments: row.grounded_in_documents,
        },
      });
      return parsed.ok ? [{ ...parsed.analysis, id: row.id, createdAt: row.created_at }] : [];
    });
  } catch (error) {
    throw toAppError(error);
  }
}

/**
 * The i18n key for the legal disclaimer. It is a constant on both client and server
 * and is never model-generated — the model must not be able to soften, shorten or
 * omit the sentence that says this is not a guarantee.
 */
export const COVERAGE_DISCLAIMER_KEY = 'coverage.disclaimer';

export async function assertCoverageEntitlement(): Promise<void> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('plan, status')
    .single();
  if (error) throw toAppError(error);
  const entitled =
    data &&
    data.plan !== 'free' &&
    ['active', 'in_trial', 'in_grace_period', 'in_billing_retry'].includes(data.status);
  if (!entitled) {
    throw new AppError('payment_required', { messageKey: 'paywall.aiCoverage' });
  }
}
