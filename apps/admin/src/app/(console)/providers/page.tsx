import Link from 'next/link';

import { Empty, PageHeader, Panel } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type ProviderRow = {
  id: string;
  name: string;
  country_code: string | null;
  roles: string[];
  provider_contact_methods: { count: number }[];
  service_locations: { count: number }[];
  service_capabilities: { count: number }[];
};

/**
 * Service providers, ranked by what is missing.
 *
 * A provider with a phone number and no capabilities cannot be recommended for
 * anything specific; one with branches and no contact cannot be reached. The
 * counts are the work list — the column that matters is the zero.
 */
export default async function ProvidersPage() {
  await requireAdmin();
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from('organisations')
    .select(
      `id, name, country_code, roles,
       provider_contact_methods(count),
       service_locations(count),
       service_capabilities(count)`,
    )
    .overlaps('roles', ['service_provider', 'warranty_provider', 'importer'])
    .order('name')
    .limit(200);

  const rows = (data ?? []) as unknown as ProviderRow[];
  const count = (relation: { count: number }[]) => relation[0]?.count ?? 0;

  return (
    <main className="content">
      <PageHeader
        title="Service providers"
        subtitle="Importers, warranty providers and repairers — the companies a user actually contacts."
      />

      <Panel padded={false}>
        {error ? (
          <p className="notice" data-tone="danger">
            {error.message}
          </p>
        ) : rows.length === 0 ? (
          <Empty>No providers yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Country</th>
                  <th>Roles</th>
                  <th className="num">Contacts</th>
                  <th className="num">Branches</th>
                  <th className="num">Capabilities</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const contacts = count(row.provider_contact_methods);
                  return (
                    <tr key={row.id}>
                      <td>
                        <Link href={`/organisations/${row.id}`}>{row.name}</Link>
                      </td>
                      <td>{row.country_code ?? <span className="muted">unknown</span>}</td>
                      <td className="muted">{row.roles.join(', ').replace(/_/g, ' ')}</td>
                      <td
                        className="num"
                        style={contacts === 0 ? { color: 'var(--danger)' } : undefined}
                      >
                        {contacts}
                      </td>
                      <td className="num">{count(row.service_locations)}</td>
                      <td className="num">{count(row.service_capabilities)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="panel-note">
        A provider with zero contacts is shown in red. It is the one state that
        makes every warranty pointing at that company unusable — the policy
        resolves and the person still cannot do anything about it.
      </p>
    </main>
  );
}
