import Link from 'next/link';
import { DEFAULT_FRESHNESS, ageInDays, freshnessOf } from '@mw/domain';

import { FreshnessChip, Empty, PageHeader, Panel } from '@/components/ui';
import { ReverifyButton } from '@/components/ReverifyButton';
import { canEdit, canReview, requireAdmin } from '@/lib/auth';
import { recheckCutoff } from '@/lib/queues';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Data that has aged past its own interval.
 *
 * Per class, not per table: a service phone number unchecked for a year is
 * probably dead, while a warranty policy unchecked for a year is almost
 * certainly still accurate, and one global interval is wrong in both directions
 * at once.
 *
 * Two buttons, and the distinction between them is the point. "Still correct"
 * moves `verified_at` and nothing else, so a record confirmed unchanged stays
 * distinguishable from one that was rewritten. "Needs a look" takes it out of
 * the published set until a person has been. Neither refetches anything.
 */
export default async function StaleQueuePage() {
  await requireAdmin();
  const [editable, reviewable] = await Promise.all([canEdit(), canReview()]);
  const supabase = await supabaseServer();

  const [contacts, locations, policies] = await Promise.all([
    supabase
      .from('provider_contact_methods')
      .select('id, kind, value, purpose, verified_at, organisation:organisations(id, name)')
      .eq('publication_status', 'published')
      .or(`verified_at.lt.${recheckCutoff('provider_contact')},verified_at.is.null`)
      .order('verified_at', { ascending: true, nullsFirst: true })
      .limit(100),
    supabase
      .from('service_locations')
      .select('id, name, city, verified_at, organisation:organisations(id, name)')
      .eq('publication_status', 'published')
      .is('closed_at', null)
      .or(`verified_at.lt.${recheckCutoff('service_location')},verified_at.is.null`)
      .order('verified_at', { ascending: true, nullsFirst: true })
      .limit(100),
    supabase
      .from('warranties')
      .select('id, model_pattern, country_code, verified_at, brand:organisations!warranties_brand_id_fkey(id, name)')
      .eq('publication_status', 'published')
      .or(`verified_at.lt.${recheckCutoff('warranty_policy')},verified_at.is.null`)
      .order('verified_at', { ascending: true, nullsFirst: true })
      .limit(100),
  ]);

  const sections = [
    {
      key: 'provider_contact' as const,
      title: 'Contact methods',
      table: 'provider_contact_methods',
      rows: (contacts.data ?? []).map((row) => ({
        id: row.id,
        label: `${row.kind} · ${row.value}`,
        owner: (row.organisation as unknown as { id: string; name: string } | null) ?? null,
        verifiedAt: row.verified_at as string | null,
      })),
    },
    {
      key: 'service_location' as const,
      title: 'Service locations',
      table: 'service_locations',
      rows: (locations.data ?? []).map((row) => ({
        id: row.id,
        label: row.name ?? row.city ?? 'unnamed branch',
        owner: (row.organisation as unknown as { id: string; name: string } | null) ?? null,
        verifiedAt: row.verified_at as string | null,
      })),
    },
    {
      key: 'warranty_policy' as const,
      title: 'Warranty policies',
      table: 'warranties',
      rows: (policies.data ?? []).map((row) => ({
        id: row.id,
        label: `${row.model_pattern ?? 'all models'}${row.country_code ? ` · ${row.country_code}` : ''}`,
        owner: (row.brand as unknown as { id: string; name: string } | null) ?? null,
        verifiedAt: row.verified_at as string | null,
      })),
    },
  ];

  return (
    <main className="content">
      <PageHeader
        title="Stale data"
        subtitle="Published records past the re-check interval for their class."
      />

      {sections.map((section) => (
        <Panel
          key={section.key}
          title={section.title}
          note={`Re-check after ${DEFAULT_FRESHNESS[section.key].recheckAfterDays} days · stale after ${DEFAULT_FRESHNESS[section.key].staleAfterDays}`}
          padded={false}
        >
          {section.rows.length === 0 ? (
            <Empty>Nothing overdue.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Record</th>
                    <th>Provider</th>
                    <th className="num">Age</th>
                    <th>State</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {section.rows.map((row) => (
                    <tr key={row.id}>
                      <td dir="auto">{row.label}</td>
                      <td>
                        {row.owner ? (
                          <Link href={`/organisations/${row.owner.id}`}>{row.owner.name}</Link>
                        ) : (
                          <span className="muted">unknown</span>
                        )}
                      </td>
                      <td className="num">
                        {ageInDays(row.verifiedAt) ?? <span className="muted">never</span>}
                      </td>
                      <td>
                        <FreshnessChip state={freshnessOf(row.verifiedAt, section.key)} />
                      </td>
                      <td style={{ textAlign: 'end' }}>
                        <ReverifyButton
                          table={section.table}
                          id={row.id}
                          canEdit={editable}
                          canReview={reviewable}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      ))}

      <p className="notice" data-tone="info">
        Nothing on this page refetches anything. A machine that re-reads a page
        and finds different words on it has found a reason for a person to look,
        not permission to overwrite what a person previously confirmed.
      </p>
    </main>
  );
}
