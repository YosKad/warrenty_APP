import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

/**
 * The console's only database client.
 *
 * It carries the signed-in reviewer's session and the anon key — never the
 * service role. That is deliberate and it is the main security decision in this
 * application: every read and every write goes through the same RLS policies
 * that protect this data from ordinary users, so a routing mistake or a missing
 * guard in the UI cannot turn into unauthorised access. The database is the
 * enforcement point; the guards in `auth.ts` exist so people see a sensible
 * screen, not so the data stays safe.
 */
export async function supabaseServer() {
  const cookieStore = await cookies();

  return createServerClient(requiredEnv('NEXT_PUBLIC_SUPABASE_URL'), requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. Refresh happens in middleware,
          // which can, so this is safe to ignore here.
        }
      },
    },
  });
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Copy apps/admin/.env.example to .env.local and fill it in.`,
    );
  }
  return value;
}
