'use client';

import { useState, useTransition } from 'react';

import { markVerified } from '@/lib/actions/records';
import { flagForReverification } from '@/lib/actions/queues';

/**
 * The two honest answers to "is this still right".
 *
 * "Still correct" is not an edit — it moves `verified_at` and nothing else, so
 * a record a person confirmed unchanged stays distinguishable from one that was
 * rewritten. That distinction is what lets you work out later why an answer
 * changed.
 */
export function ReverifyButton({
  table,
  id,
  canEdit,
  canReview,
}: {
  table: string;
  id: string;
  canEdit: boolean;
  canReview: boolean;
}) {
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (done) return <span className="chip" data-tone="ok">{done}</span>;

  return (
    <div className="row" style={{ justifyContent: 'flex-end' }}>
      <button
        type="button"
        disabled={!canReview || pending}
        onClick={() =>
          startTransition(async () => {
            const result = await markVerified(table, id, 'confirmed unchanged');
            if (result.ok) setDone('confirmed');
            else setError(result.error);
          })
        }
      >
        Still correct
      </button>
      <button
        type="button"
        disabled={!canEdit || pending}
        onClick={() =>
          startTransition(async () => {
            const result = await flagForReverification(table, id, 'aged past its interval');
            if (result.ok) setDone('flagged');
            else setError(result.error);
          })
        }
      >
        Needs a look
      </button>
      {error ? <span className="chip" data-tone="danger">{error}</span> : null}
    </div>
  );
}
