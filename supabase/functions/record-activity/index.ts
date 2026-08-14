import { z } from 'npm:zod@4';

import { errorResponse, handlePreflight, jsonResponse } from '../_shared/cors.ts';
import { requireUser, serviceClient, userClient } from '../_shared/supabase.ts';

/**
 * Activity recording.
 *
 * `activity_events` is server-written by design — a history a client can forge
 * is not a history. This is the narrow, validated door through which the app
 * may add to it.
 *
 * Two constraints shape it:
 *
 *   1. The payload is a closed shape per event kind. Free-form JSON from a
 *      client would become the place where issue text and phone numbers leak
 *      into a table that is meant to hold facts about *what happened*, not about
 *      what was said.
 *   2. Failure is silent to the caller. Recording that someone viewed a service
 *      route must never be able to stop them phoning a service centre.
 *
 * Phase I builds the feed. This is the writer it will read from.
 */

const requestSchema = z.object({
  productId: z.string().uuid(),
  kind: z.enum([
    'service_route_viewed',
    'provider_contacted',
    'directions_opened',
    'service_request_prepared',
    'coverage_checked',
  ]),
  // Rendering data only. Enumerated keys, bounded values — never a phone
  // number, an address or anything the user typed.
  payload: z
    .object({
      channel: z.enum(['phone', 'whatsapp', 'email', 'web_form', 'website', 'chat', 'sms']).optional(),
      provider: z.enum(['apple', 'google', 'waze']).optional(),
      verdict: z.string().max(40).optional(),
    })
    .default({}),
});

/** Client-facing names map onto the schema's enum. */
const KIND_MAP: Record<string, string> = {
  service_route_viewed: 'case_updated',
  provider_contacted: 'case_updated',
  directions_opened: 'case_updated',
  service_request_prepared: 'case_updated',
  coverage_checked: 'coverage_checked',
};

Deno.serve(async (request: Request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const user = await requireUser(request);
  if (!user) return errorResponse('unauthenticated');

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse('validation');
  const { productId, kind, payload } = parsed.data;

  const asUser = userClient(request);
  const admin = serviceClient();

  // Ownership through the user client, so RLS is the barrier rather than a
  // comparison we wrote ourselves.
  const { data: product, error } = await asUser
    .from('products')
    .select('id, owner_id, workspace_id')
    .eq('id', productId)
    .is('deleted_at', null)
    .single();

  if (error || !product) return errorResponse('not_found');
  if (product.owner_id !== user.id) return errorResponse('forbidden');

  await admin.from('activity_events').insert({
    owner_id: user.id,
    workspace_id: product.workspace_id,
    product_id: productId,
    kind: KIND_MAP[kind] ?? 'case_updated',
    // The client-facing name is kept in the payload so the feed can render a
    // precise sentence without the enum having to grow a value per interaction.
    payload: { ...payload, action: kind },
  });

  return jsonResponse({ recorded: true });
});
