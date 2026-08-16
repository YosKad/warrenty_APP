import type { ReactNode } from 'react';

import { Nav } from '@/components/Nav';
import { requireAdmin } from '@/lib/auth';
import { queueCounts } from '@/lib/queues';
import { signOut } from '@/lib/actions/session';

/**
 * Everything inside this route group requires a live admin membership.
 *
 * The guard is in the layout rather than repeated in each page so that adding a
 * page cannot accidentally add an unguarded one. It is still not the security
 * boundary — RLS is — but it is the difference between a non-admin seeing an
 * empty console and seeing a polite refusal.
 */
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const identity = await requireAdmin();
  const queues = await queueCounts();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          MY Warranty
          <span>Data Operations</span>
        </div>
        <Nav queues={queues} />
      </aside>

      <div className="main">
        <header className="topbar">
          <div />
          <div className="topbar-identity">
            <span className="mono">{identity.email}</span>
            <span className="chip" data-tone="info">
              {identity.role.replace('_', ' ')}
            </span>
            <form action={signOut}>
              <button type="submit">Sign out</button>
            </form>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
