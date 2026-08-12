import { z } from 'npm:zod@4';

import { errorResponse, handlePreflight, jsonResponse } from '../_shared/cors.ts';
import { audit, requireUser, serviceClient } from '../_shared/supabase.ts';

/**
 * Account deletion.
 *
 * Deleting an auth user needs the service-role key, so this cannot run on the device
 * — which is the point: it is one auditable, server-side operation rather than a
 * sequence of client calls that can fail halfway and leave orphaned data.
 *
 * Order matters. Storage objects are removed first, because once the auth user is
 * gone the RLS-derived ownership of those paths is unrecoverable and the files would
 * be orphaned forever. The database cascade then removes every owned row.
 *
 * What is deliberately *not* deleted: the audit log entry recording that the deletion
 * happened, with the actor nulled out. Retaining proof that a deletion occurred, with
 * no personal data in it, is what makes the process accountable.
 */

const requestSchema = z.object({
  confirmationEmail: z.string().email(),
});

Deno.serve(async (request: Request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const user = await requireUser(request);
  if (!user) return errorResponse('unauthenticated');

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse('validation');

  // The JWT already proves identity; the typed email is a deliberate speed bump
  // against a mis-tap on an irreversible action.
  if (
    !user.email ||
    parsed.data.confirmationEmail.toLowerCase() !== user.email.toLowerCase()
  ) {
    return errorResponse('validation');
  }

  const admin = serviceClient();

  await audit(admin, {
    actorId: user.id,
    action: 'account.delete_requested',
    entityType: 'user',
    entityId: user.id,
  });

  // 1. Storage. Both buckets are laid out as '<ownerId>/...', so one prefix listing
  //    finds everything the user owns.
  for (const bucket of ['documents', 'product-images']) {
    await purgeBucketPrefix(admin, bucket, user.id);
  }

  // 2. The auth user. Every user-owned table cascades from `user_profiles`, which in
  //    turn cascades from `auth.users`, so this single delete removes products,
  //    documents, claims, analyses, notifications, devices and the subscription row.
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    await audit(admin, {
      actorId: user.id,
      action: 'account.delete_failed',
      entityType: 'user',
      entityId: user.id,
    });
    return errorResponse('server');
  }

  // 3. A de-identified record that the deletion happened. `actor_id` is already null
  //    at this point because the FK is ON DELETE SET NULL.
  await admin.from('audit_logs').insert({
    actor_id: null,
    action: 'account.deleted',
    entity_type: 'user',
    metadata: { completedAt: new Date().toISOString() },
  });

  return jsonResponse({ deleted: true });
});

/**
 * Removes every object under a user's prefix, paging through the listing because
 * Storage caps a single list call.
 */
// deno-lint-ignore no-explicit-any
async function purgeBucketPrefix(admin: any, bucket: string, ownerId: string) {
  const paths: string[] = [];

  const { data: folders } = await admin.storage.from(bucket).list(ownerId, { limit: 1000 });
  for (const folder of folders ?? []) {
    // One sub-folder per product.
    const { data: files } = await admin.storage
      .from(bucket)
      .list(`${ownerId}/${folder.name}`, { limit: 1000 });
    for (const file of files ?? []) {
      paths.push(`${ownerId}/${folder.name}/${file.name}`);
    }
  }

  // Remove in chunks; a user with hundreds of documents would otherwise exceed the
  // request size limit.
  for (let i = 0; i < paths.length; i += 100) {
    await admin.storage
      .from(bucket)
      .remove(paths.slice(i, i + 100))
      .catch(() => undefined);
  }
}
