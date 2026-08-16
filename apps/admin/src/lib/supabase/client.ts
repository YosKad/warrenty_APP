'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser client. Used for sign-in only.
 *
 * Data reads and writes go through Server Components and Server Actions, so the
 * console has no client-side data layer to keep in sync — and no place for a
 * mutation to happen without a server-side guard in front of it.
 */
export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
