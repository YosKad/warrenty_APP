'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { QueueCount } from '@/lib/queues';

type NavProps = {
  queues: QueueCount[];
};

const DATA_LINKS = [
  { href: '/organisations', label: 'Organisations' },
  { href: '/relationships', label: 'Relationships' },
  { href: '/warranties', label: 'Warranty policies' },
  { href: '/providers', label: 'Service providers' },
  { href: '/sources', label: 'Sources' },
];

const TOOL_LINKS = [
  { href: '/import', label: 'Bulk import' },
  { href: '/resolution', label: 'Resolution tester' },
  { href: '/coverage', label: 'Coverage' },
  { href: '/audit', label: 'Audit log' },
];

/**
 * The queues come first.
 *
 * A reviewer opening this console has a job to do, and the sidebar's first
 * question should be "what needs doing" rather than "what tables exist". The
 * data sections are below, for when the answer is "go and add something".
 */
export function Nav({ queues }: NavProps) {
  const pathname = usePathname();

  const isCurrent = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <nav className="stack" aria-label="Console">
      <div className="nav-group">
        <Link className="nav-item" href="/" aria-current={isCurrent('/') ? 'page' : undefined}>
          Dashboard
        </Link>
      </div>

      <div className="nav-group">
        <span className="nav-label">Queues</span>
        {queues.map((queue) => (
          <Link
            key={queue.key}
            className="nav-item"
            href={queue.href}
            aria-current={isCurrent(queue.href) ? 'page' : undefined}
          >
            <span>{queue.label}</span>
            <span className="nav-count" data-urgent={queue.urgent && queue.count > 0}>
              {queue.count}
            </span>
          </Link>
        ))}
      </div>

      <div className="nav-group">
        <span className="nav-label">Data</span>
        {DATA_LINKS.map((link) => (
          <Link
            key={link.href}
            className="nav-item"
            href={link.href}
            aria-current={isCurrent(link.href) ? 'page' : undefined}
          >
            {link.label}
          </Link>
        ))}
      </div>

      <div className="nav-group">
        <span className="nav-label">Tools</span>
        {TOOL_LINKS.map((link) => (
          <Link
            key={link.href}
            className="nav-item"
            href={link.href}
            aria-current={isCurrent(link.href) ? 'page' : undefined}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
