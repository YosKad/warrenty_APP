'use client';

import { useState, useTransition } from 'react';

import { resolveDuplicate, runImport, saveMapping, validateImport } from '@/lib/actions/import';
import { TARGETS, type ImportTarget } from '@/lib/import/targets';

export type ImportRow = {
  id: string;
  row_number: number;
  raw: Record<string, string>;
  mapped: Record<string, unknown> | null;
  status: string;
  errors: string[];
  duplicate_of: string | null;
  duplicate_reason: string | null;
  duplicate_score: number | null;
};

/**
 * The import workbench.
 *
 * Mapping, preview, error report and duplicate review on one screen, because
 * they are one decision: the operator is working out whether this file is safe
 * to bring in, and splitting that across four pages just hides the part they
 * needed to see.
 */
export function ImportWorkbench({
  jobId,
  status,
  target,
  headers,
  mapping: initialMapping,
  counts,
  sample,
  problems,
  canEdit,
}: {
  jobId: string;
  status: string;
  target: ImportTarget;
  headers: string[];
  mapping: Record<string, string>;
  counts: { total: number; valid: number; invalid: number; duplicate: number; imported: number };
  sample: ImportRow[];
  problems: ImportRow[];
  canEdit: boolean;
}) {
  const spec = TARGETS[target];
  const [mapping, setMapping] = useState(initialMapping);
  const [message, setMessage] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const unmappedRequired = spec.fields.filter((field) => field.required && !mapping[field.key]);

  function act(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setMessage({ tone: 'danger', text: result.error ?? 'That did not work.' });
    });
  }

  const invalid = problems.filter((row) => row.status === 'invalid');
  const duplicates = problems.filter((row) => row.status === 'duplicate');

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>1 · Map the columns</h2>
            <p className="panel-note">
              Guessed from the header row. Check every one — a column called
              “Phone” meaning the fax number is not something a list of aliases
              can know.
            </p>
          </div>
          <button
            type="button"
            disabled={!canEdit || pending}
            onClick={() => act(() => saveMapping(jobId, mapping))}
          >
            Save mapping
          </button>
        </div>
        <div className="panel-body">
          <div className="grid grid-2">
            {spec.fields.map((field) => (
              <label key={field.key} className="field">
                {field.label}
                {field.required ? <span className="muted"> · required</span> : null}
                <select
                  value={mapping[field.key] ?? ''}
                  disabled={!canEdit || pending}
                  onChange={(event) =>
                    setMapping((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                >
                  <option value="">not in this file</option>
                  {headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
                {field.hint ? <span className="panel-note">{field.hint}</span> : null}
              </label>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>2 · Check every row</h2>
            <p className="panel-note">
              Nothing is written yet. This pass only reads the file and compares
              it against what already exists.
            </p>
          </div>
          <button
            type="button"
            data-variant="primary"
            disabled={!canEdit || pending || unmappedRequired.length > 0}
            onClick={() => act(() => validateImport(jobId))}
          >
            {pending ? 'Checking…' : 'Validate'}
          </button>
        </div>
        <div className="panel-body">
          {unmappedRequired.length > 0 ? (
            <p className="notice" data-tone="warn">
              Map these first: {unmappedRequired.map((field) => field.label).join(', ')}
            </p>
          ) : null}

          <div className="grid grid-3">
            <Counter label="Rows" value={counts.total} />
            <Counter label="Ready" value={counts.valid} tone={counts.valid > 0 ? 'ok' : undefined} />
            <Counter
              label="Errors"
              value={counts.invalid}
              tone={counts.invalid > 0 ? 'danger' : undefined}
            />
            <Counter
              label="Possible duplicates"
              value={counts.duplicate}
              tone={counts.duplicate > 0 ? 'warn' : undefined}
            />
            <Counter label="Imported" value={counts.imported} />
          </div>
        </div>
      </section>

      {invalid.length > 0 ? (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Rows that could not be read</h2>
              <p className="panel-note">
                Each one with its reason. Fix the file and upload it again, or
                import the rest and handle these by hand.
              </p>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="num">Row</th>
                  <th>What went wrong</th>
                  <th>As it appears in the file</th>
                </tr>
              </thead>
              <tbody>
                {invalid.map((row) => (
                  <tr key={row.id}>
                    <td className="num">{row.row_number}</td>
                    <td>
                      <ul style={{ margin: 0, paddingInlineStart: 16 }}>
                        {row.errors.map((error, index) => (
                          <li key={index} style={{ color: 'var(--danger)' }}>
                            {error}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="mono muted" dir="auto" style={{ fontSize: 11, maxWidth: 420 }}>
                      {Object.entries(row.raw)
                        .filter(([, value]) => value)
                        .map(([key, value]) => `${key}=${value}`)
                        .join('  ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {duplicates.length > 0 ? (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Possible duplicates</h2>
              <p className="panel-note">
                Nothing has been merged. The losing side of an automatic merge is
                often the better-researched record, and once it is gone there is
                no way to find that out.
              </p>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="num">Row</th>
                  <th>Incoming</th>
                  <th>Why we think it already exists</th>
                  <th className="num">Score</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {duplicates.map((row) => (
                  <tr key={row.id}>
                    <td className="num">{row.row_number}</td>
                    <td dir="auto">
                      {String(
                        (row.mapped?.name as string) ??
                          (row.mapped?.city as string) ??
                          row.row_number,
                      )}
                    </td>
                    <td className="muted">{row.duplicate_reason}</td>
                    <td className="num">
                      {row.duplicate_score !== null
                        ? Math.round(Number(row.duplicate_score) * 100)
                        : '—'}
                    </td>
                    <td>
                      <div className="row">
                        <button
                          type="button"
                          disabled={!canEdit || pending}
                          onClick={() => act(() => resolveDuplicate(row.id, 'distinct'))}
                        >
                          Different company
                        </button>
                        <button
                          type="button"
                          disabled={!canEdit || pending}
                          onClick={() => act(() => resolveDuplicate(row.id, 'skip'))}
                        >
                          Already have it
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>3 · Import</h2>
            <p className="panel-note">
              Creates {counts.valid} candidate record{counts.valid === 1 ? '' : 's'}. Nothing
              becomes visible to users until a reviewer publishes it.
            </p>
          </div>
          <button
            type="button"
            data-variant="primary"
            disabled={!canEdit || pending || status !== 'preview' || counts.valid === 0}
            onClick={() => act(() => runImport(jobId))}
          >
            Import {counts.valid} rows
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>The file, as read</h2>
          <span className="panel-note">first {sample.length} rows</span>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th className="num">Row</th>
                {headers.map((header) => (
                  <th key={header}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sample.map((row) => (
                <tr key={row.id}>
                  <td className="num">{row.row_number}</td>
                  {headers.map((header) => (
                    <td key={header} dir="auto">
                      {row.raw[header] || <span className="muted">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {message ? (
        <p className="notice" data-tone={message.tone}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

function Counter({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'ok' | 'warn' | 'danger';
}) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div
        className="metric-value"
        style={
          tone
            ? {
                color:
                  tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warning)' : 'var(--danger)',
              }
            : undefined
        }
      >
        {value}
      </div>
    </div>
  );
}
