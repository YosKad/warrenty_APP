'use server';

import { revalidatePath } from 'next/cache';

import { requireAdmin } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';

/**
 * Queue actions.
 *
 * Two rules, both of which exist because the alternative destroys evidence.
 *
 * Resolving a warranty conflict records which policy was chosen and why. It
 * never deletes the policy that lost — a policy that disagrees with the one we
 * picked is the record of a real disagreement between two documents, and
 * deleting it means the next person re-discovers it from scratch and reaches a
 * different answer.
 *
 * Accepting a user's report never writes their correction into the global
 * record. Someone saying "this number is dead" is strong evidence that a person
 * should look, and no evidence at all about what the right number is.
 */

export type QueueActionResult = { ok: true } | { ok: false; error: string };

export type ConflictResolution =
  | 'chose_policy'
  | 'both_valid'
  | 'rejected_source'
  | 'needs_more_review';

export async function resolveConflict(
  conflictId: string,
  resolution: ConflictResolution,
  options: { chosenWarrantyId?: string; note?: string } = {},
): Promise<QueueActionResult> {
  const identity = await requireAdmin('reviewer');

  if (resolution === 'chose_policy' && !options.chosenWarrantyId) {
    return { ok: false, error: 'Say which policy applies.' };
  }
  if (resolution === 'both_valid' && !options.note?.trim()) {
    // "Both apply" is only useful to a user if it says when each one does.
    return {
      ok: false,
      error: 'Say what distinguishes them — which product, which purchase date, which channel.',
    };
  }

  const supabase = await supabaseServer();

  const { data: before } = await supabase
    .from('warranty_conflicts')
    .select('*')
    .eq('id', conflictId)
    .maybeSingle();
  if (!before) return { ok: false, error: 'That conflict no longer exists.' };

  const { data: after, error } = await supabase
    .from('warranty_conflicts')
    .update({
      status: resolution === 'needs_more_review' ? 'open' : 'resolved',
      resolution,
      chosen_warranty_id: options.chosenWarrantyId ?? null,
      applicability_note: options.note?.trim() || null,
      resolved_by: identity.userId,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', conflictId)
    .select('id')
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!after) return { ok: false, error: 'The database declined that change.' };

  await supabase.rpc('log_admin_action', {
    p_action: `warranty_conflict.${resolution}`,
    p_entity_type: 'warranty_conflicts',
    p_entity_id: conflictId,
    p_before: { status: before.status, resolution: before.resolution },
    p_after: { resolution, chosen_warranty_id: options.chosenWarrantyId ?? null },
    p_reason: options.note ?? null,
  });

  revalidatePath('/queues/conflicts');
  return { ok: true };
}

export async function reviewReport(
  reportId: string,
  status: 'accepted' | 'rejected' | 'duplicate',
  note?: string,
): Promise<QueueActionResult> {
  const identity = await requireAdmin('reviewer');
  const supabase = await supabaseServer();

  const { data: before } = await supabase
    .from('service_data_reports')
    .select('id, status, kind, suggested_value')
    .eq('id', reportId)
    .maybeSingle();
  if (!before) return { ok: false, error: 'That report no longer exists.' };

  const { data: after, error } = await supabase
    .from('service_data_reports')
    .update({
      status,
      review_note: note?.trim() || null,
      reviewed_by: identity.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', reportId)
    .select('id')
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!after) return { ok: false, error: 'The database declined that change.' };

  await supabase.rpc('log_admin_action', {
    p_action: `service_report.${status}`,
    p_entity_type: 'service_data_reports',
    p_entity_id: reportId,
    p_before: { status: before.status },
    p_after: { status },
    p_reason: note ?? null,
  });

  revalidatePath('/queues/reports');
  return { ok: true };
}

/**
 * Flags a published record for re-checking.
 *
 * Deliberately the opposite of an automatic refresh. A record that has aged, or
 * whose source changed, is marked for a person to look at; nothing is
 * overwritten by a machine that fetched the page again and found different
 * words on it.
 */
export async function flagForReverification(
  table: string,
  id: string,
  reason: string,
): Promise<QueueActionResult> {
  await requireAdmin('data_editor');

  const allowed = [
    'warranties',
    'warranty_terms',
    'warranty_sources',
    'provider_contact_methods',
    'service_locations',
    'service_capabilities',
    'organisations',
    'organisation_relationships',
  ];
  if (!allowed.includes(table)) return { ok: false, error: 'That table has no review workflow.' };

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from(table)
    .update({ publication_status: 'needs_reverification', review_note: reason })
    .eq('id', id)
    .eq('publication_status', 'published')
    .select('id')
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Only a published record can be flagged for a re-check.' };

  await supabase.rpc('log_admin_action', {
    p_action: `${table}.flag_reverification`,
    p_entity_type: table,
    p_entity_id: id,
    p_after: { publication_status: 'needs_reverification' },
    p_reason: reason,
  });

  revalidatePath('/queues/stale');
  return { ok: true };
}

/** Sends a failed or unsupported extraction back to the front of the queue. */
export async function requeueExtraction(jobId: string): Promise<QueueActionResult> {
  await requireAdmin('data_editor');
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from('extraction_jobs')
    .update({ status: 'pending', failure_reason: null })
    .eq('id', jobId)
    .select('id')
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'The database declined that change.' };

  revalidatePath('/queues/extraction');
  return { ok: true };
}
