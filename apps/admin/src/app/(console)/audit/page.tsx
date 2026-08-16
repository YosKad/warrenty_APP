import { Empty, PageHeader, Panel } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * The audit trail.
 *
 * Readable by administrators, writable by nobody: entries are inserted by a
 * `security definer` function that stamps the actor from the session, because a
 * client that can write the audit log can rewrite the record of what it did.
 *
 * Both halves of every change are here. An audit entry that records only the
 * new value answers the least interesting half of the question.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; action?: string }>;
}) {
  await requireAdmin('admin');
  const params = await searchParams;
  const supabase = await supabaseServer();

  let query = supabase
    .from('audit_logs')
    .select('id, actor_id, action, entity_type, entity_id, before_state, after_state, reason, created_at')
    .order('created_at', { ascending: false })
    .limit(200);

  if (params.entity) query = query.eq('entity_type', params.entity);
  if (params.action) query = query.ilike('action', `%${params.action}%`);

  const { data: entries, error } = await query;

  const actorIds = [...new Set((entries ?? []).map((entry) => entry.actor_id).filter(Boolean))];
  const { data: actors } = actorIds.length
    ? await supabase.from('user_profiles').select('id, email').in('id', actorIds as string[])
    : { data: [] };
  const emailById = new Map((actors ?? []).map((actor) => [actor.id, actor.email as string]));

  return (
    <main className="content">
      <PageHeader
        title="Audit log"
        subtitle="Who changed what, from what, to what, and why."
      />

      <Panel>
        <form className="row" method="get">
          <input
            type="text"
            name="entity"
            placeholder="Table"
            defaultValue={params.entity ?? ''}
            style={{ maxWidth: 220 }}
          />
          <input
            type="text"
            name="action"
            placeholder="Action contains…"
            defaultValue={params.action ?? ''}
            style={{ maxWidth: 220 }}
          />
          <button type="submit">Filter</button>
        </form>
      </Panel>

      <Panel padded={false}>
        {error ? (
          <p className="notice" data-tone="danger">
            {error.message}
          </p>
        ) : (entries ?? []).length === 0 ? (
          <Empty>Nothing recorded yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Action</th>
                  <th>Before</th>
                  <th>After</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {(entries ?? []).map((entry) => (
                  <tr key={entry.id}>
                    <td className="mono muted" style={{ whiteSpace: 'nowrap' }}>
                      {new Date(entry.created_at).toISOString().slice(0, 16).replace('T', ' ')}
                    </td>
                    <td className="muted">
                      {entry.actor_id ? emailById.get(entry.actor_id) ?? 'unknown' : 'system'}
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {entry.action}
                    </td>
                    <td>
                      <StateCell state={entry.before_state} />
                    </td>
                    <td>
                      <StateCell state={entry.after_state} />
                    </td>
                    <td className="muted" dir="auto">
                      {entry.reason ?? '—'}
                    </td>
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

function StateCell({ state }: { state: unknown }) {
  if (!state || typeof state !== 'object') return <span className="muted">—</span>;
  const entries = Object.entries(state as Record<string, unknown>);
  if (entries.length === 0) return <span className="muted">—</span>;

  return (
    <div className="mono" style={{ fontSize: 11, maxWidth: 280 }}>
      {entries.map(([key, value]) => (
        <div key={key} dir="auto">
          <span className="muted">{key}</span>{' '}
          {value === null ? <span className="muted">null</span> : String(value).slice(0, 80)}
        </div>
      ))}
    </div>
  );
}
