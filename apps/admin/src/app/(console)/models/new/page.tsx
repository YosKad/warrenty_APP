import { RecordForm } from '@/components/RecordForm';
import { PageHeader, Panel } from '@/components/ui';
import { canEdit, requireAdmin } from '@/lib/auth';
import { MODEL_FIELDS } from '@/lib/fields';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function NewModelPage() {
  await requireAdmin('data_editor');
  const editable = await canEdit();
  const supabase = await supabaseServer();

  const { data: manufacturers } = await supabase
    .from('organisations')
    .select('id, name')
    .contains('roles', ['manufacturer'])
    .order('name')
    .limit(500);

  return (
    <main className="content">
      <PageHeader
        title="New model"
        subtitle="Created as a candidate. Add the spellings people actually use once it exists."
      />

      <Panel>
        <RecordForm
          table="product_models"
          fields={[
            {
              name: 'manufacturer_id',
              label: 'Manufacturer',
              type: 'select',
              required: true,
              options: (manufacturers ?? []).map((org) => ({ value: org.id, label: org.name })),
              hint: 'The company that makes it — not the importer, and not the corporate parent.',
            },
            ...MODEL_FIELDS,
          ]}
          submitLabel="Create as candidate"
          disabled={!editable}
        />
      </Panel>

      <p className="notice" data-tone="info">
        The comparison key must be what the matcher computes for the canonical
        name. Open the model after saving — the identity panel recomputes it and
        says so in red if the two disagree.
      </p>
    </main>
  );
}
