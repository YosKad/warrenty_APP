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

export default async function WarrantiesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; country?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const supabase = await supabaseServer();

  let query = supabase
    .from('warranties')
    .select(
      `id, model_pattern, country_code, duration_months, parts_months, labour_months,
       policy_version, valid_from, valid_to, verification, publication_status, data_environment,
       brand:organisations!warranties_brand_id_fkey(id, name),
       provider:organisations!warranties_warranty_provider_id_fkey(id, name),
       importer:organisations!warranties_importer_id_fkey(id, name),
       warranty_terms(count)`,
    )
    .order('created_at', { ascending: false })
    .limit(200);

  if (params.status) query = query.eq('publication_status', params.status);
  if (params.country) query = query.eq('country_code', params.country.toUpperCase());

  const { data, error } = await query;
  const rows = data ?? [];

  return (
    <main className="content">
      <PageHeader
        title="Warranty policies"
        subtitle="What the terms say, who publishes them, and which products they apply to."
        actions={
          <Link className="button" href="/warranties/new">
            New policy
          </Link>
        }
      />

      <Panel>
        <form className="row" method="get">
          <select name="status" defaultValue={params.status ?? ''} style={{ maxWidth: 200 }}>
            <option value="">Any state</option>
            <option value="candidate">candidate</option>
            <option value="needs_review">needs review</option>
            <option value="verified">verified</option>
            <option value="published">published</option>
            <option value="needs_reverification">needs re-verification</option>
            <option value="rejected">rejected</option>
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
          <Empty>No policies match.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Brand</th>
                  <th>Applies to</th>
                  <th className="num">Months</th>
                  <th>Honoured by</th>
                  <th className="num">Clauses</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const brand = row.brand as unknown as Named;
                  const provider = row.provider as unknown as Named;
                  const importer = row.importer as unknown as Named;
                  const clauses =
                    (row.warranty_terms as unknown as { count: number }[])[0]?.count ?? 0;

                  return (
                    <tr key={row.id}>
                      <td>
                        <Link href={`/warranties/${row.id}`}>
                          {brand?.name ?? 'Unbranded'}
                        </Link>
                        {row.policy_version ? (
                          <div className="muted mono" style={{ fontSize: 11 }}>
                            {row.policy_version}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <div className="row" style={{ gap: 4 }}>
                          <span className="chip mono">
                            {row.model_pattern ?? 'all models'}
                          </span>
                          {row.country_code ? (
                            <span className="chip">{row.country_code}</span>
                          ) : (
                            <span className="chip">any country</span>
                          )}
                          {importer ? <span className="chip">via {importer.name}</span> : null}
                        </div>
                      </td>
                      <td className="num">
                        <Value>{row.duration_months}</Value>
                        {row.parts_months !== row.duration_months ||
                        row.labour_months !== row.duration_months ? (
                          <div className="muted" style={{ fontSize: 11 }}>
                            p {row.parts_months ?? '—'} / l {row.labour_months ?? '—'}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <Value>{provider?.name}</Value>
                      </td>
                      <td className="num">{clauses}</td>
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
