import Link from 'next/link';

import { Metric, PageHeader, Panel } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { queueCounts } from '@/lib/queues';
import { supabaseServer } from '@/lib/supabase/server';
import { corpusCoverage } from '@/lib/coverage';

export const dynamic = 'force-dynamic';

/**
 * The dashboard answers one question: what should I do next.
 *
 * Not "how much data do we have" — that number goes up whether or not the
 * product works. The top row is the Full Resolution Rate, because it is the
 * only figure that describes whether a user gets an answer; below it are the
 * queues, in the order a reviewer should clear them.
 */
export default async function DashboardPage() {
  const identity = await requireAdmin();
  const supabase = await supabaseServer();

  const [queues, coverage, rates] = await Promise.all([
    queueCounts(),
    corpusCoverage(),
    supabase.rpc('resolution_rates').maybeSingle(),
  ]);

  const kpi = rates.data as {
    total: number;
    full_resolution_rate: number | null;
    warranty_resolution_rate: number | null;
    service_route_resolution_rate: number | null;
  } | null;

  const pct = (value: number | null | undefined) =>
    value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`;

  const totalWork = queues.reduce((sum, queue) => sum + queue.count, 0);

  return (
    <main className="content">
      <PageHeader
        title={`Good ${partOfDay()}`}
        subtitle={
          totalWork === 0
            ? 'Nothing is waiting for review.'
            : `${totalWork} item${totalWork === 1 ? '' : 's'} waiting across ${
                queues.filter((q) => q.count > 0).length
              } queues.`
        }
      />

      <Panel
        title="Full Resolution Rate"
        note="The share of test cases where a user would get a product, a policy, a provider, a route and a contact they can act on. All five, or it does not count."
        actions={<Link className="button" href="/resolution">Open the tester</Link>}
      >
        <div className="grid grid-3">
          <Metric
            label="Fully resolved"
            value={pct(kpi?.full_resolution_rate)}
            ratio={kpi?.full_resolution_rate ?? 0}
            note={
              kpi && kpi.total > 0
                ? `over ${kpi.total} recorded run${kpi.total === 1 ? '' : 's'}`
                : 'no runs recorded yet'
            }
          />
          <Metric
            label="Warranty resolved"
            value={pct(kpi?.warranty_resolution_rate)}
            ratio={kpi?.warranty_resolution_rate ?? 0}
            note="a policy was identified without conflict"
          />
          <Metric
            label="Service route resolved"
            value={pct(kpi?.service_route_resolution_rate)}
            ratio={kpi?.service_route_resolution_rate ?? 0}
            note="a provider and a way to reach them"
          />
        </div>
      </Panel>

      <div className="split">
        <Panel title="Work queues" note="Clear these top to bottom." padded={false}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Queue</th>
                  <th className="num">Waiting</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {queues.map((queue) => (
                  <tr key={queue.key}>
                    <td>{queue.label}</td>
                    <td className="num" style={queue.urgent && queue.count > 0 ? { color: 'var(--danger)' } : undefined}>
                      {queue.count}
                    </td>
                    <td style={{ textAlign: 'end' }}>
                      <Link href={queue.href}>Open</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel
          title="Corpus coverage"
          note="Published production records only. Candidates and demo fixtures are excluded."
          padded={false}
        >
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Record</th>
                  <th className="num">Published</th>
                  <th className="num">In review</th>
                </tr>
              </thead>
              <tbody>
                {coverage.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td className="num">{row.published}</td>
                    <td className="num">{row.inReview}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      {identity.role === 'viewer' ? (
        <p className="notice" data-tone="info">
          You have read access. Editing controls are disabled, and the database
          would refuse the change even if one were shown.
        </p>
      ) : null}
    </main>
  );
}

function partOfDay(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}
