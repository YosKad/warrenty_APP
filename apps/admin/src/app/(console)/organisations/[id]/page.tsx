import Link from 'next/link';
import { notFound } from 'next/navigation';
import { freshnessOf } from '@mw/domain';

import { PublicationControls } from '@/components/PublicationControls';
import { RecordForm } from '@/components/RecordForm';
import {
  Empty,
  EnvironmentChip,
  FreshnessChip,
  PageHeader,
  Panel,
  StatusChip,
  Value,
  VerificationChip,
} from '@/components/ui';
import { canEdit, canReview, requireAdmin } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { ORGANISATION_FIELDS } from '@/lib/fields';

export const dynamic = 'force-dynamic';

/**
 * One organisation, and everything that hangs off it.
 *
 * Contacts, branches and capabilities live on this page rather than in their
 * own sections because that is how the work actually arrives — an operator
 * researching Samline fills in all three in one sitting, and making them
 * navigate away between each is how a provider ends up with a phone number and
 * no opening hours.
 */
export default async function OrganisationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAdmin();

  const supabase = await supabaseServer();
  const [editable, reviewable] = await Promise.all([canEdit(), canReview()]);

  const { data: organisation } = await supabase
    .from('organisations')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (!organisation) notFound();

  const [contacts, locations, capabilities, asSubject, asObject] = await Promise.all([
    supabase
      .from('provider_contact_methods')
      .select('*')
      .eq('organisation_id', id)
      .order('priority'),
    supabase.from('service_locations').select('*').eq('organisation_id', id).order('city'),
    supabase.from('service_capabilities').select('*').eq('organisation_id', id).order('kind'),
    supabase
      .from('organisation_relationships')
      .select('id, kind, country_code, publication_status, object:organisations!organisation_relationships_object_id_fkey(id, name)')
      .eq('subject_id', id),
    supabase
      .from('organisation_relationships')
      .select('id, kind, country_code, publication_status, subject:organisations!organisation_relationships_subject_id_fkey(id, name)')
      .eq('object_id', id),
  ]);

  return (
    <main className="content">
      <PageHeader
        title={organisation.name}
        subtitle={organisation.legal_name ?? undefined}
        actions={
          <>
            <StatusChip status={organisation.publication_status} />
            <EnvironmentChip environment={organisation.data_environment} />
          </>
        }
      />

      <div className="split">
        <Panel title="Details">
          <RecordForm
            table="organisations"
            id={id}
            fields={ORGANISATION_FIELDS}
            initial={organisation}
            disabled={!editable}
          />
        </Panel>

        <div className="stack">
          <Panel title="Publication">
            <PublicationControls
              table="organisations"
              id={id}
              status={organisation.publication_status}
              canReview={reviewable}
              canEdit={editable}
            />
          </Panel>

          <Panel
            title="Relationships"
            note="What this company does, for whom, where. Scoped and dated — not permanent."
            actions={
              <Link className="button" href={`/relationships/new?subject=${id}`}>
                Add
              </Link>
            }
            padded={false}
          >
            {(asSubject.data ?? []).length === 0 && (asObject.data ?? []).length === 0 ? (
              <Empty>No relationships recorded.</Empty>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <tbody>
                    {(asSubject.data ?? []).map((row) => {
                      const other = row.object as unknown as { id: string; name: string } | null;
                      return (
                        <tr key={row.id}>
                          <td>
                            {organisation.name} <span className="muted">{row.kind.replace(/_/g, ' ')}</span>{' '}
                            {other ? <Link href={`/organisations/${other.id}`}>{other.name}</Link> : '?'}
                          </td>
                          <td>
                            <Value>{row.country_code}</Value>
                          </td>
                          <td>
                            <StatusChip status={row.publication_status} />
                          </td>
                        </tr>
                      );
                    })}
                    {(asObject.data ?? []).map((row) => {
                      const other = row.subject as unknown as { id: string; name: string } | null;
                      return (
                        <tr key={row.id}>
                          <td>
                            {other ? <Link href={`/organisations/${other.id}`}>{other.name}</Link> : '?'}{' '}
                            <span className="muted">{row.kind.replace(/_/g, ' ')}</span> {organisation.name}
                          </td>
                          <td>
                            <Value>{row.country_code}</Value>
                          </td>
                          <td>
                            <StatusChip status={row.publication_status} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      </div>

      <Panel
        title="Contact methods"
        note="Purpose is what makes a route usable: a general switchboard and a warranty line are not interchangeable."
        actions={
          <Link className="button" href={`/providers/${id}/contacts/new`}>
            Add contact
          </Link>
        }
        padded={false}
      >
        {(contacts.data ?? []).length === 0 ? (
          <Empty>No contact methods. This provider cannot currently be reached.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Purpose</th>
                  <th>Value</th>
                  <th>Languages</th>
                  <th>Freshness</th>
                  <th>State</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(contacts.data ?? []).map((contact) => (
                  <tr key={contact.id}>
                    <td>{contact.kind}</td>
                    <td>
                      <Value>{contact.purpose?.replace(/_/g, ' ')}</Value>
                    </td>
                    <td className="mono" dir="ltr">
                      {contact.value}
                    </td>
                    <td className="muted">{(contact.language_codes ?? []).join(', ') || '—'}</td>
                    <td>
                      <FreshnessChip
                        state={freshnessOf(contact.verified_at, 'provider_contact')}
                      />
                    </td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        <StatusChip status={contact.publication_status} />
                        <VerificationChip state={contact.verification} />
                      </div>
                    </td>
                    <td style={{ textAlign: 'end' }}>
                      <Link href={`/providers/${id}/contacts/${contact.id}`}>Edit</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="split">
        <Panel
          title="Service locations"
          actions={
            <Link className="button" href={`/providers/${id}/locations/new`}>
              Add branch
            </Link>
          }
          padded={false}
        >
          {(locations.data ?? []).length === 0 ? (
            <Empty>No branches recorded.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Branch</th>
                    <th>City</th>
                    <th>Hours</th>
                    <th>Freshness</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(locations.data ?? []).map((location) => (
                    <tr key={location.id}>
                      <td dir="auto">
                        <Value>{location.name}</Value>
                        {location.closed_at ? (
                          <span className="chip" data-tone="danger" style={{ marginInlineStart: 6 }}>
                            closed
                          </span>
                        ) : null}
                      </td>
                      <td dir="auto">
                        <Value>{location.city}</Value>
                      </td>
                      <td>
                        {location.opening_hours &&
                        Object.keys(location.opening_hours).length > 0 ? (
                          <span className="chip" data-tone="ok">
                            recorded
                          </span>
                        ) : (
                          // Never invented. A branch with unknown hours reads as
                          // unknown in the app too.
                          <span className="chip">unknown</span>
                        )}
                      </td>
                      <td>
                        <FreshnessChip
                          state={freshnessOf(location.verified_at, 'service_location')}
                        />
                      </td>
                      <td style={{ textAlign: 'end' }}>
                        <Link href={`/providers/${id}/locations/${location.id}`}>Edit</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel
          title="Capabilities"
          note="Three-valued. “Not confirmed” is an answer, and it is not the same as “no”."
          actions={
            <Link className="button" href={`/providers/${id}/capabilities/new`}>
              Add capability
            </Link>
          }
          padded={false}
        >
          {(capabilities.data ?? []).length === 0 ? (
            <Empty>No capabilities recorded.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Capability</th>
                    <th>Availability</th>
                    <th>Lead time</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(capabilities.data ?? []).map((capability) => (
                    <tr key={capability.id}>
                      <td>{capability.kind.replace(/_/g, ' ')}</td>
                      <td>
                        <span
                          className="chip"
                          data-tone={
                            capability.availability === 'available'
                              ? 'ok'
                              : capability.availability === 'unavailable'
                                ? 'danger'
                                : 'neutral'
                          }
                        >
                          {capability.availability.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="num">
                        <Value>{capability.typical_lead_time_days}</Value>
                      </td>
                      <td style={{ textAlign: 'end' }}>
                        <Link href={`/providers/${id}/capabilities/${capability.id}`}>Edit</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </main>
  );
}
