import Link from 'next/link';

import { Empty, EnvironmentChip, PageHeader, Panel, StatusChip } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const HREF: Record<string, (id: string) => string> = {
  organisation: (id) => `/organisations/${id}`,
  relationship: () => '/relationships',
  warranty: (id) => `/warranties/${id}`,
  contact: () => '/providers',
  location: () => '/providers',
};

/**
 * Everything waiting for a person, in one list.
 *
 * Oldest first. A queue whose point is that nothing sits in it forever should
 * not be sorted by anything else.
 */
export default async function ReviewQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const supabase = await supabaseServer();

  let query = supabase
    .from('review_queue')
    .select('record_type, id, label, publication_status, verification, data_environment, created_at')
    .order('created_at')
    .limit(300);

  if (params.type) query = query.eq('record_type', params.type);

  const { data, error } = await query;
  const rows = data ?? [];

  return (
    <main className="content">
      <PageHeader
        title="Needs review"
        subtitle="Candidates and re-checks across every table that has a publication state."
      />

      <Panel>
        <form className="row" method="get">
          <select name="type" defaultValue={params.type ?? ''} style={{ maxWidth: 220 }}>
            <option value="">Everything</option>
            <option value="organisation">Organisations</option>
            <option value="relationship">Relationships</option>
            <option value="warranty">Warranty policies</option>
            <option value="contact">Contact methods</option>
            <option value="location">Service locations</option>
          </select>
          <button type="submit">Filter</button>
        </form>
      </Panel>

      <Panel padded={false}>
        {error ? (
          <p className="notice" data-tone="danger">
            {error.message}
          </p>
        ) : rows.length === 0 ? (
          <Empty>Nothing is waiting.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Record</th>
                  <th>Type</th>
                  <th>State</th>
                  <th>Waiting since</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.record_type}-${row.id}`}>
                    <td dir="auto">
                      <Link href={HREF[row.record_type]?.(row.id) ?? '/'}>{row.label}</Link>
                    </td>
                    <td className="muted">{row.record_type}</td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        <StatusChip status={row.publication_status} />
                        <EnvironmentChip environment={row.data_environment} />
                      </div>
                    </td>
                    <td className="mono muted">
                      {new Date(row.created_at).toISOString().slice(0, 10)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </main>
  );
}
