import { ConflictQueue, type ConflictRow } from '@/components/ConflictQueue';
import { Empty, PageHeader, Panel } from '@/components/ui';
import { canReview, requireAdmin } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Warranty conflicts.
 *
 * Two comparably good sources saying different things about the same product.
 * The resolver refuses to pick between them and shows the user a disagreement,
 * which is the right behaviour and also the reason this queue is urgent: until
 * it is resolved, somebody is being told "we are not sure".
 */
export default async function ConflictsPage() {
  await requireAdmin();
  const reviewable = await canReview();
  const supabase = await supabaseServer();

  const { data: conflicts } = await supabase
    .from('warranty_conflicts')
    .select('*')
    .eq('status', 'open')
    .order('created_at')
    .limit(100);

  const warrantyIds = [...new Set((conflicts ?? []).flatMap((row) => row.warranty_ids))];

  const { data: warranties } = warrantyIds.length
    ? await supabase
        .from('warranties')
        .select(
          `id, duration_months, model_pattern, country_code, policy_version, verification,
           publication_status,
           brand:organisations!warranties_brand_id_fkey(name),
           provider:organisations!warranties_warranty_provider_id_fkey(name),
           source:warranty_sources(kind, document_title, source_url, verification)`,
        )
        .in('id', warrantyIds)
    : { data: [] };

  const byId = new Map(
    (warranties ?? []).map((warranty) => [warranty.id, warranty as Record<string, unknown>]),
  );

  return (
    <main className="content">
      <PageHeader
        title="Warranty conflicts"
        subtitle="Two comparable sources that disagree. Resolving one never deletes the other."
      />

      {(conflicts ?? []).length === 0 ? (
        <Panel>
          <Empty>No open conflicts.</Empty>
        </Panel>
      ) : (
        <ConflictQueue
          conflicts={(conflicts ?? []) as ConflictRow[]}
          warranties={Object.fromEntries(byId)}
          canReview={reviewable}
        />
      )}

      <p className="notice" data-tone="info">
        “Both apply” is a real answer — an importer’s terms and a manufacturer’s
        global terms can both be true for different products. It requires a note
        saying which is which, because a user shown two policies and no way to
        tell them apart has been given less than one.
      </p>
    </main>
  );
}
