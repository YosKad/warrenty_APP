import { DEFAULT_FRESHNESS, type DataClass } from '@mw/domain';

import { supabaseServer } from './supabase/server';

/**
 * The work queues.
 *
 * The dashboard is not a set of vanity totals. Every number here is something a
 * reviewer can open and clear, and the sidebar shows the same counts so the
 * next task is visible from wherever you are. A count that nobody can act on
 * does not belong in this file.
 */

export type QueueKey =
  | 'needs_review'
  | 'extraction'
  | 'conflicts'
  | 'reports'
  | 'stale'
  | 'duplicates';

export type QueueCount = {
  key: QueueKey;
  label: string;
  href: string;
  count: number;
  /** Shown in red. Reserved for queues where waiting actively misinforms users. */
  urgent: boolean;
};

/** The date before which a record of this class counts as stale. */
export function staleCutoff(dataClass: DataClass, now = new Date()): string {
  const days = DEFAULT_FRESHNESS[dataClass].staleAfterDays;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** The date before which a record of this class is due a re-check. */
export function recheckCutoff(dataClass: DataClass, now = new Date()): string {
  const days = DEFAULT_FRESHNESS[dataClass].recheckAfterDays;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function queueCounts(): Promise<QueueCount[]> {
  const supabase = await supabaseServer();
  const contactCutoff = staleCutoff('provider_contact');
  const locationCutoff = staleCutoff('service_location');

  const head = { count: 'exact' as const, head: true };
  const unreviewed = ['candidate', 'needs_review'];

  const [
    warranties,
    terms,
    organisations,
    relationships,
    extraction,
    conflicts,
    reports,
    staleContacts,
    staleLocations,
    duplicates,
  ] = await Promise.all([
    supabase.from('warranties').select('id', head).in('publication_status', unreviewed),
    supabase.from('warranty_terms').select('id', head).in('publication_status', unreviewed),
    supabase.from('organisations').select('id', head).in('publication_status', unreviewed),
    supabase
      .from('organisation_relationships')
      .select('id', head)
      .in('publication_status', unreviewed),
    supabase
      .from('extraction_jobs')
      .select('id', head)
      .in('status', ['needs_review', 'failed']),
    supabase.from('warranty_conflicts').select('id', head).eq('status', 'open'),
    supabase.from('service_data_reports').select('id', head).eq('status', 'open'),
    supabase
      .from('provider_contact_methods')
      .select('id', head)
      .eq('publication_status', 'published')
      .or(`verified_at.lt.${contactCutoff},verified_at.is.null`),
    supabase
      .from('service_locations')
      .select('id', head)
      .eq('publication_status', 'published')
      .is('closed_at', null)
      .or(`verified_at.lt.${locationCutoff},verified_at.is.null`),
    supabase.from('import_rows').select('id', head).eq('status', 'duplicate'),
  ]);

  const n = (result: { count: number | null }) => result.count ?? 0;

  return [
    {
      key: 'needs_review',
      label: 'Needs review',
      href: '/review',
      count: n(warranties) + n(terms) + n(organisations) + n(relationships),
      urgent: false,
    },
    {
      key: 'extraction',
      label: 'Extraction',
      href: '/queues/extraction',
      count: n(extraction),
      urgent: false,
    },
    {
      key: 'conflicts',
      label: 'Conflicts',
      href: '/queues/conflicts',
      // Two published policies disagreeing means somebody is being told a
      // duration that may be wrong, right now.
      count: n(conflicts),
      urgent: n(conflicts) > 0,
    },
    {
      key: 'reports',
      label: 'User reports',
      href: '/queues/reports',
      // A user took the trouble to tell us a number is dead. It probably is.
      count: n(reports),
      urgent: n(reports) > 0,
    },
    {
      key: 'stale',
      label: 'Stale data',
      href: '/queues/stale',
      count: n(staleContacts) + n(staleLocations),
      urgent: false,
    },
    {
      key: 'duplicates',
      label: 'Duplicates',
      href: '/queues/duplicates',
      count: n(duplicates),
      urgent: false,
    },
  ];
}
