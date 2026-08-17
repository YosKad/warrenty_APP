'use server';

import { revalidatePath } from 'next/cache';
import { canTransition, type PublicationStatus } from '@mw/domain';

import { requireAdmin } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';

/**
 * Record mutations, with the audit trail attached.
 *
 * Every write in the console goes through here so that "who changed this, from
 * what, to what, and why" is recorded by construction rather than by each page
 * remembering to. The before state is read first — after the update it is gone,
 * and an audit log that only records the new value answers the least
 * interesting half of the question.
 */

/**
 * Tables the console may write.
 *
 * A closed list, not a parameter. `from(table)` with a caller-supplied string
 * is how a form field turns into a request against a table nobody intended —
 * RLS would still refuse most of it, but "most" is not a security argument.
 */
const WRITABLE = {
  organisations: '/organisations',
  organisation_relationships: '/relationships',
  warranties: '/warranties',
  warranty_terms: '/warranties',
  warranty_sources: '/sources',
  provider_contact_methods: '/providers',
  service_locations: '/providers',
  service_capabilities: '/providers',
  product_models: '/models',
  model_aliases: '/models',
  organisation_aliases: '/organisations',
  warranty_serial_rules: '/warranties',
} as const;

export type WritableTable = keyof typeof WRITABLE;

export type ActionResult = { ok: true } | { ok: false; error: string };

function isWritable(table: string): table is WritableTable {
  return Object.prototype.hasOwnProperty.call(WRITABLE, table);
}

export async function updateRecord(
  table: string,
  id: string,
  patch: Record<string, unknown>,
  reason?: string,
): Promise<ActionResult> {
  if (!isWritable(table)) return { ok: false, error: 'That table cannot be edited here.' };
  await requireAdmin('data_editor');

  const supabase = await supabaseServer();

  const { data: before } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
  if (!before) return { ok: false, error: 'That record no longer exists.' };

  const { data: after, error } = await supabase
    .from(table)
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  // An update that matched nothing is a refusal, not a success. RLS declines by
  // returning no rows rather than by raising.
  if (!after) return { ok: false, error: 'The database declined that change.' };

  await supabase.rpc('log_admin_action', {
    p_action: `${table}.update`,
    p_entity_type: table,
    p_entity_id: id,
    p_before: onlyChanged(before, patch),
    p_after: onlyChanged(after, patch),
    p_reason: reason ?? null,
  });

  revalidatePath(WRITABLE[table]);
  return { ok: true };
}

export async function createRecord(
  table: string,
  values: Record<string, unknown>,
  reason?: string,
): Promise<ActionResult & { id?: string }> {
  if (!isWritable(table)) return { ok: false, error: 'That table cannot be edited here.' };
  await requireAdmin('data_editor');

  const supabase = await supabaseServer();
  const { data, error } = await supabase.from(table).insert(values).select('id').maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'The database declined that insert.' };

  await supabase.rpc('log_admin_action', {
    p_action: `${table}.create`,
    p_entity_type: table,
    p_entity_id: data.id,
    p_before: null,
    p_after: values,
    p_reason: reason ?? null,
  });

  revalidatePath(WRITABLE[table]);
  return { ok: true, id: data.id as string };
}

/**
 * Moves a record along the publication workflow.
 *
 * Both halves of the rule are checked here — that the transition is one the
 * workflow allows, and that the person has the standing to make it — and both
 * are checked again by the database. The duplication is on purpose: this layer
 * exists to give a reviewer a sensible message, not to be the thing that stops
 * them.
 */
export async function setPublicationStatus(
  table: string,
  id: string,
  next: PublicationStatus,
  note?: string,
): Promise<ActionResult> {
  if (!isWritable(table)) return { ok: false, error: 'That table cannot be edited here.' };

  const promoting = next === 'verified' || next === 'published';
  const identity = await requireAdmin(promoting ? 'reviewer' : 'data_editor');

  const supabase = await supabaseServer();
  const { data: before } = await supabase
    .from(table)
    .select('id, publication_status')
    .eq('id', id)
    .maybeSingle();

  if (!before) return { ok: false, error: 'That record no longer exists.' };

  const current = before.publication_status as PublicationStatus;
  if (current === next) return { ok: true };
  if (!canTransition(current, next)) {
    return {
      ok: false,
      error: `A record cannot go straight from ${current.replace(/_/g, ' ')} to ${next.replace(
        /_/g,
        ' ',
      )}.`,
    };
  }

  const patch: Record<string, unknown> = { publication_status: next };
  if (note) patch.review_note = note;
  if (promoting) {
    patch.reviewed_by = identity.userId;
    patch.reviewed_at = new Date().toISOString();
  }

  const { data: after, error } = await supabase
    .from(table)
    .update(patch)
    .eq('id', id)
    .select('id, publication_status')
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!after) return { ok: false, error: 'The database declined that change.' };

  await supabase.rpc('log_admin_action', {
    p_action: `${table}.publication_status`,
    p_entity_type: table,
    p_entity_id: id,
    p_before: { publication_status: current },
    p_after: { publication_status: next },
    p_reason: note ?? null,
  });

  revalidatePath(WRITABLE[table]);
  return { ok: true };
}

/**
 * Records that a person looked at a record and found it still correct.
 *
 * Re-verification is not an edit. It moves `verified_at` and nothing else, so a
 * record that has been confirmed unchanged is distinguishable from one that was
 * rewritten — which matters when working out why an answer changed.
 */
export async function markVerified(
  table: string,
  id: string,
  note?: string,
): Promise<ActionResult> {
  if (!isWritable(table)) return { ok: false, error: 'That table cannot be edited here.' };
  await requireAdmin('reviewer');

  const supabase = await supabaseServer();
  const now = new Date().toISOString();

  const { data: before } = await supabase
    .from(table)
    .select('id, verified_at')
    .eq('id', id)
    .maybeSingle();
  if (!before) return { ok: false, error: 'That record no longer exists.' };

  const { data: after, error } = await supabase
    .from(table)
    .update({ verified_at: now })
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!after) return { ok: false, error: 'The database declined that change.' };

  await supabase.rpc('log_admin_action', {
    p_action: `${table}.reverify`,
    p_entity_type: table,
    p_entity_id: id,
    p_before: { verified_at: before.verified_at },
    p_after: { verified_at: now },
    p_reason: note ?? null,
  });

  revalidatePath(WRITABLE[table]);
  return { ok: true };
}

/** Only the fields the change touched, so the audit entry reads as a diff. */
function onlyChanged(
  row: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const slice: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) slice[key] = row[key] ?? null;
  return slice;
}
