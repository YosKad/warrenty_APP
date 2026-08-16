/**
 * The trust model.
 *
 * Two independent axes, and keeping them independent is the point. `source`
 * says *who* the claim came from; `verification` says *how carefully it was
 * checked*. A retailer document a person read and confirmed is better evidence
 * than a manufacturer page nobody has looked at since it was scraped, and a
 * model that collapsed these into one number could not express that.
 */

export type WarrantySource =
  | 'user_entered'
  | 'manufacturer'
  | 'retailer'
  | 'internal_db'
  | 'document_extraction'
  | 'ai_inferred';

export type VerificationState =
  | 'unverified'
  | 'ai_extracted'
  | 'community_submitted'
  | 'verified'
  | 'official';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

/** 'YYYY-MM-DD'. */
export type CalendarDate = string;

/**
 * Trust order, most trusted first. Lower number wins.
 *
 * `manufacturer` covers importer documentation too: in the schema an importer's
 * own warranty booklet is a `manufacturer`-kind source attached to the importer
 * organisation, because from the owner's point of view it is the document that
 * governs the product, whoever published it.
 */
export const SOURCE_PRIORITY: Record<WarrantySource, number> = {
  manufacturer: 1,
  internal_db: 2,
  retailer: 3,
  document_extraction: 4,
  user_entered: 5,
  ai_inferred: 6,
};

export const VERIFICATION_RANK: Record<VerificationState, number> = {
  official: 0,
  verified: 1,
  community_submitted: 2,
  ai_extracted: 3,
  unverified: 4,
};

/**
 * Whether `a` strictly outranks `b` as a source of truth. Requires being at
 * least as good on *both* axes and better on one — so a well-verified retailer
 * document does not lose to an unverified manufacturer page purely on kind.
 */
export function outranksSource(
  a: { source: WarrantySource; verification: VerificationState },
  b: { source: WarrantySource; verification: VerificationState },
): boolean {
  const kindA = SOURCE_PRIORITY[a.source];
  const kindB = SOURCE_PRIORITY[b.source];
  const verA = VERIFICATION_RANK[a.verification];
  const verB = VERIFICATION_RANK[b.verification];
  if (kindA <= kindB && verA <= verB) return kindA < kindB || verA < verB;
  return false;
}

// ---------------------------------------------------------------------------
// Publication lifecycle
// ---------------------------------------------------------------------------

/**
 * Where a record is in the review workflow, which is a different question from
 * how trustworthy it is. A row can be `official` and still `candidate`: an
 * importer's own PDF that nobody has reviewed yet.
 *
 * Only `published` is visible to the resolver. Nothing an extractor or an
 * importer writes starts there.
 */
export type PublicationStatus =
  | 'candidate'
  | 'needs_review'
  | 'verified'
  | 'published'
  | 'needs_reverification'
  | 'archived'
  | 'rejected';

export type DataEnvironment = 'production' | 'demo';

/** The states a reviewer can move a record into, per current state. */
export const PUBLICATION_TRANSITIONS: Record<PublicationStatus, PublicationStatus[]> = {
  // Straight to verified is allowed: `needs_review` is a queue, not a mandatory
  // stop, and a reviewer who has just read the clause against its source should
  // not have to park it in a queue addressed to themselves. What they may not do
  // is skip to published — and whether they are a reviewer at all is checked by
  // the database, not by this table.
  candidate: ['needs_review', 'verified', 'rejected'],
  needs_review: ['verified', 'rejected', 'candidate'],
  // Verification and publication are separate acts. A reviewer may confirm a
  // policy is correct and still hold it back — usually because the provider
  // chain behind it is not filled in yet.
  verified: ['published', 'needs_review'],
  published: ['needs_reverification', 'archived'],
  needs_reverification: ['verified', 'archived', 'needs_review'],
  archived: ['needs_review'],
  rejected: ['candidate'],
};

export function canTransition(from: PublicationStatus, to: PublicationStatus): boolean {
  return PUBLICATION_TRANSITIONS[from].includes(to);
}

/**
 * Whether an actor is allowed to move a record to this state at all.
 *
 * Machines may propose and may reject their own work. Only a person may
 * verify or publish — the entire reason the candidate state exists.
 */
export function actorMayPublish(actor: 'human' | 'machine', to: PublicationStatus): boolean {
  if (actor === 'human') return true;
  return to === 'candidate' || to === 'needs_review' || to === 'rejected';
}

/** What the resolver is allowed to read. */
export function isLive(record: {
  publicationStatus: PublicationStatus;
  dataEnvironment: DataEnvironment;
}): boolean {
  return record.publicationStatus === 'published' && record.dataEnvironment === 'production';
}
