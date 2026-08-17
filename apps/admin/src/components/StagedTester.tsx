'use client';

import { useState, useTransition } from 'react';

import { runStagedResolution, type StagedRunResult } from '@/lib/actions/modelResolver';

const STAGE_LABEL: Record<string, string> = {
  product: 'Product',
  model: 'Model',
  warranty: 'Warranty',
  importer: 'Importer',
  warranty_provider: 'Warranty provider',
  service_provider: 'Service provider',
  contact: 'Contact',
  full_resolution: 'Full resolution',
};

const STATE_TONE: Record<string, string> = {
  resolved: 'ok',
  ambiguous: 'warn',
  missing: 'danger',
};

/**
 * One case, every stage, with its reasoning.
 *
 * A single Full Resolution figure says whether the product worked. This says
 * *where* it stopped, what it matched, where that record came from, and how
 * long each step took — which is the difference between a number and a task.
 */
export function StagedTester() {
  const [form, setForm] = useState({
    brandName: 'Apple',
    model: 'MacBook Air M4',
    countryCode: 'IL',
    purchaseDate: '',
    importerName: '',
    retailerName: '',
    serialNumber: '',
  });
  const [result, setResult] = useState<StagedRunResult | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));

  function run(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      setResult(
        await runStagedResolution({
          brandName: form.brandName,
          model: form.model,
          countryCode: form.countryCode,
          purchaseDate: form.purchaseDate || null,
          importerName: form.importerName || null,
          retailerName: form.retailerName || null,
          serialNumber: form.serialNumber || null,
        }),
      );
    });
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Trace one case</h2>
          <p className="panel-note">
            Every stage, with what it matched and why. Not a score.
          </p>
        </div>
      </div>

      <div className="panel-body stack">
        <form className="row" onSubmit={run}>
          <label className="field" style={{ minWidth: 130 }}>
            Brand
            <input
              type="text"
              value={form.brandName}
              disabled={pending}
              onChange={(event) => set({ brandName: event.target.value })}
            />
          </label>
          <label className="field" style={{ minWidth: 230 }}>
            Model
            <input
              type="text"
              value={form.model}
              disabled={pending}
              onChange={(event) => set({ model: event.target.value })}
            />
          </label>
          <label className="field" style={{ maxWidth: 80 }}>
            Country
            <input
              type="text"
              value={form.countryCode}
              disabled={pending}
              onChange={(event) => set({ countryCode: event.target.value })}
            />
          </label>
          <label className="field" style={{ maxWidth: 150 }}>
            Bought
            <input
              type="date"
              value={form.purchaseDate}
              disabled={pending}
              onChange={(event) => set({ purchaseDate: event.target.value })}
            />
          </label>
          <label className="field" style={{ minWidth: 150 }}>
            Importer on the receipt
            <input
              type="text"
              value={form.importerName}
              disabled={pending}
              onChange={(event) => set({ importerName: event.target.value })}
            />
          </label>
          <label className="field" style={{ minWidth: 140 }}>
            Serial
            <input
              type="text"
              value={form.serialNumber}
              disabled={pending}
              onChange={(event) => set({ serialNumber: event.target.value })}
            />
          </label>
          <button type="submit" data-variant="primary" disabled={pending}>
            {pending ? 'Tracing…' : 'Trace'}
          </button>
        </form>

        {result && !result.ok ? (
          <p className="notice" data-tone="danger">
            {result.error}
          </p>
        ) : null}

        {result?.ok ? (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Stage</th>
                    <th>State</th>
                    <th>Matched</th>
                    <th>Source</th>
                    <th>Why</th>
                    <th className="num">ms</th>
                  </tr>
                </thead>
                <tbody>
                  {result.stages.map((stage) => (
                    <tr key={stage.stage}>
                      <td>{STAGE_LABEL[stage.stage] ?? stage.stage}</td>
                      <td>
                        <span className="chip" data-tone={STATE_TONE[stage.state]}>
                          {stage.state}
                        </span>
                      </td>
                      <td dir="auto">
                        {stage.record ?? <span className="muted">—</span>}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {stage.source ?? '—'}
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {stage.why.map((line, index) => (
                          <div key={index} dir="auto">
                            {line}
                          </div>
                        ))}
                      </td>
                      <td className="num">{stage.latencyMs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="row">
              <span className="chip" data-tone={result.outcome.fullyResolved ? 'ok' : 'danger'}>
                {result.outcome.fullyResolved ? 'fully resolved' : 'not resolved'}
              </span>
              {result.outcome.autoResolved ? (
                <span className="chip" data-tone="ok">
                  automatic
                </span>
              ) : null}
              {result.outcome.ambiguous ? (
                <span className="chip" data-tone="warn">
                  ambiguous — the app would ask
                </span>
              ) : null}
              <span className="panel-note">{result.totalMs} ms total</span>
            </div>

            {result.outcome.distinguishers.length > 0 ? (
              <p className="notice" data-tone="warn">
                It would ask the user for:{' '}
                {result.outcome.distinguishers.map((d) => d.replace(/_/g, ' ')).join(', ')}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
