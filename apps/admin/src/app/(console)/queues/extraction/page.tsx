import Link from 'next/link';

import { Empty, PageHeader, Panel } from '@/components/ui';
import { RequeueButton } from '@/components/RequeueButton';
import { canEdit, requireAdmin } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<string, string> = {
  pending: 'info',
  fetching: 'info',
  text_extracted: 'info',
  extracting: 'info',
  needs_review: 'warn',
  reviewed: 'ok',
  failed: 'danger',
  unsupported: 'neutral',
};

/**
 * Document extraction.
 *
 * A machine reads a warranty PDF and proposes clauses. Everything it produces
 * arrives as a candidate and lands in this queue — the extraction step ends at
 * `needs_review`, and there is no path from here to published that does not go
 * through a person reading the clause against its source.
 *
 * The low-confidence count is the useful column: it is how a reviewer picks
 * which document to open first.
 */
export default async function ExtractionQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const editable = await canEdit();
  const supabase = await supabaseServer();

  let query = supabase
    .from('extraction_jobs')
    .select(
      `id, source_url, status, clause_count, low_confidence_count, failure_reason,
       extraction_version, attempts, created_at, warranty_id, country_code,
       organisation:organisations!extraction_jobs_organisation_id_fkey(id, name)`,
    )
    .order('created_at', { ascending: false })
    .limit(150);

  if (params.status) query = query.eq('status', params.status);

  const { data: jobs, error } = await query;

  return (
    <main className="content">
      <PageHeader
        title="Extraction"
        subtitle="Documents a model has read. Everything it proposed is a candidate."
      />

      <Panel>
        <form className="row" method="get">
          <select name="status" defaultValue={params.status ?? ''} style={{ maxWidth: 200 }}>
            <option value="">Any state</option>
            <option value="pending">pending</option>
            <option value="needs_review">needs review</option>
            <option value="reviewed">reviewed</option>
            <option value="failed">failed</option>
            <option value="unsupported">unsupported</option>
          </select>
          <button type="submit">Filter</button>
        </form>
      </Panel>

      <Panel padded={false}>
        {error ? (
          <p className="notice" data-tone="danger">
            {error.message}
          </p>
        ) : (jobs ?? []).length === 0 ? (
          <Empty>Nothing in the extraction queue.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Organisation</th>
                  <th>State</th>
                  <th className="num">Clauses</th>
                  <th className="num">Low confidence</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(jobs ?? []).map((job) => {
                  const organisation = job.organisation as unknown as {
                    id: string;
                    name: string;
                  } | null;

                  return (
                    <tr key={job.id}>
                      <td>
                        {job.source_url ? (
                          <a
                            className="mono"
                            href={job.source_url}
                            target="_blank"
                            rel="noreferrer noopener"
                            style={{ fontSize: 12 }}
                          >
                            {job.source_url}
                          </a>
                        ) : (
                          <span className="muted">uploaded document</span>
                        )}
                        {job.failure_reason ? (
                          <div style={{ color: 'var(--danger)', fontSize: 12 }}>
                            {job.failure_reason}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {organisation ? (
                          <Link href={`/organisations/${organisation.id}`}>
                            {organisation.name}
                          </Link>
                        ) : (
                          <span className="muted">unknown</span>
                        )}
                      </td>
                      <td>
                        <span className="chip" data-tone={STATUS_TONE[job.status] ?? 'neutral'}>
                          {job.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="num">{job.clause_count}</td>
                      <td
                        className="num"
                        style={
                          job.low_confidence_count > 0 ? { color: 'var(--warning)' } : undefined
                        }
                      >
                        {job.low_confidence_count}
                      </td>
                      <td style={{ textAlign: 'end' }}>
                        <div className="row" style={{ justifyContent: 'flex-end' }}>
                          {job.warranty_id ? (
                            <Link href={`/warranties/${job.warranty_id}`}>Review clauses</Link>
                          ) : null}
                          {job.status === 'failed' || job.status === 'unsupported' ? (
                            <RequeueButton jobId={job.id} canEdit={editable} />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="notice" data-tone="info">
        Extraction reads documents it was pointed at — an uploaded file or a URL
        an operator entered. It does not crawl. A process that wanders the web
        collecting warranty pages produces a corpus nobody can vouch for, which
        is the opposite of what this console is for.
      </p>
    </main>
  );
}
