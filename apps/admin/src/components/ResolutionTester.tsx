'use client';

import { useState, useTransition } from 'react';

import { rerunSuite, runResolutionSuite, type RunResult, type TestCase } from '@/lib/actions/resolution';

const BLANK: TestCase = {
  label: '',
  brandName: '',
  model: '',
  countryCode: 'IL',
  purchaseDate: null,
  importerName: null,
  retailerName: null,
};

/**
 * Enter a receipt, see what the app would say.
 *
 * The synthetic switch is not decoration. A case somebody invented measures
 * whether the corpus can answer a question that was written to be answerable; a
 * case copied off a real receipt measures the product. Conflating the two is
 * how a data-coverage number gets quoted as an accuracy figure, so the flag is
 * required before anything runs and is stored on every row.
 */
export function ResolutionTester({ suites }: { suites: [string, boolean][] }) {
  const [suite, setSuite] = useState('');
  const [synthetic, setSynthetic] = useState<boolean | null>(null);
  const [cases, setCases] = useState<TestCase[]>([{ ...BLANK }]);
  const [results, setResults] = useState<RunResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function update(index: number, patch: Partial<TestCase>) {
    setCases((current) =>
      current.map((testCase, i) => (i === index ? { ...testCase, ...patch } : testCase)),
    );
  }

  function run() {
    setError(null);
    setResults(null);
    if (synthetic === null) {
      setError('Say whether these cases are real or synthetic before running them.');
      return;
    }
    startTransition(async () => {
      const result = await runResolutionSuite(suite, synthetic, cases.filter((c) => c.brandName));
      if (result.ok) setResults(result.results);
      else setError(result.error);
    });
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Run a case</h2>
          <p className="panel-note">
            Reads the published production corpus, exactly as the app does.
          </p>
        </div>
        <div className="row">
          {suites.map(([name, isSynthetic]) => (
            <button
              key={name}
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const result = await rerunSuite(name);
                  if (result.ok) setResults(result.results);
                  else setError(result.error);
                })
              }
            >
              Re-run {name}
              {isSynthetic ? ' (synthetic)' : ''}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-body stack">
        <div className="row">
          <label className="field" style={{ minWidth: 220 }}>
            Suite name
            <input
              type="text"
              value={suite}
              placeholder="e.g. israel-pilot-2026-08"
              disabled={pending}
              onChange={(event) => setSuite(event.target.value)}
            />
          </label>

          <label className="field" style={{ minWidth: 260 }}>
            Where did these cases come from?
            <select
              value={synthetic === null ? '' : synthetic ? 'synthetic' : 'real'}
              disabled={pending}
              onChange={(event) =>
                setSynthetic(event.target.value === '' ? null : event.target.value === 'synthetic')
              }
            >
              <option value="">Choose…</option>
              <option value="real">Copied from real receipts</option>
              <option value="synthetic">Written by hand (synthetic)</option>
            </select>
          </label>
        </div>

        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Label</th>
                <th>Brand</th>
                <th>Model</th>
                <th>Country</th>
                <th>Bought</th>
                <th>Importer, if the receipt says</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((testCase, index) => (
                <tr key={index}>
                  <td>
                    <input
                      type="text"
                      value={testCase.label}
                      disabled={pending}
                      onChange={(event) => update(index, { label: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={testCase.brandName}
                      disabled={pending}
                      onChange={(event) => update(index, { brandName: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={testCase.model}
                      disabled={pending}
                      onChange={(event) => update(index, { model: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={testCase.countryCode}
                      disabled={pending}
                      style={{ maxWidth: 70 }}
                      onChange={(event) => update(index, { countryCode: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="date"
                      value={testCase.purchaseDate ?? ''}
                      disabled={pending}
                      onChange={(event) =>
                        update(index, { purchaseDate: event.target.value || null })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={testCase.importerName ?? ''}
                      disabled={pending}
                      onChange={(event) =>
                        update(index, { importerName: event.target.value || null })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="row">
          <button
            type="button"
            disabled={pending}
            onClick={() => setCases((current) => [...current, { ...BLANK }])}
          >
            Add a case
          </button>
          <button type="button" data-variant="primary" disabled={pending} onClick={run}>
            {pending ? 'Running…' : 'Run'}
          </button>
        </div>

        {error ? (
          <p className="notice" data-tone="danger">
            {error}
          </p>
        ) : null}

        {results ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Product</th>
                  <th>Warranty</th>
                  <th>Provider</th>
                  <th>Route</th>
                  <th>Contact</th>
                  <th>Why not</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result, index) => (
                  <tr key={index}>
                    <td>
                      {result.label || `case ${index + 1}`}
                      {result.outcome.fullyResolved ? (
                        <span className="chip" data-tone="ok" style={{ marginInlineStart: 6 }}>
                          resolved
                        </span>
                      ) : null}
                    </td>
                    <Stage passed={result.outcome.stages.product_identified} />
                    <Stage passed={result.outcome.stages.warranty_resolved} />
                    <Stage passed={result.outcome.stages.provider_resolved} />
                    <Stage passed={result.outcome.stages.service_route_resolved} />
                    <Stage passed={result.outcome.stages.contact_actionable} />
                    <td className="muted" style={{ fontSize: 12 }}>
                      {result.outcome.failureReasons.length === 0
                        ? '—'
                        : result.outcome.failureReasons.map((r) => r.replace(/_/g, ' ')).join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Stage({ passed }: { passed: boolean }) {
  return (
    <td>
      <span className="chip" data-tone={passed ? 'ok' : 'danger'}>
        {passed ? 'yes' : 'no'}
      </span>
    </td>
  );
}
