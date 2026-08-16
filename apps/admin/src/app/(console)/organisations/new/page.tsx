import { RecordForm } from '@/components/RecordForm';
import { PageHeader, Panel } from '@/components/ui';
import { canEdit, requireAdmin } from '@/lib/auth';
import { ORGANISATION_FIELDS } from '@/lib/fields';

export const dynamic = 'force-dynamic';

export default async function NewOrganisationPage() {
  await requireAdmin('data_editor');
  const editable = await canEdit();

  return (
    <main className="content">
      <PageHeader
        title="New organisation"
        subtitle="Created as a candidate. It becomes visible to users only after a reviewer publishes it."
      />

      <Panel>
        <RecordForm
          table="organisations"
          fields={ORGANISATION_FIELDS}
          submitLabel="Create as candidate"
          disabled={!editable}
        />
      </Panel>

      <p className="notice" data-tone="info">
        Roles say what kind of company this is. Who it acts <em>for</em> is a
        separate record — add a relationship once the company exists, because
        “imports for Samsung, in Israel, since 2024” is a fact with a scope and
        dates, and a role on a row cannot carry either.
      </p>
    </main>
  );
}
