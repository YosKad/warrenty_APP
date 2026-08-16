import Link from 'next/link';

import { Empty, PageHeader, Panel } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Duplicates found during import, across all jobs.
 *
 * Resolved on the import job's own page, where the surrounding rows give the
 * context. This page exists so an unresolved duplicate from a job somebody
 * abandoned three weeks ago is still visible from the sidebar rather than
 * quietly waiting forever.
 */
export default async function DuplicatesQueuePage() {
  await requireAdmin();
  const supabase = await supabaseServer();

  const { data: rows } = await supabase
    .from('import_rows')
    .select('id, row_number, mapped, duplicate_reason, duplicate_score, job:import_jobs(id, file_name, target)')
    .eq('status', 'duplicate')
    .order('row_number')
    .limit(200);

  return (
    <main className="content">
      <PageHeader
        title="Possible duplicates"
        subtitle="Imported rows that look like something already in the corpus. Nothing has been merged."
      />

      <Panel padded={false}>
        {(rows ?? []).length === 0 ? (
          <Empty>No unresolved duplicates.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Incoming</th>
                  <th>From</th>
                  <th>Why</th>
                  <th className="num">Score</th>
                </tr>
              </thead>
              <tbody>
                {(rows ?? []).map((row) => {
                  const job = row.job as unknown as {
                    id: string;
                    file_name: string;
                    target: string;
                  } | null;
                  const mapped = (row.mapped ?? {}) as Record<string, unknown>;

                  return (
                    <tr key={row.id}>
                      <td dir="auto">
                        {String(mapped.name ?? mapped.city ?? `row ${row.row_number}`)}
                      </td>
                      <td>
                        {job ? (
                          <Link href={`/import/${job.id}`}>{job.file_name}</Link>
                        ) : (
                          <span className="muted">unknown import</span>
                        )}
                      </td>
                      <td className="muted">{row.duplicate_reason}</td>
                      <td className="num">
                        {row.duplicate_score !== null
                          ? Math.round(Number(row.duplicate_score) * 100)
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </main>
  );
}
