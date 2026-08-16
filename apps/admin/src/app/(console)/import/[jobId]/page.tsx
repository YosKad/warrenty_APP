import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ImportWorkbench } from '@/components/ImportWorkbench';
import { PageHeader, Panel } from '@/components/ui';
import { canEdit, requireAdmin } from '@/lib/auth';
import { TARGETS, type ImportTarget } from '@/lib/import/targets';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function ImportJobPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  await requireAdmin();
  const editable = await canEdit();
  const supabase = await supabaseServer();

  const { data: job } = await supabase
    .from('import_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();
  if (!job) notFound();

  const spec = TARGETS[job.target as ImportTarget];

  const [{ data: sample }, { data: problems }] = await Promise.all([
    supabase
      .from('import_rows')
      .select('id, row_number, raw, mapped, status, errors, duplicate_of, duplicate_reason, duplicate_score')
      .eq('job_id', jobId)
      .order('row_number')
      .limit(20),
    supabase
      .from('import_rows')
      .select('id, row_number, raw, mapped, status, errors, duplicate_of, duplicate_reason, duplicate_score')
      .eq('job_id', jobId)
      .in('status', ['invalid', 'duplicate'])
      .order('row_number')
      .limit(200),
  ]);

  const headers = Object.keys((sample?.[0]?.raw ?? {}) as Record<string, string>);

  return (
    <main className="content">
      <PageHeader
        title={job.file_name}
        subtitle={`${spec.label} · ${job.total_rows} rows`}
        actions={
          <Link className="button" href="/import">
            All imports
          </Link>
        }
      />

      <ImportWorkbench
        jobId={jobId}
        status={job.status}
        target={job.target}
        headers={headers}
        mapping={(job.column_mapping ?? {}) as Record<string, string>}
        counts={{
          total: job.total_rows,
          valid: job.valid_rows,
          invalid: job.invalid_rows,
          duplicate: job.duplicate_rows,
          imported: job.imported_rows,
        }}
        sample={sample ?? []}
        problems={problems ?? []}
        canEdit={editable}
      />

      {job.error_summary ? (
        <Panel title="What the database refused">
          <p className="mono">{job.error_summary}</p>
        </Panel>
      ) : null}
    </main>
  );
}
