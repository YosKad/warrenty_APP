import Link from 'next/link';

import {
  Empty,
  EnvironmentChip,
  PageHeader,
  Panel,
  StatusChip,
  Value,
  VerificationChip,
} from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Sources — the documents everything else is a reading of.
 *
 * A snapshot is taken every time a source is fetched, and the snapshots are
 * appended rather than replacing one another. That is what makes "the terms
 * changed in March" a fact somebody can check rather than a claim: the old text
 * is still there.
 */
export default async function SourcesPage() {
  await requireAdmin();
  const supabase = await supabaseServer();

  const { data: sources, error } = await supabase
    .from('warranty_sources')
    .select(
      `id, kind, document_title, source_url, document_version, language, country_code,
       retrieved_at, last_verified_at, verification, publication_status, data_environment,
       organisation:organisations(id, name),
       warranty_source_snapshots(count)`,
    )
    .order('retrieved_at', { ascending: false, nullsFirst: false })
    .limit(200);

  return (
    <main className="content">
      <PageHeader
        title="Sources"
        subtitle="Warranty documents and pages, with the snapshots taken of them."
      />

      <Panel padded={false}>
        {error ? (
          <p className="notice" data-tone="danger">
            {error.message}
          </p>
        ) : (sources ?? []).length === 0 ? (
          <Empty>No sources recorded.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Publisher</th>
                  <th>Kind</th>
                  <th>Retrieved</th>
                  <th>Last confirmed</th>
                  <th className="num">Snapshots</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {(sources ?? []).map((source) => {
                  const organisation = source.organisation as unknown as {
                    id: string;
                    name: string;
                  } | null;
                  const snapshots =
                    (source.warranty_source_snapshots as unknown as { count: number }[])[0]
                      ?.count ?? 0;

                  return (
                    <tr key={source.id}>
                      <td dir="auto">
                        <Value>{source.document_title}</Value>
                        {source.source_url ? (
                          <div>
                            <a
                              className="mono muted"
                              style={{ fontSize: 11 }}
                              href={source.source_url}
                              target="_blank"
                              rel="noreferrer noopener"
                            >
                              {source.source_url}
                            </a>
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
                        <span className="chip">{source.kind}</span>
                      </td>
                      <td className="mono muted">
                        {source.retrieved_at
                          ? new Date(source.retrieved_at).toISOString().slice(0, 10)
                          : '—'}
                      </td>
                      <td className="mono muted">
                        {source.last_verified_at ? (
                          new Date(source.last_verified_at).toISOString().slice(0, 10)
                        ) : (
                          <span style={{ color: 'var(--warning)' }}>never</span>
                        )}
                      </td>
                      <td className="num">{snapshots}</td>
                      <td>
                        <div className="row" style={{ gap: 4 }}>
                          <StatusChip status={source.publication_status} />
                          <VerificationChip state={source.verification} />
                          <EnvironmentChip environment={source.data_environment} />
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
        Sources are added by pointing at a document — a URL an operator entered
        or a file they uploaded. There is no crawler. A corpus assembled by a
        process that wandered off looking for warranty pages is a corpus nobody
        can vouch for.
      </p>
    </main>
  );
}
