import { normaliseName } from './normalise';
import type { PublicationStatus, VerificationState } from './sources';

/**
 * Resolving a name on a receipt to a company.
 *
 * The distinction that has to survive this file: **brand**, **manufacturer**,
 * **importer** and **corporate parent** are four different things, and a
 * receipt mentions them interchangeably. BSH imports Bosch appliances; "BSH" on
 * a receipt is evidence about the importer and says nothing about which brand
 * the product is. Collapsing them would let a Bosch dishwasher inherit Siemens'
 * terms because one company sells both.
 *
 * So an alias always points at *one* organisation and carries what kind of name
 * it is. Nothing here infers a relationship — that is what
 * `organisation_relationships` is for, and it is researched, not derived.
 */

export type OrganisationAliasKind =
  | 'trading_name'
  | 'legal_name'
  | 'brand'
  | 'abbreviation'
  | 'transliteration'
  | 'receipt_text';

export type OrganisationAlias = {
  value: string;
  kind: OrganisationAliasKind;
  verification: VerificationState;
  publicationStatus: PublicationStatus;
};

export type OrganisationRecord = {
  id: string;
  name: string;
  legalName?: string | null;
  countryCode?: string | null;
  roles: string[];
  aliases?: OrganisationAlias[];
};

export type OrganisationMatch = {
  organisation: OrganisationRecord;
  /** How the name was recognised, in decreasing order of certainty. */
  via: 'name' | 'legal_name' | 'alias';
  aliasKind: OrganisationAliasKind | null;
  evidence: string;
};

export type OrganisationResolution = {
  input: string;
  state: 'resolved' | 'ambiguous' | 'unresolved';
  resolved: OrganisationMatch | null;
  candidates: OrganisationMatch[];
};

function usableAlias(alias: OrganisationAlias): boolean {
  return (
    (alias.publicationStatus === 'published' || alias.publicationStatus === 'verified') &&
    alias.verification !== 'unverified' &&
    alias.verification !== 'ai_extracted'
  );
}

/**
 * Finds the company a string refers to.
 *
 * Exact on the folded name first, then the registered name, then approved
 * aliases. Two different companies answering to the same name is a real
 * situation in a small market — it returns ambiguous rather than picking the
 * first row, because picking is how a warranty gets routed to the wrong
 * importer.
 */
export function resolveOrganisation(
  raw: string,
  organisations: OrganisationRecord[],
  options: { countryCode?: string | null; role?: string } = {},
): OrganisationResolution {
  const key = normaliseName(raw);
  if (!key) return { input: raw, state: 'unresolved', resolved: null, candidates: [] };

  const scoped = organisations.filter((organisation) => {
    if (options.role && !organisation.roles.includes(options.role)) return false;
    if (
      options.countryCode &&
      organisation.countryCode &&
      organisation.countryCode.toUpperCase() !== options.countryCode.toUpperCase()
    ) {
      return false;
    }
    return true;
  });

  const candidates: OrganisationMatch[] = [];

  for (const organisation of scoped) {
    if (normaliseName(organisation.name) === key) {
      candidates.push({
        organisation,
        via: 'name',
        aliasKind: null,
        evidence: `Name matches “${organisation.name}”`,
      });
      continue;
    }
    if (organisation.legalName && normaliseName(organisation.legalName) === key) {
      candidates.push({
        organisation,
        via: 'legal_name',
        aliasKind: null,
        evidence: `Registered as “${organisation.legalName}”`,
      });
      continue;
    }
    const alias = (organisation.aliases ?? [])
      .filter(usableAlias)
      .find((entry) => normaliseName(entry.value) === key);
    if (alias) {
      candidates.push({
        organisation,
        via: 'alias',
        aliasKind: alias.kind,
        evidence: `“${alias.value}” is a ${alias.kind.replace(/_/g, ' ')} of “${organisation.name}”`,
      });
    }
  }

  const distinct = new Set(candidates.map((candidate) => candidate.organisation.id));

  if (distinct.size === 1) {
    return { input: raw, state: 'resolved', resolved: candidates[0]!, candidates };
  }
  if (distinct.size > 1) {
    return { input: raw, state: 'ambiguous', resolved: null, candidates };
  }
  return { input: raw, state: 'unresolved', resolved: null, candidates };
}

// ---------------------------------------------------------------------------
// Receipt evidence
// ---------------------------------------------------------------------------

/**
 * What a receipt says besides the product.
 *
 * Israeli receipts routinely carry the importer's name, an official-import
 * sticker line, or the retailer's own warranty wording — and any of those
 * narrows the answer more than a model number does. A grey import and an
 * official one are the same television with different terms, and this is the
 * only thing on the page that tells them apart.
 *
 * Every field is optional and every field is *evidence*, not a conclusion.
 */
export type ReceiptEvidence = {
  retailerName?: string | null;
  importerName?: string | null;
  warrantyProviderName?: string | null;
  serviceProviderName?: string | null;
  /** Free text such as "יבואן רשמי" — recorded, never parsed for meaning. */
  warrantyText?: string | null;
  serialNumber?: string | null;
};

export type ReceiptSignal = {
  field: keyof ReceiptEvidence;
  raw: string;
  organisationId: string | null;
  state: OrganisationResolution['state'];
  evidence: string;
};

/**
 * Resolves the company names a receipt mentions.
 *
 * Each one is looked up independently and reported with what happened. A name
 * that resolves to nothing is not an error — most receipts name a shop we have
 * never recorded — it is simply a signal we do not have.
 */
export function readReceiptEvidence(
  evidence: ReceiptEvidence,
  organisations: OrganisationRecord[],
  options: { countryCode?: string | null } = {},
): ReceiptSignal[] {
  const fields: (keyof ReceiptEvidence)[] = [
    'importerName',
    'warrantyProviderName',
    'serviceProviderName',
    'retailerName',
  ];

  const signals: ReceiptSignal[] = [];

  for (const field of fields) {
    const raw = evidence[field];
    if (!raw) continue;
    const resolution = resolveOrganisation(String(raw), organisations, options);
    signals.push({
      field,
      raw: String(raw),
      organisationId: resolution.resolved?.organisation.id ?? null,
      state: resolution.state,
      evidence:
        resolution.resolved?.evidence ??
        (resolution.state === 'ambiguous'
          ? `“${raw}” matches ${new Set(resolution.candidates.map((c) => c.organisation.id)).size} companies`
          : `“${raw}” is not a company we have recorded`),
    });
  }

  return signals;
}

/**
 * Whether two importer claims disagree.
 *
 * A receipt naming one importer while the resolved policy names another is not
 * a tie to be broken — it usually means the product was imported outside the
 * official channel, which is precisely the case where the official importer's
 * terms do not apply.
 */
export function importerConflict(
  receiptImporterId: string | null,
  policyImporterId: string | null,
): boolean {
  return (
    receiptImporterId !== null &&
    policyImporterId !== null &&
    receiptImporterId !== policyImporterId
  );
}

// ---------------------------------------------------------------------------
// Serial numbers
// ---------------------------------------------------------------------------

export type SerialRule =
  | { kind: 'prefix'; value: string }
  | { kind: 'pattern'; value: string }
  | { kind: 'range'; from: string; to: string };

/**
 * Whether a serial falls under a rule.
 *
 * Ranges compare as text in the manufacturer's own ordering, because that is
 * what a manufacturer's range means — serials are not numbers and treating them
 * as numbers reorders them.
 *
 * There is deliberately no inference here. A serial that matches no rule tells
 * you nothing unless rules exist; with no rules recorded, serial applicability
 * is simply unknown.
 */
export function serialMatches(serial: string, rule: SerialRule): boolean {
  const value = serial.trim().toUpperCase();
  if (!value) return false;

  if (rule.kind === 'prefix') return value.startsWith(rule.value.trim().toUpperCase());
  if (rule.kind === 'range') {
    const from = rule.from.trim().toUpperCase();
    const to = rule.to.trim().toUpperCase();
    return value >= from && value <= to;
  }

  const escaped = rule.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/%/g, '.*').replace(/_/g, '.')}$`, 'i').test(value);
}

/** `unknown` when the policy states no serial rules at all. */
export function serialApplicability(
  serial: string | null,
  rules: SerialRule[],
): 'in_scope' | 'out_of_scope' | 'unknown' {
  if (rules.length === 0) return 'unknown';
  if (!serial) return 'unknown';
  return rules.some((rule) => serialMatches(serial, rule)) ? 'in_scope' : 'out_of_scope';
}
