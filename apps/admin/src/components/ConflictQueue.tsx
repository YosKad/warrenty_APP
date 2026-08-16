'use client';

import { useState, useTransition } from 'react';

import { resolveConflict, type ConflictResolution } from '@/lib/actions/queues';

export type ConflictRow = {
  id: string;
  warranty_ids: string[];
  field: string;
  values_seen: Record<string, unknown>;
  detected_by: string;
  product_id: string | null;
  created_at: string;
};

export function ConflictQueue({
  conflicts,
  warranties,
  canReview,
}: {
  conflicts: ConflictRow[];
  warranties: Record<string, Record<string, unknown>>;
  canReview: boolean;
}) {
  return (
    <div className="stack">
      {conflicts.map((conflict) => (
        <ConflictCard
          key={conflict.id}
          conflict={conflict}
          warranties={warranties}
          canReview={canReview}
        />
      ))}
    </div>
  );
}

function ConflictCard({
  conflict,
  warranties,
  canReview,
}: {
  conflict: ConflictRow;
  warranties: Record<string, Record<string, unknown>>;
  canReview: boolean;
}) {
  const [chosen, setChosen] = useState<string>('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function resolve(resolution: ConflictResolution) {
    setMessage(null);
    startTransition(async () => {
      const result = await resolveConflict(conflict.id, resolution, {
        ...(chosen ? { chosenWarrantyId: chosen } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setMessage(result.ok ? 'Recorded.' : result.error);
    });
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{conflict.field.replace(/_/g, ' ')}</h2>
          <p className="panel-note">
            detected by {conflict.detected_by} ·{' '}
            {new Date(conflict.created_at).toISOString().slice(0, 10)}
          </p>
        </div>
      </div>

      <div className="panel-body stack">
        <div className="split">
          {conflict.warranty_ids.map((id) => {
            const warranty = warranties[id];
            const source = warranty?.source as
              | { kind?: string; document_title?: string; source_url?: string; verification?: string }
              | undefined;
            const brand = warranty?.brand as { name?: string } | undefined;
            const provider = warranty?.provider as { name?: string } | undefined;

            return (
              <label
                key={id}
                className="panel"
                style={{
                  padding: 10,
                  cursor: canReview ? 'pointer' : 'default',
                  borderColor: chosen === id ? 'var(--accent)' : undefined,
                }}
              >
                <div className="row" style={{ gap: 6 }}>
                  <input
                    type="radio"
                    name={`conflict-${conflict.id}`}
                    checked={chosen === id}
                    disabled={!canReview || pending}
                    style={{ width: 'auto' }}
                    onChange={() => setChosen(id)}
                  />
                  <strong>{brand?.name ?? 'Unknown brand'}</strong>
                  <span className="chip mono">
                    {(warranty?.model_pattern as string) ?? 'all models'}
                  </span>
                  {warranty?.country_code ? (
                    <span className="chip">{warranty.country_code as string}</span>
                  ) : null}
                </div>

                <table className="data" style={{ marginTop: 8 }}>
                  <tbody>
                    <tr>
                      <td>Duration</td>
                      <td className="num">
                        {(warranty?.duration_months as number) ?? '—'} months
                      </td>
                    </tr>
                    <tr>
                      <td>Honoured by</td>
                      <td>{provider?.name ?? <span className="muted">unknown</span>}</td>
                    </tr>
                    <tr>
                      <td>Version</td>
                      <td className="mono">
                        {(warranty?.policy_version as string) ?? (
                          <span className="muted">unnamed</span>
                        )}
                      </td>
                    </tr>
                    <tr>
                      <td>Source</td>
                      <td>
                        {source?.source_url ? (
                          <a href={source.source_url} target="_blank" rel="noreferrer noopener">
                            {source.document_title ?? source.source_url}
                          </a>
                        ) : (
                          source?.document_title ?? <span className="muted">none recorded</span>
                        )}
                        {source?.kind ? (
                          <span className="chip" style={{ marginInlineStart: 6 }}>
                            {source.kind}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                    <tr>
                      <td>Trust</td>
                      <td>
                        <span className="chip">{(warranty?.verification as string) ?? '—'}</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </label>
            );
          })}
        </div>

        <label className="field">
          When does each one apply?
          <textarea
            value={note}
            disabled={!canReview || pending}
            placeholder="e.g. the importer's terms apply to units bought from an official retailer after March 2024; the global terms apply to grey imports."
            onChange={(event) => setNote(event.target.value)}
          />
        </label>

        <div className="row">
          <button
            type="button"
            data-variant="primary"
            disabled={!canReview || pending || !chosen}
            onClick={() => resolve('chose_policy')}
          >
            This one applies
          </button>
          <button
            type="button"
            disabled={!canReview || pending || !note.trim()}
            onClick={() => resolve('both_valid')}
          >
            Both apply, in different cases
          </button>
          <button
            type="button"
            data-variant="danger"
            disabled={!canReview || pending || !chosen}
            onClick={() => resolve('rejected_source')}
          >
            The other source is wrong
          </button>
          <button
            type="button"
            disabled={!canReview || pending}
            onClick={() => resolve('needs_more_review')}
          >
            Leave open
          </button>
        </div>

        <p className="panel-note">
          None of these deletes a policy. The one that loses stays, with the
          record of why — it is evidence that two documents disagreed, and the
          next person should not have to rediscover that.
        </p>

        {message ? <p className="notice">{message}</p> : null}
      </div>
    </section>
  );
}
