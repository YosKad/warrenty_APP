'use client';

import { useState, useTransition } from 'react';

import { setPublicationStatus, updateRecord } from '@/lib/actions/records';

export type ClauseRow = {
  id: string;
  ordinal: number;
  clause_type: string;
  title: string | null;
  summary: string | null;
  clause_text: string;
  section: string | null;
  source_section: string | null;
  source_page: number | null;
  language: string | null;
  confidence: string;
  verification: string;
  extracted_by: string | null;
  publication_status: string;
};

const CLAUSE_TYPES = [
  'coverage',
  'exclusion',
  'condition',
  'procedure',
  'duration',
  'service_fee',
  'claim_requirement',
  'geographic_restriction',
  'other',
];

/**
 * Clause review, against the source.
 *
 * The verbatim text is on the left and is not editable — it is what the
 * document says, and a console that lets someone "tidy" it destroys the only
 * citable thing in the record. The right side is the derived layer: a type, a
 * short title, a plain-language summary, any of which a model may have written
 * and none of which is trustworthy until a person has read both halves
 * together.
 *
 * That is the whole reason this screen is side by side rather than a form.
 */
export function ClauseReview({
  clauses,
  canEdit,
  canReview,
}: {
  clauses: ClauseRow[];
  canEdit: boolean;
  canReview: boolean;
}) {
  const [query, setQuery] = useState('');
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(false);

  const visible = clauses.filter((clause) => {
    // Verified counts as reviewed. Publishing happens at the policy level —
    // a clause going live on its own, without the policy it belongs to, is not
    // a state the app has any use for.
    if (
      onlyUnreviewed &&
      (clause.publication_status === 'published' || clause.publication_status === 'verified')
    ) {
      return false;
    }
    if (!query) return true;
    const needle = query.toLowerCase();
    return (
      clause.clause_text.toLowerCase().includes(needle) ||
      (clause.title ?? '').toLowerCase().includes(needle) ||
      (clause.summary ?? '').toLowerCase().includes(needle)
    );
  });

  return (
    <div className="stack">
      <div className="row">
        <input
          type="text"
          value={query}
          placeholder="Search the clause text…"
          onChange={(event) => setQuery(event.target.value)}
          style={{ maxWidth: 320 }}
        />
        <label className="row" style={{ gap: 5, fontSize: 12 }}>
          <input
            type="checkbox"
            checked={onlyUnreviewed}
            style={{ width: 'auto' }}
            onChange={(event) => setOnlyUnreviewed(event.target.checked)}
          />
          Only unreviewed
        </label>
        <span className="panel-note">
          {visible.length} of {clauses.length}
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="empty">No clauses match.</p>
      ) : (
        visible.map((clause) => (
          <ClauseCard
            key={clause.id}
            clause={clause}
            canEdit={canEdit}
            canReview={canReview}
          />
        ))
      )}
    </div>
  );
}

function ClauseCard({
  clause,
  canEdit,
  canReview,
}: {
  clause: ClauseRow;
  canEdit: boolean;
  canReview: boolean;
}) {
  const [type, setType] = useState(clause.clause_type);
  const [title, setTitle] = useState(clause.title ?? '');
  const [summary, setSummary] = useState(clause.summary ?? '');
  const [status, setStatus] = useState(clause.publication_status);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const machineWritten =
    clause.extracted_by !== null && clause.extracted_by !== 'human';

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await updateRecord(
        'warranty_terms',
        clause.id,
        {
          clause_type: type,
          title: title.trim() || null,
          summary: summary.trim() || null,
          // A person edited the derived layer, so it is no longer a machine's
          // reading of the document. Leaving `ai_extracted` here would have the
          // app label a reviewer's own words as an extraction.
          verification: 'verified',
        },
        'clause review',
      );
      setMessage(result.ok ? 'Saved.' : result.error);
    });
  }

  function move(next: 'verified' | 'rejected' | 'needs_review') {
    setMessage(null);
    startTransition(async () => {
      const result = await setPublicationStatus('warranty_terms', clause.id, next);
      if (result.ok) setStatus(next);
      else setMessage(result.error);
    });
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div className="row" style={{ gap: 6 }}>
          <span className="chip mono">#{clause.ordinal}</span>
          <span className="chip">{clause.clause_type.replace(/_/g, ' ')}</span>
          {machineWritten ? (
            <span className="chip" data-tone="warn">
              {clause.extracted_by}
            </span>
          ) : null}
          <span
            className="chip"
            data-tone={status === 'published' || status === 'verified' ? 'ok' : 'info'}
          >
            {status.replace(/_/g, ' ')}
          </span>
        </div>
        <span className="panel-note">
          {clause.source_section ?? clause.section ?? 'section unknown'}
          {clause.source_page !== null ? ` · page ${clause.source_page}` : ''}
        </span>
      </div>

      <div className="panel-body split">
        <div className="stack">
          <h3>As published in the document</h3>
          {/*
            `dir="auto"` and not `ltr`: an Israeli warranty booklet is Hebrew,
            and forcing a direction here makes the text unreadable in exactly
            the market this corpus starts in.
          */}
          <div className="source-text" dir="auto">
            {clause.clause_text}
          </div>
        </div>

        <div className="stack">
          <h3>What we tell the user</h3>

          <label className="field">
            Type
            <select
              value={type}
              disabled={!canEdit || pending}
              onChange={(event) => setType(event.target.value)}
            >
              {CLAUSE_TYPES.map((option) => (
                <option key={option} value={option}>
                  {option.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            Title
            <input
              type="text"
              value={title}
              dir="auto"
              disabled={!canEdit || pending}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>

          <label className="field">
            Plain-language summary
            <textarea
              value={summary}
              dir="auto"
              disabled={!canEdit || pending}
              onChange={(event) => setSummary(event.target.value)}
            />
            <span className="panel-note">
              Restate the clause. Do not extend it — if the document does not say
              whether something is covered, neither do we.
            </span>
          </label>

          <div className="row">
            <button type="button" onClick={save} disabled={!canEdit || pending}>
              Save
            </button>
            <button
              type="button"
              data-variant="primary"
              onClick={() => move('verified')}
              disabled={!canReview || pending || status === 'verified' || status === 'published'}
            >
              Approve
            </button>
            <button
              type="button"
              data-variant="danger"
              onClick={() => move('rejected')}
              disabled={!canEdit || pending}
            >
              Reject
            </button>
          </div>

          {message ? <p className="notice">{message}</p> : null}
        </div>
      </div>
    </section>
  );
}
