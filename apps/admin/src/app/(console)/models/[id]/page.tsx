import Link from 'next/link';
import { notFound } from 'next/navigation';
import { parseModel } from '@mw/domain';

import { AliasEditor, type AliasRow } from '@/components/AliasEditor';
import { PublicationControls } from '@/components/PublicationControls';
import { RecordForm } from '@/components/RecordForm';
import { Empty, PageHeader, Panel, StatusChip, Value } from '@/components/ui';
import { canEdit, canReview, requireAdmin } from '@/lib/auth';
import { MODEL_FIELDS } from '@/lib/fields';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function ModelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdmin();

  const supabase = await supabaseServer();
  const [editable, reviewable] = await Promise.all([canEdit(), canReview()]);

  const { data: model } = await supabase
    .from('product_models')
    .select('*, manufacturer:organisations(id, name)')
    .eq('id', id)
    .maybeSingle();

  if (!model) notFound();

  const [{ data: aliases }, { data: policies }] = await Promise.all([
    supabase
      .from('model_aliases')
      .select('*')
      .eq('model_id', id)
      .order('publication_status')
      .order('value'),
    supabase
      .from('warranties')
      .select('id, policy_version, duration_months, country_code, publication_status')
      .eq('model_id', id),
  ]);

  const manufacturer = model.manufacturer as unknown as { id: string; name: string } | null;
  const parsed = parseModel(model.canonical_model, {
    ...(manufacturer ? { brands: [manufacturer.name] } : {}),
  });

  return (
    <main className="content">
      <PageHeader
        title={model.canonical_model}
        subtitle={manufacturer?.name ?? undefined}
        actions={<StatusChip status={model.publication_status} />}
      />

      <div className="split">
        <Panel title="Identity">
          <RecordForm
            table="product_models"
            id={id}
            fields={MODEL_FIELDS}
            initial={model}
            disabled={!editable}
          />
        </Panel>

        <div className="stack">
          <Panel title="Publication">
            <PublicationControls
              table="product_models"
              id={id}
              status={model.publication_status}
              canReview={reviewable}
              canEdit={editable}
            />
          </Panel>

          <Panel
            title="How the matcher reads this name"
            note="Recomputed live, so a mismatch between the stored key and the algorithm is visible here."
          >
            <table className="data">
              <tbody>
                <tr>
                  <td>Stored key</td>
                  <td className="mono">{model.normalized_key}</td>
                </tr>
                <tr>
                  <td>Computed now</td>
                  <td
                    className="mono"
                    style={
                      parsed.normalised !== model.normalized_key
                        ? { color: 'var(--danger)' }
                        : undefined
                    }
                  >
                    {parsed.normalised || '—'}
                  </td>
                </tr>
                <tr>
                  <td>Identity</td>
                  <td className="mono">{parsed.identity || '—'}</td>
                </tr>
                <tr>
                  <td>Screen size</td>
                  <td className="num">{parsed.screenSize ?? '—'}</td>
                </tr>
              </tbody>
            </table>
            {parsed.normalised !== model.normalized_key ? (
              <p className="notice" data-tone="danger">
                The stored key does not match what the matcher would compute. Save
                the record to bring them back into line.
              </p>
            ) : null}
          </Panel>

          <Panel title="Policies" padded={false}>
            {(policies ?? []).length === 0 ? (
              <Empty>No policy points at this model yet.</Empty>
            ) : (
              <table className="data">
                <tbody>
                  {(policies ?? []).map((policy) => (
                    <tr key={policy.id}>
                      <td>
                        <Link href={`/warranties/${policy.id}`}>
                          <Value>{policy.policy_version}</Value>
                        </Link>
                      </td>
                      <td className="num">{policy.duration_months ?? '—'} mo</td>
                      <td>
                        <StatusChip status={policy.publication_status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
      </div>

      <Panel
        title="Aliases"
        note="Every approved way of writing this product. Only verified and published ones resolve."
        padded={false}
      >
        <div className="panel-body">
          <AliasEditor
            modelId={id}
            aliases={(aliases ?? []) as AliasRow[]}
            brands={manufacturer ? [manufacturer.name] : []}
            canEdit={editable}
            canReview={reviewable}
          />
        </div>
      </Panel>
    </main>
  );
}
