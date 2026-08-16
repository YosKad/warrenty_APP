import { RecordForm } from '@/components/RecordForm';
import { PageHeader, Panel } from '@/components/ui';
import { canEdit, requireAdmin } from '@/lib/auth';
import { RELATIONSHIP_KINDS } from '@/lib/fields';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function NewRelationshipPage({
  searchParams,
}: {
  searchParams: Promise<{ subject?: string; object?: string }>;
}) {
  await requireAdmin('data_editor');
  const params = await searchParams;
  const editable = await canEdit();
  const supabase = await supabaseServer();

  const [{ data: organisations }, { data: categories }] = await Promise.all([
    supabase.from('organisations').select('id, name').order('name').limit(500),
    supabase.from('product_categories').select('id, name').order('name'),
  ]);

  const orgOptions = (organisations ?? []).map((org) => ({ value: org.id, label: org.name }));

  return (
    <main className="content">
      <PageHeader
        title="New relationship"
        subtitle="“Samline imports for Samsung, in Israel, televisions, from March 2024.”"
      />

      <Panel>
        <RecordForm
          table="organisation_relationships"
          fields={[
            {
              name: 'subject_id',
              label: 'This company',
              type: 'select',
              required: true,
              options: orgOptions,
            },
            {
              name: 'kind',
              label: 'acts as',
              type: 'select',
              required: true,
              options: RELATIONSHIP_KINDS.map((kind) => ({
                value: kind,
                label: kind.replace(/_/g, ' '),
              })),
            },
            {
              name: 'object_id',
              label: 'for',
              type: 'select',
              required: true,
              options: orgOptions,
            },
            { name: 'country_code', label: 'Country', placeholder: 'IL' },
            {
              name: 'category_id',
              label: 'Category',
              type: 'select',
              options: (categories ?? []).map((category) => ({
                value: category.id,
                label: category.name,
              })),
            },
            {
              name: 'model_pattern',
              label: 'Model pattern',
              hint: 'Only when the agreement is genuinely limited to a range.',
            },
            {
              name: 'purchase_channel',
              label: 'Purchase channel',
              hint: 'e.g. “official retail”. Blank means not narrowed.',
            },
            { name: 'effective_from', label: 'From', type: 'date' },
            {
              name: 'effective_to',
              label: 'To',
              type: 'date',
              hint: 'Leave blank while it is current. When it ends, set this — do not delete the row.',
            },
            { name: 'note', label: 'Note', type: 'textarea', width: 'full' },
          ]}
          initial={{ subject_id: params.subject ?? '', object_id: params.object ?? '' }}
          submitLabel="Create as candidate"
          disabled={!editable}
        />
      </Panel>

      <p className="notice" data-tone="info">
        Leaving a scope blank means <em>not narrowed</em>, which is not the same
        as <em>everywhere</em>. A relationship with no country recorded will not
        be used to claim that a company imports for a brand in a country nobody
        checked.
      </p>
    </main>
  );
}
