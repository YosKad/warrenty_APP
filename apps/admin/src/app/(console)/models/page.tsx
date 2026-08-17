import Link from 'next/link';

import { ModelResolverTool } from '@/components/ModelResolverTool';
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
 * Canonical models, their spellings, and the tool for testing both.
 *
 * The alias count is the column that matters. A model with no aliases is a
 * model only findable by people who type its name exactly as a reviewer chose
 * to write it, which is nobody.
 */
export default async function ModelsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const supabase = await supabaseServer();

  let query = supabase
    .from('product_models')
    .select(
      `id, canonical_model, family, variant, regional_model, normalized_key, country_code,
       verification, publication_status, data_environment,
       manufacturer:organisations(id, name),
       model_aliases(count)`,
    )
    .order('canonical_model')
    .limit(200);

  if (params.q) query = query.ilike('canonical_model', `%${params.q}%`);
  if (params.status) query = query.eq('publication_status', params.status);

  const { data, error } = await query;
  const rows = data ?? [];

  return (
    <main className="content">
      <PageHeader
        title="Models"
        subtitle="What the corpus can recognise, and every approved way of writing it."
        actions={
          <Link className="button" href="/models/new">
            New model
          </Link>
        }
      />

      <ModelResolverTool />

      <Panel>
        <form className="row" method="get">
          <input
            type="text"
            name="q"
            placeholder="Model name contains…"
            defaultValue={params.q ?? ''}
            style={{ maxWidth: 260 }}
          />
          <select name="status" defaultValue={params.status ?? ''} style={{ maxWidth: 200 }}>
            <option value="">Any state</option>
            <option value="candidate">candidate</option>
            <option value="needs_review">needs review</option>
            <option value="verified">verified</option>
            <option value="published">published</option>
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
          <Empty>
            No models recorded. Until one exists, every policy can only be reached
            through a pattern.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Manufacturer</th>
                  <th>Family</th>
                  <th>Market code</th>
                  <th className="num">Aliases</th>
                  <th>Key</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const manufacturer = row.manufacturer as unknown as Named;
                  const aliases =
                    (row.model_aliases as unknown as { count: number }[])[0]?.count ?? 0;

                  return (
                    <tr key={row.id}>
                      <td>
                        <Link href={`/models/${row.id}`}>{row.canonical_model}</Link>
                        {row.variant ? (
                          <div className="muted" style={{ fontSize: 11 }}>
                            {row.variant}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {manufacturer ? (
                          <Link href={`/organisations/${manufacturer.id}`}>
                            {manufacturer.name}
                          </Link>
                        ) : (
                          <span className="muted">unknown</span>
                        )}
                      </td>
                      <td>
                        <Value>{row.family}</Value>
                      </td>
                      <td className="mono">
                        <Value>{row.regional_model}</Value>
                      </td>
                      <td
                        className="num"
                        style={aliases === 0 ? { color: 'var(--warning)' } : undefined}
                      >
                        {aliases}
                      </td>
                      <td className="mono muted" style={{ fontSize: 11 }}>
                        {row.normalized_key}
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

      <p className="notice" data-tone="info">
        A model with no aliases is findable only by someone who types its name
        exactly as a reviewer wrote it. The alias set is the researched fact —
        the canonical name is just the label we chose for it.
      </p>
    </main>
  );
}
