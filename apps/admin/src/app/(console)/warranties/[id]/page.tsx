import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ClauseReview, type ClauseRow } from '@/components/ClauseReview';
import { PublicationControls } from '@/components/PublicationControls';
import { RecordForm } from '@/components/RecordForm';
import {
  Empty,
  EnvironmentChip,
  PageHeader,
  Panel,
  StatusChip,
  Value,
  VerificationChip,
} from '@/components/ui';
import { canEdit, canReview, requireAdmin } from '@/lib/auth';
import { WARRANTY_FIELDS } from '@/lib/fields';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type Named = { id: string; name: string } | null;

/**
 * One warranty policy: the terms, the chain, the source, and the clauses.
 *
 * The clause review below is the screen this whole phase was built for. Every
 * other page moves data around; this is the one where a person decides whether
 * what we are about to tell a user is what their warranty actually says.
 */
export default async function WarrantyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdmin();

  const supabase = await supabaseServer();
  const [editable, reviewable] = await Promise.all([canEdit(), canReview()]);

  const { data: warranty } = await supabase
    .from('warranties')
    .select(
      `*,
       brand:organisations!warranties_brand_id_fkey(id, name),
       provider:organisations!warranties_warranty_provider_id_fkey(id, name),
       importer:organisations!warranties_importer_id_fkey(id, name),
       retailer:organisations!warranties_retailer_id_fkey(id, name),
       category:product_categories(id, name),
       source:warranty_sources(*)`,
    )
    .eq('id', id)
    .maybeSingle();

  if (!warranty) notFound();

  const source = warranty.source as unknown as Record<string, unknown> | null;

  const [{ data: clauses }, { data: snapshots }] = await Promise.all([
    supabase
      .from('warranty_terms')
      .select(
        'id, ordinal, clause_type, title, summary, clause_text, section, source_section, source_page, language, confidence, verification, extracted_by, publication_status',
      )
      .eq('warranty_id', id)
      .order('ordinal'),
    source
      ? supabase
          .from('warranty_source_snapshots')
          .select('id, captured_at, content_hash, changed_from_previous, diff_summary')
          .eq('source_id', source.id as string)
          .order('captured_at', { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [] }),
  ]);

  const brand = warranty.brand as unknown as Named;
  const provider = warranty.provider as unknown as Named;
  const importer = warranty.importer as unknown as Named;
  const retailer = warranty.retailer as unknown as Named;

  return (
    <main className="content">
      <PageHeader
        title={`${brand?.name ?? 'Unbranded'} — ${warranty.model_pattern ?? 'all models'}`}
        subtitle={warranty.policy_version ?? undefined}
        actions={
          <>
            <StatusChip status={warranty.publication_status} />
            <VerificationChip state={warranty.verification} />
            <EnvironmentChip environment={warranty.data_environment} />
          </>
        }
      />

      <div className="split">
        <Panel title="Terms">
          <RecordForm
            table="warranties"
            id={id}
            fields={WARRANTY_FIELDS}
            initial={warranty}
            disabled={!editable}
          />
        </Panel>

        <div className="stack">
          <Panel title="Publication">
            <PublicationControls
              table="warranties"
              id={id}
              status={warranty.publication_status}
              canReview={reviewable}
              canEdit={editable}
            />
          </Panel>

          <Panel title="Chain" note="Five roles, never collapsed. Blank means nobody has established it.">
            <table className="data">
              <tbody>
                <tr>
                  <td>Brand</td>
                  <td>
                    {brand ? <Link href={`/organisations/${brand.id}`}>{brand.name}</Link> : <Value>{null}</Value>}
                  </td>
                </tr>
                <tr>
                  <td>Importer</td>
                  <td>
                    {importer ? (
                      <Link href={`/organisations/${importer.id}`}>{importer.name}</Link>
                    ) : (
                      <Value>{null}</Value>
                    )}
                  </td>
                </tr>
                <tr>
                  <td>Honoured by</td>
                  <td>
                    {provider ? (
                      <Link href={`/organisations/${provider.id}`}>{provider.name}</Link>
                    ) : (
                      <Value>{null}</Value>
                    )}
                  </td>
                </tr>
                <tr>
                  <td>Retailer</td>
                  <td>
                    {retailer ? (
                      <Link href={`/organisations/${retailer.id}`}>{retailer.name}</Link>
                    ) : (
                      <Value>{null}</Value>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </Panel>

          <Panel title="Source" note="What this policy is a reading of.">
            {source ? (
              <div className="stack">
                <div>
                  <div dir="auto">
                    <Value>{source.document_title as string}</Value>
                  </div>
                  {source.source_url ? (
                    <a
                      className="mono"
                      href={source.source_url as string}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {source.source_url as string}
                    </a>
                  ) : null}
                </div>
                <div className="row" style={{ gap: 4 }}>
                  <span className="chip">{source.kind as string}</span>
                  <VerificationChip state={source.verification as never} />
                  {source.document_version ? (
                    <span className="chip mono">{source.document_version as string}</span>
                  ) : null}
                </div>
                <p className="panel-note">
                  Retrieved{' '}
                  {source.retrieved_at
                    ? new Date(source.retrieved_at as string).toISOString().slice(0, 10)
                    : 'unknown'}
                  {' · '}
                  last confirmed{' '}
                  {source.last_verified_at
                    ? new Date(source.last_verified_at as string).toISOString().slice(0, 10)
                    : 'never'}
                </p>

                {(snapshots ?? []).length > 0 ? (
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Captured</th>
                          <th>Changed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(snapshots ?? []).map((snapshot) => (
                          <tr key={snapshot.id}>
                            <td className="mono">
                              {new Date(snapshot.captured_at).toISOString().slice(0, 10)}
                            </td>
                            <td>
                              {snapshot.changed_from_previous ? (
                                <span className="chip" data-tone="warn">
                                  {snapshot.diff_summary ?? 'changed'}
                                </span>
                              ) : (
                                <span className="muted">no change</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            ) : (
              <Empty>
                No source recorded. A policy with no source cannot be verified —
                there is nothing to check it against.
              </Empty>
            )}
          </Panel>
        </div>
      </div>

      <Panel
        title="Clause review"
        note="Verbatim on the left, what we say on the right. Approve only when the two agree."
        padded={false}
      >
        <div className="panel-body">
          {(clauses ?? []).length === 0 ? (
            <Empty>
              No clauses extracted. The policy can still carry summary terms, but
              nothing here is citable.
            </Empty>
          ) : (
            <ClauseReview
              clauses={(clauses ?? []) as ClauseRow[]}
              canEdit={editable}
              canReview={reviewable}
            />
          )}
        </div>
      </Panel>
    </main>
  );
}
