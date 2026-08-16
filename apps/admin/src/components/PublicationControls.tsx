'use client';

import { useState, useTransition } from 'react';
import { PUBLICATION_TRANSITIONS, type PublicationStatus } from '@mw/domain';

import { markVerified, setPublicationStatus } from '@/lib/actions/records';

const LABELS: Partial<Record<PublicationStatus, string>> = {
  needs_review: 'Send to review',
  verified: 'Mark verified',
  published: 'Publish',
  needs_reverification: 'Flag for re-check',
  archived: 'Archive',
  rejected: 'Reject',
  candidate: 'Return to candidate',
};

/**
 * The workflow controls.
 *
 * Only the transitions the record can actually make are offered — a reviewer
 * should not have to find out by clicking that a candidate cannot be published
 * in one step. Rejecting and archiving ask for a reason first, because a record
 * that was refused with no explanation is a record the next person will simply
 * re-add.
 */
export function PublicationControls({
  table,
  id,
  status,
  canReview,
  canEdit,
}: {
  table: string;
  id: string;
  status: PublicationStatus;
  canReview: boolean;
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const transitions = PUBLICATION_TRANSITIONS[status];
  const needsReason = (next: PublicationStatus) => next === 'rejected' || next === 'archived';

  function move(next: PublicationStatus) {
    setError(null);
    startTransition(async () => {
      const result = await setPublicationStatus(table, id, next, reason || undefined);
      if (!result.ok) setError(result.error);
      else setReason('');
    });
  }

  function reverify() {
    setError(null);
    startTransition(async () => {
      const result = await markVerified(table, id, reason || undefined);
      if (!result.ok) setError(result.error);
      else setReason('');
    });
  }

  if (!canEdit) {
    return (
      <p className="panel-note">
        Read access. Publication state is changed by editors and reviewers.
      </p>
    );
  }

  return (
    <div className="stack">
      <div className="row">
        {transitions.map((next) => {
          const promoting = next === 'verified' || next === 'published';
          return (
            <button
              key={next}
              type="button"
              data-variant={next === 'published' ? 'primary' : next === 'rejected' ? 'danger' : undefined}
              disabled={pending || (promoting && !canReview) || (needsReason(next) && !reason.trim())}
              onClick={() => move(next)}
              title={promoting && !canReview ? 'Promotion requires a reviewer' : undefined}
            >
              {LABELS[next] ?? next}
            </button>
          );
        })}

        {status === 'published' ? (
          <button type="button" disabled={pending || !canReview} onClick={reverify}>
            Confirm still correct
          </button>
        ) : null}
      </div>

      <label className="field">
        Note
        <input
          type="text"
          value={reason}
          placeholder="Why — required to reject or archive"
          onChange={(event) => setReason(event.target.value)}
        />
      </label>

      {!canReview ? (
        <p className="panel-note">
          Verifying and publishing require a reviewer. The database enforces this
          too, so the buttons above are a courtesy rather than the rule.
        </p>
      ) : null}

      {error ? (
        <p className="notice" data-tone="danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
