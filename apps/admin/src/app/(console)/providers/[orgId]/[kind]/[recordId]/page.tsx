import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PublicationControls } from '@/components/PublicationControls';
import { RecordForm } from '@/components/RecordForm';
import { PageHeader, Panel } from '@/components/ui';
import { canEdit, canReview, requireAdmin } from '@/lib/auth';
import { CAPABILITY_FIELDS, CONTACT_FIELDS, LOCATION_FIELDS } from '@/lib/fields';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * One editor for contacts, branches and capabilities.
 *
 * The three differ only in their field lists, and three near-identical pages is
 * three places for the "blank means unknown" rule to be implemented slightly
 * differently. `kind` is matched against a closed map — an unrecognised segment
 * is a 404, never a table name.
 */
const KINDS = {
  contacts: {
    table: 'provider_contact_methods',
    fields: CONTACT_FIELDS,
    title: 'Contact method',
  },
  locations: {
    table: 'service_locations',
    fields: LOCATION_FIELDS,
    title: 'Service location',
  },
  capabilities: {
    table: 'service_capabilities',
    fields: CAPABILITY_FIELDS,
    title: 'Capability',
  },
} as const;

type Kind = keyof typeof KINDS;

export default async function ProviderRecordPage({
  params,
}: {
  params: Promise<{ orgId: string; kind: string; recordId: string }>;
}) {
  const { orgId, kind, recordId } = await params;
  if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) notFound();

  const spec = KINDS[kind as Kind];
  await requireAdmin(recordId === 'new' ? 'data_editor' : 'viewer');

  const supabase = await supabaseServer();
  const [editable, reviewable] = await Promise.all([canEdit(), canReview()]);

  const { data: organisation } = await supabase
    .from('organisations')
    .select('id, name')
    .eq('id', orgId)
    .maybeSingle();
  if (!organisation) notFound();

  const existing =
    recordId === 'new'
      ? null
      : ((
          await supabase.from(spec.table).select('*').eq('id', recordId).maybeSingle()
        ).data as Record<string, unknown> | null);

  if (recordId !== 'new' && !existing) notFound();

  return (
    <main className="content">
      <PageHeader
        title={spec.title}
        subtitle={organisation.name}
        actions={
          <Link className="button" href={`/organisations/${orgId}`}>
            Back to organisation
          </Link>
        }
      />

      <div className="split">
        <Panel title={recordId === 'new' ? 'New record' : 'Edit'}>
          <RecordForm
            table={spec.table}
            {...(existing ? { id: recordId } : {})}
            fields={spec.fields}
            initial={existing ?? {}}
            fixed={{ organisation_id: orgId }}
            submitLabel={existing ? 'Save' : 'Create as candidate'}
            disabled={!editable}
          />
        </Panel>

        <div className="stack">
          {existing ? (
            <Panel title="Publication">
              <PublicationControls
                table={spec.table}
                id={recordId}
                status={existing.publication_status as never}
                canReview={reviewable}
                canEdit={editable}
              />
            </Panel>
          ) : null}

          <Panel title="Provenance">
            <p className="panel-note">
              Every record carries where it came from and when a person last
              confirmed it. A record nobody has confirmed reads as “never
              verified” in the app — which is accurate, and better than silence.
            </p>
          </Panel>
        </div>
      </div>
    </main>
  );
}
