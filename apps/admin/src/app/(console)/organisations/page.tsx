import Link from 'next/link';

import { EnvironmentChip, Empty, PageHeader, Panel, StatusChip, Value } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type OrganisationRow = {
  id: string;
  slug: string;
  name: string;
  legal_name: string | null;
  roles: string[];
  country_code: string | null;
  publication_status: string;
  data_environment: 'production' | 'demo';
  is_verified: boolean;
};

/**
 * Organisations.
 *
 * One company, all of its roles. The schema keeps them as an array rather than
 * separate tables because in this market one company is routinely the importer,
 * the warranty provider and the repairer at once — and just as routinely, three
 * different companies. Both have to be expressible without the console
 * pretending it knows which.
 */
export default async function OrganisationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string; country?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const supabase = await supabaseServer();

  let query = supabase
    .from('organisations')
    .select(
      'id, slug, name, legal_name, roles, country_code, publication_status, data_environment, is_verified',
    )
    .order('name')
    .limit(200);

  if (params.q) query = query.ilike('name', `%${params.q}%`);
  if (params.role) query = query.contains('roles', [params.role]);
  if (params.country) query = query.eq('country_code', params.country.toUpperCase());

  const { data, error } = await query;
  const rows = (data ?? []) as OrganisationRow[];

  return (
    <main className="content">
      <PageHeader
        title="Organisations"
        subtitle="Manufacturers, importers, retailers, warranty providers and repairers."
        actions={
          <Link className="button" href="/organisations/new">
            New organisation
          </Link>
        }
      />

      <Panel>
        <form className="row" method="get">
          <input
            type="text"
            name="q"
            placeholder="Name contains…"
            defaultValue={params.q ?? ''}
            style={{ maxWidth: 260 }}
          />
          <select name="role" defaultValue={params.role ?? ''} style={{ maxWidth: 190 }}>
            <option value="">Any role</option>
            <option value="manufacturer">Manufacturer</option>
            <option value="importer">Importer</option>
            <option value="retailer">Retailer</option>
            <option value="warranty_provider">Warranty provider</option>
            <option value="service_provider">Service provider</option>
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
          <Empty>No organisations match. The corpus starts empty on purpose.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Roles</th>
                  <th>Country</th>
                  <th>State</th>
                  <th>Slug</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link href={`/organisations/${row.id}`}>{row.name}</Link>
                      {row.legal_name && row.legal_name !== row.name ? (
                        <div className="muted" style={{ fontSize: 12 }} dir="auto">
                          {row.legal_name}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        {row.roles.map((role) => (
                          <span key={role} className="chip">
                            {role.replace(/_/g, ' ')}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <Value>{row.country_code}</Value>
                    </td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        <StatusChip status={row.publication_status as never} />
                        <EnvironmentChip environment={row.data_environment} />
                      </div>
                    </td>
                    <td className="mono muted">{row.slug}</td>
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
