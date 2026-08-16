import Link from 'next/link';

import { ImportUpload } from '@/components/ImportUpload';
import { Empty, PageHeader, Panel } from '@/components/ui';
import { canEdit, requireAdmin } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  await requireAdmin();
  const editable = await canEdit();
  const supabase = await supabaseServer();

  const { data: jobs } = await supabase
    .from('import_jobs')
    .select(
      'id, target, file_name, status, total_rows, valid_rows, invalid_rows, duplicate_rows, imported_rows, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(30);

  return (
    <main className="content">
      <PageHeader
        title="Bulk import"
        subtitle="CSV or Excel. Read, map, validate, then import — nothing is written until the last step."
      />

      <Panel title="New import">
        {editable ? (
          <ImportUpload />
        ) : (
          <p className="panel-note">Importing requires edit access.</p>
        )}
      </Panel>

      <Panel title="Recent imports" padded={false}>
        {(jobs ?? []).length === 0 ? (
          <Empty>No imports yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Contains</th>
                  <th>State</th>
                  <th className="num">Rows</th>
                  <th className="num">Valid</th>
                  <th className="num">Errors</th>
                  <th className="num">Duplicates</th>
                  <th className="num">Imported</th>
                </tr>
              </thead>
              <tbody>
                {(jobs ?? []).map((job) => (
                  <tr key={job.id}>
                    <td>
                      <Link href={`/import/${job.id}`}>{job.file_name}</Link>
                      <div className="muted" style={{ fontSize: 11 }}>
                        {new Date(job.created_at).toISOString().slice(0, 16).replace('T', ' ')}
                      </div>
                    </td>
                    <td>{job.target.replace(/_/g, ' ')}</td>
                    <td>
                      <span
                        className="chip"
                        data-tone={
                          job.status === 'completed'
                            ? 'ok'
                            : job.status === 'failed'
                              ? 'danger'
                              : 'info'
                        }
                      >
                        {job.status}
                      </span>
                    </td>
                    <td className="num">{job.total_rows}</td>
                    <td className="num">{job.valid_rows}</td>
                    <td className="num" style={job.invalid_rows > 0 ? { color: 'var(--danger)' } : undefined}>
                      {job.invalid_rows}
                    </td>
                    <td className="num">{job.duplicate_rows}</td>
                    <td className="num">{job.imported_rows}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="notice" data-tone="info">
        Everything an import creates is a candidate. A file with a systematic
        mistake in it becomes a queue to reject, not a corpus to repair.
      </p>
    </main>
  );
}
