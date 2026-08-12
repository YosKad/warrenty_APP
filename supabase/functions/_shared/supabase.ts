import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

/**
 * Two clients, two very different privilege levels. Keeping them distinct — and
 * making the caller pick — is what prevents an accidental service-role query in a
 * user-facing code path.
 */

/**
 * Acts *as the calling user*: the caller's JWT is forwarded, so every query is
 * subject to the same RLS policies the mobile app is. Use this for anything that
 * reads or writes the requester's own data.
 */
export function userClient(request: Request): SupabaseClient {
  const authorization = request.headers.get('Authorization') ?? '';
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

/**
 * Bypasses RLS entirely. Reserved for operations a user must not be able to perform
 * for themselves: writing subscription state, inserting an AI analysis, deleting an
 * auth user, sending scheduled notifications.
 */
export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export type AuthedUser = { id: string; email: string | null };

/**
 * Resolves the caller from their JWT. Returns null rather than throwing so each
 * function decides its own unauthenticated response.
 */
export async function requireUser(request: Request): Promise<AuthedUser | null> {
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return null;

  const client = userClient(request);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

/**
 * Fixed-window rate limiting, backed by Postgres so it holds across the many
 * isolates a function runs in. A per-isolate in-memory counter would be trivially
 * bypassed by retrying until a cold start.
 */
export async function checkRateLimit(
  admin: SupabaseClient,
  userId: string,
  bucket: string,
  limit: number,
  windowMinutes: number,
): Promise<boolean> {
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const { count, error } = await admin
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('actor_id', userId)
    .eq('action', `ratelimit.${bucket}`)
    .gte('created_at', since);

  if (error) return true; // Fail open on an infrastructure error, not on abuse.
  if ((count ?? 0) >= limit) return false;

  await admin.from('audit_logs').insert({
    actor_id: userId,
    action: `ratelimit.${bucket}`,
    entity_type: 'rate_limit',
  });
  return true;
}

/** Records a privileged or user-visible action for the audit trail. */
export async function audit(
  admin: SupabaseClient,
  entry: {
    actorId: string | null;
    action: string;
    entityType: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await admin.from('audit_logs').insert({
    actor_id: entry.actorId,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    // Never put document contents or extracted text in here.
    metadata: entry.metadata ?? {},
  });
}
