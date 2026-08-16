import { ReportQueue, type ReportRow } from '@/components/ReportQueue';
import { Empty, PageHeader, Panel } from '@/components/ui';
import { canReview, requireAdmin } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * What users told us was wrong.
 *
 * The highest-signal input this system gets: somebody rang a number and it did
 * not answer. It is also the input most dangerous to apply automatically —
 * "this number is dead" is strong evidence that a person should look, and no
 * evidence at all about what the right number is. So nothing here writes to the
 * global record; a reviewer reads the report, checks the source, and makes the
 * change themselves.
 */
export default async function ReportsQueuePage() {
  await requireAdmin();
  const reviewable = await canReview();
  const supabase = await supabaseServer();

  const { data: reports } = await supabase
    .from('service_data_reports')
    .select(
      `id, kind, note, suggested_value, status, created_at,
       organisation:organisations(id, name),
       location:service_locations(id, name, city),
       contact:provider_contact_methods(id, kind, value)`,
    )
    .eq('status', 'open')
    .order('created_at')
    .limit(100);

  return (
    <main className="content">
      <PageHeader
        title="User reports"
        subtitle="Corrections from people who tried to use the data. Read, then fix by hand."
      />

      {(reports ?? []).length === 0 ? (
        <Panel>
          <Empty>No open reports.</Empty>
        </Panel>
      ) : (
        <ReportQueue reports={(reports ?? []) as unknown as ReportRow[]} canReview={reviewable} />
      )}

      <p className="notice" data-tone="info">
        Accepting a report marks it as acted on. It does not copy the suggested
        value into the record — a reviewer opens the provider and changes it
        after checking, so a wrong correction cannot become a wrong fact.
      </p>
    </main>
  );
}
