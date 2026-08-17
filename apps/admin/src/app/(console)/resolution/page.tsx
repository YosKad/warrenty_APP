import { Metric, PageHeader, Panel, Empty } from '@/components/ui';
import { ResolutionTester } from '@/components/ResolutionTester';
import { StagedTester } from '@/components/StagedTester';
import { requireAdmin } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * The Full Resolution Rate, and the tool that produces it.
 *
 * Five stages, all of which must hold. A warranty resolved against a provider
 * nobody can reach is not a resolved warranty, so the headline is conjunctive
 * and the partial rates sit underneath it — they tell an operator which table
 * to go and fill in, and they are never reported instead of the headline.
 */
export default async function ResolutionPage() {
  await requireAdmin();
  const supabase = await supabaseServer();

  const [{ data: rates }, { data: recent }, { data: suites }] = await Promise.all([
    supabase.rpc('resolution_rates').maybeSingle(),
    supabase
      .from('resolution_runs')
      .select(
        'id, suite, label, brand_name, model, country_code, product_identified, warranty_resolved, provider_resolved, service_route_resolved, contact_actionable, failure_reasons, match_score, match_state, detail, created_at',
      )
      .order('created_at', { ascending: false })
      .limit(60),
    supabase
      .from('resolution_runs')
      .select('suite, detail, created_at')
      .order('created_at', { ascending: false })
      .limit(400),
  ]);

  const kpi = rates as {
    total: number;
    product_identification_rate: number | null;
    warranty_resolution_rate: number | null;
    provider_resolution_rate: number | null;
    service_route_resolution_rate: number | null;
    full_resolution_rate: number | null;
    auto_resolution_rate: number | null;
    ambiguity_rate: number | null;
    reviewed: number;
    false_resolution_rate: number | null;
  } | null;

  const suiteNames = [
    ...new Map(
      (suites ?? [])
        .filter((run) => run.suite)
        .map((run) => [
          run.suite as string,
          Boolean((run.detail as { synthetic?: boolean })?.synthetic),
        ]),
    ).entries(),
  ];

  // How often each reason blocked a case, so the next task comes out of the
  // data rather than out of a hunch.
  const reasonCounts = new Map<string, number>();
  for (const run of recent ?? []) {
    for (const reason of run.failure_reasons ?? []) {
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
  }
  const rankedReasons = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1]);

  const pct = (value: number | null | undefined) =>
    value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`;

  return (
    <main className="content">
      <PageHeader
        title="Resolution tester"
        subtitle="What a user with this receipt would actually be told, measured against the live corpus."
      />

      <Panel title="Rates across every recorded run">
        <div className="grid grid-3">
          <Metric
            label="Fully resolved"
            value={pct(kpi?.full_resolution_rate)}
            ratio={kpi?.full_resolution_rate ?? 0}
            note={`${kpi?.total ?? 0} runs`}
          />
          <Metric
            label="Product identified"
            value={pct(kpi?.product_identification_rate)}
            ratio={kpi?.product_identification_rate ?? 0}
          />
          <Metric
            label="Warranty resolved"
            value={pct(kpi?.warranty_resolution_rate)}
            ratio={kpi?.warranty_resolution_rate ?? 0}
          />
          <Metric
            label="Provider resolved"
            value={pct(kpi?.provider_resolution_rate)}
            ratio={kpi?.provider_resolution_rate ?? 0}
          />
          <Metric
            label="Service route resolved"
            value={pct(kpi?.service_route_resolution_rate)}
            ratio={kpi?.service_route_resolution_rate ?? 0}
          />
        </div>
      </Panel>

      <Panel
        title="Quality"
        note="Correctness before raw resolution. A case we answered wrongly costs a user a wasted trip; a case we could not answer costs them a search."
      >
        <div className="grid grid-3">
          <Metric
            label="Auto resolution"
            value={pct(kpi?.auto_resolution_rate)}
            ratio={kpi?.auto_resolution_rate ?? 0}
            note="resolved without asking the user anything"
          />
          <Metric
            label="Ambiguity"
            value={pct(kpi?.ambiguity_rate)}
            ratio={kpi?.ambiguity_rate ?? 0}
            note="several credible answers, so we asked"
          />
          <Metric
            label="False resolution"
            value={pct(kpi?.false_resolution_rate)}
            ratio={kpi?.false_resolution_rate ?? 0}
            note={`over ${kpi?.reviewed ?? 0} reviewed run${kpi?.reviewed === 1 ? '' : 's'}`}
          />
        </div>
        <p className="panel-note" style={{ marginTop: 8 }}>
          False resolution is measured over reviewed runs only. Dividing by every
          run would drive it towards zero simply by running the suite more often,
          which is a metric that rewards not looking.
        </p>
      </Panel>

      <StagedTester />

      <ResolutionTester suites={suiteNames} />

      <div className="split">
        <Panel
          title="Why cases fail"
          note="Ordered by how many runs each reason blocked."
          padded={false}
        >
          {rankedReasons.length === 0 ? (
            <Empty>No failures recorded.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Reason</th>
                    <th className="num">Runs</th>
                  </tr>
                </thead>
                <tbody>
                  {rankedReasons.map(([reason, count]) => (
                    <tr key={reason}>
                      <td>{reason.replace(/_/g, ' ')}</td>
                      <td className="num">{count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Recent runs" padded={false}>
          {(recent ?? []).length === 0 ? (
            <Empty>Nothing run yet.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Case</th>
                    <th>Stages</th>
                    <th className="num">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {(recent ?? []).map((run) => (
                    <tr key={run.id}>
                      <td>
                        {run.label ?? `${run.brand_name} ${run.model ?? ''}`}
                        <div className="muted" style={{ fontSize: 11 }}>
                          {run.suite}
                          {(run.detail as { synthetic?: boolean })?.synthetic ? (
                            <span className="chip" data-tone="warn" style={{ marginInlineStart: 6 }}>
                              synthetic
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <StageDots
                          stages={[
                            run.product_identified,
                            run.warranty_resolved,
                            run.provider_resolved,
                            run.service_route_resolved,
                            run.contact_actionable,
                          ]}
                        />
                      </td>
                      <td className="num">{run.match_score ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <p className="notice" data-tone="warn">
        A synthetic suite measures the corpus, not the product. It says whether
        the data can answer a question somebody wrote down — not whether real
        receipts, with their real typos and their grey-import model numbers,
        would be identified at the same rate. Do not quote a synthetic number as
        real-world accuracy.
      </p>
    </main>
  );
}

function StageDots({ stages }: { stages: boolean[] }) {
  const names = ['product', 'warranty', 'provider', 'route', 'contact'];
  return (
    <div className="row" style={{ gap: 3 }}>
      {stages.map((passed, index) => (
        <span
          key={names[index]}
          title={names[index]}
          className="chip"
          data-tone={passed ? 'ok' : 'danger'}
          style={{ minWidth: 22, justifyContent: 'center' }}
        >
          {passed ? '✓' : '×'}
        </span>
      ))}
    </div>
  );
}
