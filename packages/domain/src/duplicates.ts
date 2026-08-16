import { normaliseName, normalisePhone, normaliseUrl } from './normalise';

/**
 * Duplicate detection.
 *
 * Everything here scores and explains; nothing here merges. Automatic merging
 * of records that came from different sources is how an importer quietly
 * destroys the more careful of two entries, and once the losing row is gone
 * there is no way to find out it was the right one. So a duplicate becomes a
 * queue item with a reason attached, and a person decides.
 */

export type DuplicateVerdict = 'distinct' | 'possible' | 'likely';

export type DuplicateSignal = {
  key: string;
  weight: number;
  /** Shown in the review queue so the reviewer sees why, not just how much. */
  detail: string;
};

export type DuplicateMatch<T> = {
  candidate: T;
  score: number;
  verdict: DuplicateVerdict;
  signals: DuplicateSignal[];
};

export const DUPLICATE_LIKELY_THRESHOLD = 70;
export const DUPLICATE_POSSIBLE_THRESHOLD = 40;

export function verdictFor(score: number): DuplicateVerdict {
  if (score >= DUPLICATE_LIKELY_THRESHOLD) return 'likely';
  if (score >= DUPLICATE_POSSIBLE_THRESHOLD) return 'possible';
  return 'distinct';
}

/**
 * Word-overlap similarity, 0–1.
 *
 * Token-based rather than character-based on purpose: "Samsung Electronics
 * Israel" and "Samsung Israel Electronics" are the same company, while
 * "Samline" and "Sameline" are two different ones despite sharing most of their
 * characters. Word order carries no weight; word identity carries all of it.
 */
export function tokenSimilarity(a: string, b: string): number {
  const left = new Set(a.split(' ').filter(Boolean));
  const right = new Set(b.split(' ').filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

export type OrganisationLike = {
  id?: string;
  name: string;
  legalName?: string | null;
  countryCode?: string | null;
  website?: string | null;
  phone?: string | null;
  registrationNumber?: string | null;
};

/**
 * Scores two organisations as the same company.
 *
 * A registration number is decisive on its own — it is the one identifier the
 * state guarantees unique. Everything else accumulates, because no single soft
 * signal should be able to declare a duplicate: two importers in the same
 * country with similar names is an ordinary situation in a small market.
 */
export function scoreOrganisationDuplicate(
  a: OrganisationLike,
  b: OrganisationLike,
): { score: number; signals: DuplicateSignal[] } {
  const signals: DuplicateSignal[] = [];

  if (a.registrationNumber && b.registrationNumber) {
    if (a.registrationNumber.replace(/\D/g, '') === b.registrationNumber.replace(/\D/g, '')) {
      return {
        score: 100,
        signals: [
          {
            key: 'registration_number',
            weight: 100,
            detail: `Both registered as ${a.registrationNumber}`,
          },
        ],
      };
    }
    // Two different registration numbers is positive evidence of *distinctness*,
    // strong enough to overrule name similarity entirely.
    return {
      score: 0,
      signals: [
        {
          key: 'registration_number_differs',
          weight: 0,
          detail: `Different company registrations (${a.registrationNumber} vs ${b.registrationNumber})`,
        },
      ],
    };
  }

  const nameA = normaliseName(a.name);
  const nameB = normaliseName(b.name);
  const legalA = normaliseName(a.legalName ?? '');
  const legalB = normaliseName(b.legalName ?? '');

  if (nameA && nameA === nameB) {
    signals.push({ key: 'name_exact', weight: 55, detail: `Same name: ${a.name}` });
  } else if (legalA && (legalA === nameB || legalA === legalB || nameA === legalB)) {
    signals.push({
      key: 'legal_name_match',
      weight: 50,
      detail: 'One record’s legal name is the other’s trading name',
    });
  } else {
    // Scaled into the same band as an exact name match, so "Samsung Israel"
    // against "Samsung Electronics Israel" reaches a reviewer rather than
    // falling a couple of points short of one. Half-overlap on its own still
    // does not: in a small market, two importers sharing a word is ordinary.
    const similarity = tokenSimilarity(nameA, nameB);
    if (similarity >= 0.5) {
      signals.push({
        key: 'name_similar',
        weight: Math.round(similarity * 55),
        detail: `Names overlap: “${a.name}” / “${b.name}”`,
      });
    }
  }

  const phoneA = normalisePhone(a.phone, a.countryCode ?? 'IL');
  const phoneB = normalisePhone(b.phone, b.countryCode ?? 'IL');
  if (phoneA && phoneA === phoneB) {
    signals.push({ key: 'phone', weight: 25, detail: `Same phone number: ${phoneA}` });
  }

  const siteA = normaliseUrl(a.website);
  const siteB = normaliseUrl(b.website);
  if (siteA && siteB) {
    if (siteA === siteB) {
      signals.push({ key: 'website', weight: 25, detail: `Same website: ${siteA}` });
    } else if (hostOf(siteA) === hostOf(siteB)) {
      signals.push({ key: 'website_host', weight: 15, detail: `Same domain: ${hostOf(siteA)}` });
    }
  }

  // Country agreement is corroboration, never evidence on its own — which is
  // why it only counts when something else already fired.
  if (
    signals.length > 0 &&
    a.countryCode &&
    b.countryCode &&
    a.countryCode.toUpperCase() === b.countryCode.toUpperCase()
  ) {
    signals.push({ key: 'country', weight: 10, detail: `Both in ${a.countryCode}` });
  }

  const score = Math.min(
    100,
    signals.reduce((sum, signal) => sum + signal.weight, 0),
  );
  return { score, signals };
}

function hostOf(normalisedUrl: string): string {
  return normalisedUrl.split('/')[0] ?? normalisedUrl;
}

export type LocationLike = {
  id?: string;
  name?: string | null;
  addressLine?: string | null;
  city?: string | null;
  phone?: string | null;
  countryCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

/**
 * Scores two service locations as the same branch.
 *
 * Proximity is the strongest signal available, because two branches of the same
 * network are never in the same building — but it is only usable when both
 * records actually carry coordinates, which in imported data is often neither.
 */
export function scoreLocationDuplicate(
  a: LocationLike,
  b: LocationLike,
): { score: number; signals: DuplicateSignal[] } {
  const signals: DuplicateSignal[] = [];

  const metres = distanceMetres(a, b);
  if (metres !== null && metres <= 100) {
    signals.push({
      key: 'coordinates',
      weight: 55,
      detail: `Coordinates ${Math.round(metres)} m apart`,
    });
  }

  const addressA = normaliseName(`${a.addressLine ?? ''} ${a.city ?? ''}`);
  const addressB = normaliseName(`${b.addressLine ?? ''} ${b.city ?? ''}`);
  if (addressA && addressA === addressB) {
    signals.push({ key: 'address_exact', weight: 45, detail: 'Identical address' });
  } else {
    const similarity = tokenSimilarity(addressA, addressB);
    if (similarity >= 0.6) {
      signals.push({
        key: 'address_similar',
        weight: Math.round(similarity * 30),
        detail: `Addresses overlap: “${a.addressLine ?? ''}” / “${b.addressLine ?? ''}”`,
      });
    }
  }

  const phoneA = normalisePhone(a.phone, a.countryCode ?? 'IL');
  const phoneB = normalisePhone(b.phone, b.countryCode ?? 'IL');
  if (phoneA && phoneA === phoneB) {
    signals.push({ key: 'phone', weight: 25, detail: `Same phone number: ${phoneA}` });
  }

  const score = Math.min(
    100,
    signals.reduce((sum, signal) => sum + signal.weight, 0),
  );
  return { score, signals };
}

/** Straight-line metres, or null when either record has no coordinates. */
export function distanceMetres(a: LocationLike, b: LocationLike): number | null {
  if (
    a.latitude == null ||
    a.longitude == null ||
    b.latitude == null ||
    b.longitude == null
  ) {
    return null;
  }
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Finds the best existing match for an incoming record.
 *
 * Returns only what crosses the "possible" line, ranked. Below that the
 * importer creates a new record — a queue full of coincidences is a queue
 * nobody reads.
 */
export function findDuplicates<T>(
  incoming: T,
  existing: T[],
  score: (a: T, b: T) => { score: number; signals: DuplicateSignal[] },
  limit = 5,
): DuplicateMatch<T>[] {
  return existing
    .map((candidate) => {
      const result = score(incoming, candidate);
      return {
        candidate,
        score: result.score,
        verdict: verdictFor(result.score),
        signals: result.signals,
      };
    })
    .filter((match) => match.verdict !== 'distinct')
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
