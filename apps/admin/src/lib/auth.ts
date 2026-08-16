import { redirect } from 'next/navigation';

import { supabaseServer } from './supabase/server';

/**
 * Admin identity and the guards built on it.
 *
 * Every check here runs on the server and every one of them defaults to no.
 * They are the second line, not the only line — the database refuses the same
 * requests through RLS whether or not these functions are called, which is what
 * makes a forgotten guard a cosmetic bug rather than a breach.
 */

export type AdminRole = 'admin' | 'reviewer' | 'data_editor' | 'viewer';

/** Who outranks whom. Mirrors `is_admin()` in the migration. */
const ROLE_RANK: Record<AdminRole, number> = {
  admin: 3,
  reviewer: 2,
  data_editor: 1,
  viewer: 0,
};

export type AdminIdentity = {
  userId: string;
  email: string | null;
  role: AdminRole;
};

export function roleAtLeast(role: AdminRole, minimum: AdminRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/**
 * The signed-in reviewer's membership, or null.
 *
 * Reads `admin_members` through the reviewer's own session. A non-admin sees
 * zero rows there — the table's read policy is scoped to the caller's own row —
 * so "no row" and "not an admin" are the same answer and there is no way to
 * enumerate the admin list from outside it.
 */
export async function currentAdmin(): Promise<AdminIdentity | null> {
  const supabase = await supabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('admin_members')
    .select('role, revoked_at')
    .eq('user_id', user.id)
    .is('revoked_at', null)
    .maybeSingle();

  if (!data) return null;

  return {
    userId: user.id,
    email: user.email ?? null,
    role: data.role as AdminRole,
  };
}

/**
 * Requires a session and a live membership of at least `minimum`.
 *
 * A signed-out visitor is sent to sign in; a signed-in non-admin is sent to a
 * page that tells them nothing about what is behind the door. The distinction
 * matters: "wrong password" and "you are not an administrator" leak different
 * things, and only the first is useful to the person seeing it.
 */
export async function requireAdmin(minimum: AdminRole = 'viewer'): Promise<AdminIdentity> {
  const identity = await currentAdmin();

  if (!identity) {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    redirect(user ? '/no-access' : '/sign-in');
  }

  if (!roleAtLeast(identity.role, minimum)) redirect('/no-access');
  return identity;
}

/**
 * Whether the current reviewer may change data at all.
 *
 * A viewer can read every queue — seeing the work is not the same as doing it —
 * and every mutating control in the UI is disabled for them. If one is missed,
 * the write still fails: the RLS policies require `data_editor` or above.
 */
export async function canEdit(): Promise<boolean> {
  const identity = await currentAdmin();
  return identity !== null && roleAtLeast(identity.role, 'data_editor');
}

/** Promotion to verified or published is a reviewer's act, never an editor's. */
export async function canReview(): Promise<boolean> {
  const identity = await currentAdmin();
  return identity !== null && roleAtLeast(identity.role, 'reviewer');
}
