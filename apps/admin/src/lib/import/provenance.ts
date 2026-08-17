import { normaliseUrl, parseSheetDate } from '@mw/domain';

/**
 * Provenance on an imported row.
 *
 * The rule this file exists to enforce: **no row becomes trusted because it
 * arrived in a spreadsheet.** A CSV can assert anything — that a warranty is
 * 60 months, that a term is `official` — and the file itself is no evidence at
 * all. What makes a claim checkable is a source somebody can open.
 *
 * So a stated verification above `unverified` requires a source reference. With
 * one, the claim can be checked and the reviewer's job is possible; without
 * one, the row still imports, but as an unverified claim rather than an
 * official one.
 */

export const PROVENANCE_COLUMNS = [
  'source_url',
  'source_title',
  'source_kind',
  'retrieved_date',
  'verification',
  'researcher',
  'source_excerpt',
  'content_hash',
] as const;

export type ProvenanceInput = Partial<Record<(typeof PROVENANCE_COLUMNS)[number], string>>;

export type Provenance = {
  /** Deduplicated within a package by normalised URL, then by title. */
  sourceKey: string | null;
  sourceUrl: string | null;
  sourceTitle: string | null;
  sourceKind: string;
  retrievedAt: string | null;
  contentHash: string | null;
  excerpt: string | null;
  researcher: string | null;
  /** What the row may claim, after the source requirement is applied. */
  verification: string;
  notes: string[];
};

const VERIFICATION_VALUES = [
  'unverified',
  'ai_extracted',
  'community_submitted',
  'verified',
  'official',
] as const;

const SOURCE_KINDS = [
  'manufacturer',
  'retailer',
  'internal_db',
  'document_extraction',
  'user_entered',
  'ai_inferred',
] as const;

export function readProvenance(row: ProvenanceInput): Provenance {
  const notes: string[] = [];

  const sourceUrl = row.source_url?.trim() || null;
  const sourceTitle = row.source_title?.trim() || null;
  const sourceKey = sourceUrl ? normaliseUrl(sourceUrl) : sourceTitle ? sourceTitle.toLowerCase() : null;

  const statedKind = (row.source_kind ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const sourceKind = (SOURCE_KINDS as readonly string[]).includes(statedKind)
    ? statedKind
    : 'internal_db';
  if (statedKind && sourceKind !== statedKind) {
    notes.push(`Source kind “${row.source_kind}” is not one we recognise; recorded as internal.`);
  }

  const stated = (row.verification ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  let verification = (VERIFICATION_VALUES as readonly string[]).includes(stated)
    ? stated
    : 'unverified';

  if (stated && verification !== stated) {
    notes.push(`Verification “${row.verification}” is not a value we use; recorded as unverified.`);
  }

  // The rule. A spreadsheet asserting "official" with nothing to check it
  // against is a spreadsheet asserting its own authority.
  if (verification !== 'unverified' && !sourceKey) {
    notes.push(
      `Claimed “${verification}” with no source. Recorded as unverified — a reviewer cannot check a claim with nothing behind it.`,
    );
    verification = 'unverified';
  }

  const retrievedAt = row.retrieved_date ? parseSheetDate(row.retrieved_date) : null;
  if (row.retrieved_date?.trim() && !retrievedAt) {
    notes.push(`Retrieved date “${row.retrieved_date}” could not be read.`);
  }

  return {
    sourceKey,
    sourceUrl,
    sourceTitle,
    sourceKind,
    retrievedAt,
    contentHash: row.content_hash?.trim() || null,
    excerpt: row.source_excerpt?.trim() || null,
    researcher: row.researcher?.trim() || null,
    verification,
    notes,
  };
}

/** The provenance fields as import columns, appended to every corpus target. */
export function provenanceFields(): {
  key: string;
  label: string;
  aliases: string[];
  hint?: string;
}[] {
  return [
    {
      key: 'source_url',
      label: 'Source URL',
      aliases: ['source url', 'source', 'url', 'reference', 'מקור'],
      hint: 'The page or document this fact came from. Required for any claim above “unverified”.',
    },
    { key: 'source_title', label: 'Source title', aliases: ['source title', 'document', 'document title'] },
    { key: 'source_kind', label: 'Source kind', aliases: ['source kind', 'source type'] },
    { key: 'retrieved_date', label: 'Retrieved', aliases: ['retrieved', 'retrieved date', 'accessed'] },
    {
      key: 'verification',
      label: 'Verification',
      aliases: ['verification', 'trust', 'confidence level'],
      hint: 'unverified · community_submitted · verified · official. Downgraded to unverified without a source.',
    },
    { key: 'researcher', label: 'Researcher', aliases: ['researcher', 'author', 'by'] },
    {
      key: 'source_excerpt',
      label: 'Excerpt',
      aliases: ['excerpt', 'quote', 'source excerpt'],
      hint: 'The sentence the fact came from, so a reviewer does not have to re-read the whole document.',
    },
    { key: 'content_hash', label: 'Content hash', aliases: ['hash', 'content hash', 'sha256'] },
  ];
}
