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

type Named = { id: string; name: string } | null;

/**
 * Relationships.
 *
 * This is the table the product turns on. "Who imports this brand into this
 * country, for which categories, since when" is what decides whose warranty
 * applies and who repairs the thing — and it is not permanent, which is why it
 * has dates and why an ended relationship is kept rather than deleted. A
 * product bought in 2024 is still governed by the importer who held the
 * agreement in 2024.
 */
export default async function RelationshipsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; country?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const supabase = await supabaseServer();

  let query = supabase
    .from('organisation_relationships')
    .select(
      `id, kind, country_code, model_pattern, purchase_channel, effective_from, effective_to,
       verification, publication_status, data_environment,
       subject:organisations!organisation_relationships_subject_id_fkey(id, name),
       object:organisations!organisation_relationships_object_id_fkey(id, name),
       category:product_categories(id, name)`,
    )
    .order('created_at', { ascending: false })
    .limit(200);

  if (params.kind) query = query.eq('kind', params.kind);
  if (params.country) query = query.eq('country_code', params.country.toUpperCase());

  const { data, error } = await query;
  const rows = data ?? [];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="content">
      <PageHeader
        title="Relationships"
        subtitle="Who acts for whom, where, for what, and when. Scoped and dated."
        actions={
          <Link className="button" href="/relationships/new">
            New relationship
          </Link>
        }
      />

      <Panel>
        <form className="row" method="get">
          <select name="kind" defaultValue={params.kind ?? ''} style={{ maxWidth: 220 }}>
            <option value="">Any kind</option>
            <option value="imports_for">imports for</option>
            <option value="warranty_provider_for">warranty provider for</option>
            <option value="services_for">services for</option>
            <option value="authorized_service_for">authorised service for</option>
            <option value="retails_for">retails for</option>
            <option value="subsidiary_of">subsidiary of</option>
          </select>
          <input
            type="text"
            name="country"
            placeholder="Country"
            defaultValue={params.country ?? ''}
            style={{ maxWidth: 110 }}
          />
          <button type="submit">Filter</button>
        </form>
      </Panel>

      <Panel padded={false}>
        {error ? (
          <p className="notice" data-tone="danger">
            {error.message}
          </p>
        ) : rows.length === 0 ? (
          <Empty>
            No relationships recorded. Until one exists, an imported product has
            no route — which the app reports as unknown rather than guessing.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Relationship</th>
                  <th>Scope</th>
                  <th>In force</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const subject = row.subject as unknown as Named;
                  const object = row.object as unknown as Named;
                  const category = row.category as unknown as Named;
                  const ended = row.effective_to !== null && row.effective_to < today;

                  return (
                    <tr key={row.id}>
                      <td>
                        {subject ? (
                          <Link href={`/organisations/${subject.id}`}>{subject.name}</Link>
                        ) : (
                          '?'
                        )}{' '}
                        <span className="muted">{row.kind.replace(/_/g, ' ')}</span>{' '}
                        {object ? (
                          <Link href={`/organisations/${object.id}`}>{object.name}</Link>
                        ) : (
                          '?'
                        )}
                      </td>
                      <td>
                        <div className="row" style={{ gap: 4 }}>
                          {row.country_code ? (
                            <span className="chip">{row.country_code}</span>
                          ) : null}
                          {category ? <span className="chip">{category.name}</span> : null}
                          {row.model_pattern ? (
                            <span className="chip mono">{row.model_pattern}</span>
                          ) : null}
                          {row.purchase_channel ? (
                            <span className="chip">{row.purchase_channel}</span>
                          ) : null}
                          {!row.country_code && !category && !row.model_pattern ? (
                            // Not the same as "everywhere". The resolver treats
                            // an unscoped relationship as un-narrowed evidence,
                            // not as a global claim.
                            <span className="muted">not narrowed</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="mono">
                        <Value>{row.effective_from}</Value> →{' '}
                        {row.effective_to ? (
                          <span style={ended ? { color: 'var(--danger)' } : undefined}>
                            {row.effective_to}
                          </span>
                        ) : (
                          <span className="muted">open</span>
                        )}
                      </td>
                      <td>
                        <div className="row" style={{ gap: 4 }}>
                          <StatusChip status={row.publication_status} />
                          <VerificationChip state={row.verification} />
                          <EnvironmentChip environment={row.data_environment} />
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
    </main>
  );
}
