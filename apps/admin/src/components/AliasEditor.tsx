'use client';

import { useState, useTransition } from 'react';
import { parseModel } from '@mw/domain';

import { createRecord, setPublicationStatus } from '@/lib/actions/records';

export type AliasRow = {
  id: string;
  value: string;
  normalized_key: string;
  kind: string;
  verification: string;
  publication_status: string;
  proposed_by: string | null;
  source_id: string | null;
};

const KINDS = [
  'trading_name',
  'regional_code',
  'abbreviation',
  'retailer_name',
  'ocr_variant',
  'legacy',
];

/**
 * Adding and approving the ways a product can be written.
 *
 * The normalised key is computed here, by the same `parseModel` the matcher
 * uses, and shown before saving. That is deliberate: an operator adding
 * "MacBook Air 13-inch M4" should be able to see that it folds to the same key
 * as the canonical name — that is *why* it works — and an operator adding
 * something that folds to a surprising key should find out before it is stored.
 */
export function AliasEditor({
  modelId,
  aliases,
  brands,
  canEdit,
  canReview,
}: {
  modelId: string;
  aliases: AliasRow[];
  brands: string[];
  canEdit: boolean;
  canReview: boolean;
}) {
  const [value, setValue] = useState('');
  const [kind, setKind] = useState('trading_name');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const preview = value.trim() ? parseModel(value, { brands }) : null;

  function add(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await createRecord(
        'model_aliases',
        {
          model_id: modelId,
          value: value.trim(),
          normalized_key: preview?.normalised ?? '',
          kind,
        },
        'alias added by hand',
      );
      if (result.ok) {
        setValue('');
        setMessage('Added as a candidate. A reviewer has to approve it before it resolves.');
      } else {
        setMessage(result.error);
      }
    });
  }

  function approve(id: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await setPublicationStatus('model_aliases', id, 'verified');
      if (!result.ok) setMessage(result.error);
    });
  }

  function reject(id: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await setPublicationStatus('model_aliases', id, 'rejected');
      if (!result.ok) setMessage(result.error);
    });
  }

  const usable = (alias: AliasRow) =>
    (alias.publication_status === 'published' || alias.publication_status === 'verified') &&
    alias.verification !== 'unverified' &&
    alias.verification !== 'ai_extracted';

  return (
    <div className="stack">
      {aliases.length === 0 ? (
        <p className="empty">
          No aliases. This product is findable only by its exact canonical name.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Spelling</th>
                <th>Kind</th>
                <th>Key</th>
                <th>Resolves?</th>
                <th>Proposed by</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {aliases.map((alias) => (
                <tr key={alias.id}>
                  <td className="mono" dir="auto">
                    {alias.value}
                  </td>
                  <td className="muted">{alias.kind.replace(/_/g, ' ')}</td>
                  <td className="mono muted" style={{ fontSize: 11 }}>
                    {alias.normalized_key}
                  </td>
                  <td>
                    <span className="chip" data-tone={usable(alias) ? 'ok' : 'warn'}>
                      {usable(alias) ? 'yes' : `no — ${alias.publication_status.replace(/_/g, ' ')}`}
                    </span>
                  </td>
                  <td className="muted">
                    {alias.proposed_by ?? <span className="muted">a person</span>}
                    {alias.source_id ? null : (
                      <span className="chip" style={{ marginInlineStart: 6 }}>
                        no source
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: 'end' }}>
                    {usable(alias) ? null : (
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          disabled={!canReview || pending}
                          onClick={() => approve(alias.id)}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          data-variant="danger"
                          disabled={!canEdit || pending}
                          onClick={() => reject(alias.id)}
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form className="row" onSubmit={add}>
        <label className="field" style={{ minWidth: 260 }}>
          Another way this is written
          <input
            type="text"
            value={value}
            placeholder="MBA M4"
            dir="auto"
            disabled={!canEdit || pending}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        <label className="field" style={{ minWidth: 180 }}>
          Kind
          <select
            value={kind}
            disabled={!canEdit || pending}
            onChange={(event) => setKind(event.target.value)}
          >
            {KINDS.map((option) => (
              <option key={option} value={option}>
                {option.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={!canEdit || pending || !value.trim()}>
          Add as candidate
        </button>
      </form>

      {preview ? (
        <p className="panel-note mono">
          folds to “{preview.normalised || '—'}”
          {preview.screenSize !== null ? ` · ${preview.screenSize}"` : ''}
          {preview.region ? ` · market ${preview.region}` : ''}
        </p>
      ) : null}

      {message ? <p className="notice">{message}</p> : null}
    </div>
  );
}
