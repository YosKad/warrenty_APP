'use client';

import { useState, useTransition } from 'react';

import { requeueExtraction } from '@/lib/actions/queues';

export function RequeueButton({ jobId, canEdit }: { jobId: string; canEdit: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        disabled={!canEdit || pending}
        onClick={() =>
          startTransition(async () => {
            const result = await requeueExtraction(jobId);
            if (!result.ok) setError(result.error);
          })
        }
      >
        Try again
      </button>
      {error ? (
        <span className="chip" data-tone="danger">
          {error}
        </span>
      ) : null}
    </>
  );
}
