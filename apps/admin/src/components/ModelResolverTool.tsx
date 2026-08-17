'use client';

import { useState, useTransition } from 'react';

import { resolveModelString, type ResolveModelResult } from '@/lib/actions/modelResolver';

const STAGE_LETTER: Record<string, string> = {
  canonical: 'A',
  alias: 'B',
  normalised: 'C',
  family: 'D',
  pattern: 'E',
  fuzzy: 'F',
};

const TRUST_TONE: Record<string, string> = {
  trusted: 'ok',
  probable: 'warn',
  weak: 'danger',
};

/**
 * The Model Resolver.
 *
 * Two jobs at once. An operator about to research a brand uses it to find out
 * whether the corpus can already recognise a product; whoever is debugging a
 * photographed receipt uses it to find out what the resolver read and where it
 * stopped. Both need the same thing: every stage, with its reasoning, not a
 * verdict.
 */
export function ModelResolverTool() {
  const [brandName, setBrandName] = useState('');
  const [model, setModel] = useState('');
  const [countryCode, setCountryCode] = useState('IL');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [importerName, setImporterName] = useState('');
  const [result, setResult] = useState<ResolveModelResult | null>(null);
  const [pending, startTransition] = useTransition();

  function run(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      setResult(
        await resolveModelString({
          brandName,
          model,
          countryCode,
          purchaseDate: purchaseDate || null,
          importerName: importerName || null,
        }),
      );
    });
  }

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Resolve a model</h2>
            <p className="panel-note">
              Reads the published corpus and runs the same matcher the app runs.
            </p>
          </div>
        </div>
        <div className="panel-body">
          <form className="row" onSubmit={run}>
            <label className="field" style={{ minWidth: 150 }}>
              Brand
              <input
                type="text"
                value={brandName}
                placeholder="Apple"
                disabled={pending}
                onChange={(event) => setBrandName(event.target.value)}
              />
            </label>
            <label className="field" style={{ minWidth: 260 }}>
              Model, exactly as it arrived
              <input
                type="text"
                value={model}
                placeholder="MacBook Air M4"
                disabled={pending}
                onChange={(event) => setModel(event.target.value)}
              />
            </label>
            <label className="field" style={{ maxWidth: 90 }}>
              Country
              <input
                type="text"
                value={countryCode}
                disabled={pending}
                onChange={(event) => setCountryCode(event.target.value)}
              />
            </label>
            <label className="field" style={{ maxWidth: 150 }}>
              Bought
              <input
                type="date"
                value={purchaseDate}
                disabled={pending}
                onChange={(event) => setPurchaseDate(event.target.value)}
              />
            </label>
            <label className="field" style={{ minWidth: 160 }}>
              Importer, if stated
              <input
                type="text"
                value={importerName}
                disabled={pending}
                onChange={(event) => setImporterName(event.target.value)}
              />
            </label>
            <button type="submit" data-variant="primary" disabled={pending}>
              {pending ? 'Resolving…' : 'Resolve'}
            </button>
          </form>
        </div>
      </section>

      {result && !result.ok ? (
        <p className="notice" data-tone="danger">
          {result.error}
        </p>
      ) : null}

      {result?.ok ? (
        <>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>
                  {result.resolution.state === 'resolved'
                    ? 'Resolved'
                    : result.resolution.state === 'ambiguous'
                      ? 'Ambiguous'
                      : 'Not resolved'}
                </h2>
                <p className="panel-note">{result.latencyMs} ms</p>
              </div>
              <span
                className="chip"
                data-tone={
                  result.resolution.state === 'resolved'
                    ? 'ok'
                    : result.resolution.state === 'ambiguous'
                      ? 'warn'
                      : 'danger'
                }
              >
                {result.resolution.state}
              </span>
            </div>

            <div className="panel-body split">
              <div className="stack">
                <h3>What it read</h3>
                <table className="data">
                  <tbody>
                    <tr>
                      <td>Raw</td>
                      <td className="mono" dir="auto">
                        {result.resolution.input.raw}
                      </td>
                    </tr>
                    <tr>
                      <td>Normalised</td>
                      <td className="mono">{result.resolution.input.normalised || '—'}</td>
                    </tr>
                    <tr>
                      <td>Identity</td>
                      <td className="mono">{result.resolution.input.identity || '—'}</td>
                    </tr>
                    <tr>
                      <td>Part codes</td>
                      <td className="mono">
                        {result.resolution.input.codes.join(', ') || '—'}
                      </td>
                    </tr>
                    <tr>
                      <td>Screen size</td>
                      <td className="num">{result.resolution.input.screenSize ?? '—'}</td>
                    </tr>
                    <tr>
                      <td>Capacity</td>
                      <td>{result.resolution.input.capacity ?? '—'}</td>
                    </tr>
                    <tr>
                      <td>Market suffix</td>
                      <td className="mono">{result.resolution.input.region ?? '—'}</td>
                    </tr>
                    {result.resolution.ocr ? (
                      <tr>
                        <td>OCR</td>
                        <td>
                          {result.resolution.ocr.corrected
                            ? `read as “${result.resolution.ocr.corrected}”`
                            : result.resolution.ocr.ambiguous
                              ? 'more than one reading, so none applied'
                              : 'no repair needed'}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <div className="stack">
                <h3>Reasoning</h3>
                <ol style={{ margin: 0, paddingInlineStart: 18, fontSize: 13 }}>
                  {result.resolution.explanation.map((line, index) => (
                    <li key={index} style={{ marginBottom: 4 }}>
                      {line}
                    </li>
                  ))}
                </ol>

                {result.resolution.distinguishers.length > 0 ? (
                  <p className="notice" data-tone="warn">
                    To settle it, ask for:{' '}
                    {result.resolution.distinguishers.map((d) => d.replace(/_/g, ' ')).join(', ')}
                  </p>
                ) : null}

                <p className="panel-note">
                  {result.probe.models.length} model
                  {result.probe.models.length === 1 ? '' : 's'} and{' '}
                  {result.probe.patterns.length} policy pattern
                  {result.probe.patterns.length === 1 ? '' : 's'} were available to match against.
                </p>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Candidates</h2>
              <span className="panel-note">
                Only trusted stages resolve on their own
              </span>
            </div>
            {result.resolution.candidates.length === 0 ? (
              <p className="empty">Nothing matched at any stage.</p>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Stage</th>
                      <th>Trust</th>
                      <th>Matched</th>
                      <th>Relation</th>
                      <th>Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.resolution.candidates.map((candidate, index) => (
                      <tr key={index}>
                        <td className="mono">
                          {STAGE_LETTER[candidate.stage]} · {candidate.stage}
                        </td>
                        <td>
                          <span className="chip" data-tone={TRUST_TONE[candidate.trust]}>
                            {candidate.trust}
                          </span>
                        </td>
                        <td dir="auto">
                          {candidate.model?.canonicalModel ??
                            (candidate.warrantyId ? 'policy pattern' : '—')}
                        </td>
                        <td className="muted">{candidate.relation}</td>
                        <td>
                          {candidate.evidence.map((line, i) => (
                            <div key={i} style={{ fontSize: 12 }}>
                              {line}
                            </div>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {result.policies.length > 0 ? (
            <section className="panel">
              <div className="panel-head">
                <h2>Policies attached to the resolved model</h2>
              </div>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Version</th>
                      <th className="num">Months</th>
                      <th>Honoured by</th>
                      <th>Trust</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.policies.map((policy) => (
                      <tr key={policy.warrantyId}>
                        <td className="mono">{policy.policyVersion ?? '—'}</td>
                        <td className="num">{policy.durationMonths ?? '—'}</td>
                        <td>{policy.providerName ?? <span className="muted">unknown</span>}</td>
                        <td>
                          <span className="chip">{policy.verification}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
