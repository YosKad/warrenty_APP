import type { ReactNode } from 'react';

import type { FreshnessState, PublicationStatus, VerificationState } from '@mw/domain';

/** Page title plus whatever actions belong to the page. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <div>
        <h1>{title}</h1>
        {subtitle ? <p className="topbar-sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </div>
  );
}

export function Panel({
  title,
  note,
  actions,
  children,
  padded = true,
}: {
  title?: string;
  note?: string;
  actions?: ReactNode;
  children: ReactNode;
  padded?: boolean;
}) {
  return (
    <section className="panel">
      {title ? (
        <div className="panel-head">
          <div>
            <h2>{title}</h2>
            {note ? <p className="panel-note">{note}</p> : null}
          </div>
          {actions ? <div className="row">{actions}</div> : null}
        </div>
      ) : null}
      {padded ? <div className="panel-body">{children}</div> : children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

/**
 * Publication state, coloured by how much trouble it can cause.
 *
 * Published is green because it is the working state, not because it is
 * "good": a published row that should not be is the most dangerous record in
 * the database, which is what the review queues are for.
 */
const PUBLICATION_TONE: Record<PublicationStatus, string> = {
  candidate: 'info',
  needs_review: 'warn',
  verified: 'ok',
  published: 'ok',
  needs_reverification: 'warn',
  archived: 'neutral',
  rejected: 'danger',
};

export function StatusChip({ status }: { status: PublicationStatus }) {
  return (
    <span className="chip" data-tone={PUBLICATION_TONE[status]}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

const VERIFICATION_TONE: Record<VerificationState, string> = {
  official: 'ok',
  verified: 'ok',
  community_submitted: 'info',
  ai_extracted: 'warn',
  unverified: 'neutral',
};

export function VerificationChip({ state }: { state: VerificationState }) {
  return (
    <span className="chip" data-tone={VERIFICATION_TONE[state]}>
      {state.replace(/_/g, ' ')}
    </span>
  );
}

const FRESHNESS_LABEL: Record<FreshnessState, string> = {
  fresh: 'fresh',
  due: 'due a check',
  stale: 'stale',
  // Not a synonym for stale: nobody has ever checked this one.
  unknown: 'never verified',
};

const FRESHNESS_TONE: Record<FreshnessState, string> = {
  fresh: 'ok',
  due: 'warn',
  stale: 'danger',
  unknown: 'neutral',
};

export function FreshnessChip({ state }: { state: FreshnessState }) {
  return (
    <span className="chip" data-tone={FRESHNESS_TONE[state]}>
      {FRESHNESS_LABEL[state]}
    </span>
  );
}

export function EnvironmentChip({ environment }: { environment: 'production' | 'demo' }) {
  if (environment === 'production') return null;
  // Only ever rendered for demo rows. A production badge on every row would be
  // noise; a demo badge is a warning.
  return (
    <span className="chip" data-tone="warn">
      demo
    </span>
  );
}

export function Metric({
  label,
  value,
  note,
  ratio,
}: {
  label: string;
  value: string;
  note?: string;
  ratio?: number;
}) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {ratio !== undefined ? (
        <div className="bar">
          <span style={{ width: `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%` }} />
        </div>
      ) : null}
      {note ? <div className="metric-note">{note}</div> : null}
    </div>
  );
}

/**
 * A value that may not exist.
 *
 * The console renders "unknown" as a first-class answer everywhere the app
 * does, because a reviewer looking at a blank cell cannot tell whether the data
 * is missing or the page is broken.
 */
export function Value({ children }: { children: ReactNode }) {
  if (children === null || children === undefined || children === '') {
    return <span className="muted">unknown</span>;
  }
  return <>{children}</>;
}
