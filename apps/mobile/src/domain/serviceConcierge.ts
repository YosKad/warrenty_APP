import type { VerificationState } from './warrantyIntelligence';
import type { WarrantySource } from './warranty';

/**
 * Service concierge.
 *
 * Turns a provider chain, a pile of contact methods and a set of capabilities
 * into one recommended next step. Deterministic throughout — no model decides
 * which number a person should ring, because the failure mode is someone
 * spending an afternoon on a spare-parts line.
 *
 * Three rules:
 *
 *   1. Purpose beats channel. A warranty-claims web form outranks a general
 *      phone number, and the spare-parts line never wins anything.
 *   2. The correct centre beats the closest centre. Compatibility filters before
 *      distance ranks, so the branch two streets away that only handles phones
 *      is never offered for a television.
 *   3. Unknown stays unknown. A capability we have not confirmed renders as
 *      "availability not confirmed", never as unavailable, and never as a
 *      cheerful tick.
 */

// --------------------------------------------------------------------------
// Provider chain
// --------------------------------------------------------------------------

export type ServiceRole =
  | 'manufacturer'
  | 'importer'
  | 'retailer'
  | 'warranty_provider'
  | 'service_provider';

export type RouteOrganisation = {
  role: ServiceRole;
  organisationId: string;
  name: string;
  legalName: string | null;
  countryCode: string | null;
  website: string | null;
  isVerified: boolean;
};

/** One company, with every role it plays. */
export type ChainNode = {
  organisationId: string;
  name: string;
  legalName: string | null;
  website: string | null;
  roles: ServiceRole[];
  isVerified: boolean;
};

const ROLE_ORDER: ServiceRole[] = [
  'manufacturer',
  'importer',
  'retailer',
  'warranty_provider',
  'service_provider',
];

/**
 * Collapses the chain so one company appears once.
 *
 * Samline is the importer *and* the warranty provider. Printing it twice makes
 * a three-company chain look like a five-company bureaucracy, which is the
 * opposite of what this screen is for. Order is preserved by first appearance,
 * so the chain still reads manufacturer → importer → repairer.
 */
export function collapseChain(links: RouteOrganisation[]): ChainNode[] {
  const byOrg = new Map<string, ChainNode>();

  for (const role of ROLE_ORDER) {
    for (const link of links.filter((l) => l.role === role)) {
      const existing = byOrg.get(link.organisationId);
      if (existing) {
        if (!existing.roles.includes(role)) existing.roles.push(role);
        continue;
      }
      byOrg.set(link.organisationId, {
        organisationId: link.organisationId,
        name: link.name,
        legalName: link.legalName,
        website: link.website,
        roles: [role],
        isVerified: link.isVerified,
      });
    }
  }

  return [...byOrg.values()];
}

/** Whoever actually repairs the thing: the repairer, else who honours cover. */
export function responsibleForRepair(chain: ChainNode[]): ChainNode | null {
  return (
    chain.find((n) => n.roles.includes('service_provider')) ??
    chain.find((n) => n.roles.includes('warranty_provider')) ??
    chain.find((n) => n.roles.includes('importer')) ??
    null
  );
}

/** Whoever owes the warranty, which is not always whoever repairs it. */
export function responsibleForWarranty(chain: ChainNode[]): ChainNode | null {
  return (
    chain.find((n) => n.roles.includes('warranty_provider')) ??
    chain.find((n) => n.roles.includes('importer')) ??
    chain.find((n) => n.roles.includes('manufacturer')) ??
    null
  );
}

// --------------------------------------------------------------------------
// Contact methods
// --------------------------------------------------------------------------

export type ContactKind =
  | 'phone'
  | 'whatsapp'
  | 'email'
  | 'web_form'
  | 'website'
  | 'chat'
  | 'sms'
  | 'address';

export type ContactPurpose =
  | 'warranty_claims'
  | 'technical_support'
  | 'customer_service'
  | 'spare_parts'
  | 'appointments'
  | 'sales'
  | 'general'
  | 'unknown';

export type OpeningHours = Partial<
  Record<'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat', [string, string]>
>;

export type ContactMethod = {
  id: string;
  organisationId: string;
  kind: ContactKind;
  purpose: ContactPurpose;
  value: string;
  label: string | null;
  languageCodes: string[];
  countryCode: string | null;
  hours: OpeningHours | null;
  hoursNote: string | null;
  priority: number;
  source: WarrantySource;
  verification: VerificationState;
  verifiedAt: string | null;
  sourceUrl: string | null;
};

/**
 * What the channel is *for*, weighted an order of magnitude above what the
 * channel *is*. A warranty-claims web form beats a general phone line because
 * the form reaches the department that can help and the line reaches a menu.
 */
const PURPOSE_RANK: Record<ContactPurpose, number> = {
  warranty_claims: 0,
  appointments: 1,
  technical_support: 2,
  customer_service: 3,
  general: 4,
  unknown: 5,
  spare_parts: 8,
  sales: 9,
};

/**
 * Channel preference within a purpose, ordered by how likely it is to reach a
 * person who can act. A form is a tracked request; WhatsApp gets answered; a
 * phone works but costs the user their afternoon; a website is a last resort.
 */
const KIND_RANK: Record<ContactKind, number> = {
  web_form: 0,
  whatsapp: 1,
  phone: 2,
  email: 3,
  chat: 4,
  sms: 5,
  website: 6,
  address: 7,
};

export function contactScore(contact: ContactMethod): number {
  return PURPOSE_RANK[contact.purpose] * 10 + KIND_RANK[contact.kind];
}

/**
 * Best channels first.
 *
 * Ties break on freshness, then on the curated `priority` column, so a provider
 * who tells us which line to use first is obeyed within its purpose band.
 */
export function rankContacts(contacts: ContactMethod[]): ContactMethod[] {
  return [...contacts].sort((a, b) => {
    const byScore = contactScore(a) - contactScore(b);
    if (byScore !== 0) return byScore;
    const byFresh = FRESHNESS_RANK[freshness(a.verifiedAt, a.verification)] -
      FRESHNESS_RANK[freshness(b.verifiedAt, b.verification)];
    if (byFresh !== 0) return byFresh;
    return a.priority - b.priority;
  });
}

/** Channels that must never be recommended for a warranty repair. */
export function isServiceable(contact: ContactMethod): boolean {
  return contact.purpose !== 'spare_parts' && contact.purpose !== 'sales';
}

// --------------------------------------------------------------------------
// Freshness
// --------------------------------------------------------------------------

export type Freshness = 'recent' | 'verified' | 'recheck' | 'stale' | 'unknown';

const FRESHNESS_RANK: Record<Freshness, number> = {
  recent: 0,
  verified: 1,
  unknown: 2,
  recheck: 3,
  stale: 4,
};

export const FRESH_RECENT_DAYS = 90;
export const FRESH_OK_DAYS = 270;
export const FRESH_STALE_DAYS = 540;

/**
 * How much a contact detail should be trusted on age alone.
 *
 * Phone numbers and branches change. Silently relying on a number verified two
 * years ago is how a user ends up ringing a disconnected line and blaming the
 * app — so age becomes a visible state rather than an invisible risk. Never
 * verified reads as `unknown`, which is honest: we have not checked, rather
 * than we checked and it was fine.
 */
export function freshness(
  verifiedAt: string | null,
  verification: VerificationState = 'unverified',
  now: Date = new Date(),
): Freshness {
  if (!verifiedAt) return 'unknown';
  const days = (now.getTime() - new Date(verifiedAt).getTime()) / 86_400_000;
  if (days < 0) return 'unknown';
  if (days <= FRESH_RECENT_DAYS) {
    return verification === 'official' || verification === 'verified' ? 'recent' : 'verified';
  }
  if (days <= FRESH_OK_DAYS) return 'verified';
  if (days <= FRESH_STALE_DAYS) return 'recheck';
  return 'stale';
}

// --------------------------------------------------------------------------
// Capabilities
// --------------------------------------------------------------------------

export type CapabilityKind =
  | 'home_visit'
  | 'home_technician'
  | 'pickup'
  | 'courier'
  | 'mail_in'
  | 'walk_in'
  | 'drop_off'
  | 'phone_support'
  | 'phone_diagnostics'
  | 'online_support'
  | 'remote_support'
  | 'on_site_repair'
  | 'appointment_required'
  | 'replacement_center'
  | 'spare_parts';

export type Availability = 'available' | 'unavailable' | 'unknown';

export type ServiceCapability = {
  id: string;
  organisationId: string;
  kind: CapabilityKind;
  availability: Availability;
  countryCode: string | null;
  region: string | null;
  typicalLeadTimeDays: number | null;
  feeNote: string | null;
  verification: VerificationState;
  verifiedAt: string | null;
};

/** `home_visit` and `home_technician` mean the same thing; so do pickup/courier. */
const CAPABILITY_SYNONYMS: Partial<Record<CapabilityKind, CapabilityKind>> = {
  home_visit: 'home_technician',
  pickup: 'courier',
  phone_support: 'phone_diagnostics',
  online_support: 'remote_support',
  walk_in: 'drop_off',
};

export function normaliseCapability(kind: CapabilityKind): CapabilityKind {
  return CAPABILITY_SYNONYMS[kind] ?? kind;
}

export function capabilityState(
  capabilities: ServiceCapability[],
  kind: CapabilityKind,
): Availability {
  const target = normaliseCapability(kind);
  const matches = capabilities.filter((c) => normaliseCapability(c.kind) === target);
  if (matches.length === 0) return 'unknown';
  // A confirmed yes anywhere in the chain beats a no elsewhere: one branch not
  // doing home visits does not mean the network does not.
  if (matches.some((c) => c.availability === 'available')) return 'available';
  if (matches.some((c) => c.availability === 'unavailable')) return 'unavailable';
  return 'unknown';
}

// --------------------------------------------------------------------------
// The recommendation
// --------------------------------------------------------------------------

export type RecommendedRoute =
  | 'book_technician'
  | 'request_pickup'
  | 'mail_in'
  | 'visit_centre'
  | 'contact'
  | 'none';

export type Recommendation = {
  route: RecommendedRoute;
  /** The channel to actually use. Null only when nothing usable exists. */
  contact: ContactMethod | null;
  /** Set when the route is defined by a capability rather than a channel. */
  capability: CapabilityKind | null;
  /** Set for `visit_centre`. */
  needsLocation: boolean;
};

/**
 * One recommended action, chosen by rule.
 *
 * The order encodes how much work each route costs the *user*, not us: a
 * technician coming to them beats a courier collecting, which beats posting it
 * themselves, which beats carrying a 65-inch television across town.
 */
export function recommendRoute(input: {
  contacts: ContactMethod[];
  capabilities: ServiceCapability[];
  hasCompatibleLocation: boolean;
}): Recommendation {
  const usable = rankContacts(input.contacts.filter(isServiceable));
  const best = usable[0] ?? null;

  const homeVisit = capabilityState(input.capabilities, 'home_technician');
  const courier = capabilityState(input.capabilities, 'courier');
  const mailIn = capabilityState(input.capabilities, 'mail_in');
  const dropOff = capabilityState(input.capabilities, 'drop_off');

  if (homeVisit === 'available') {
    return { route: 'book_technician', contact: best, capability: 'home_technician', needsLocation: false };
  }
  if (courier === 'available') {
    return { route: 'request_pickup', contact: best, capability: 'courier', needsLocation: false };
  }
  if (mailIn === 'available') {
    return { route: 'mail_in', contact: best, capability: 'mail_in', needsLocation: false };
  }
  if (dropOff === 'available' && input.hasCompatibleLocation) {
    return { route: 'visit_centre', contact: best, capability: 'drop_off', needsLocation: true };
  }
  if (best) {
    return { route: 'contact', contact: best, capability: null, needsLocation: false };
  }
  // Nothing to recommend is a real answer. The alternative — a generic support
  // number for the manufacturer's head office — wastes the user's time and
  // teaches them not to trust the next recommendation either.
  return { route: 'none', contact: null, capability: null, needsLocation: false };
}

// --------------------------------------------------------------------------
// Locations
// --------------------------------------------------------------------------

export type ServiceLocation = {
  id: string;
  organisationId: string;
  name: string | null;
  city: string | null;
  region: string | null;
  addressLine: string | null;
  postalCode: string | null;
  countryCode: string;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  openingHours: OpeningHours | null;
  timeZone: string | null;
  appointmentRequired: boolean | null;
  verification: VerificationState;
  verifiedAt: string | null;
};

export type Coordinates = { latitude: number; longitude: number };

export function distanceKm(origin: Coordinates, target: ServiceLocation): number | null {
  if (target.latitude === null || target.longitude === null) return null;
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(target.latitude - origin.latitude);
  const dLon = toRad(target.longitude - origin.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(origin.latitude)) *
      Math.cos(toRad(target.latitude)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Ranks locations that are already known to be compatible.
 *
 * With no origin — which is the default, because location permission is never
 * required — the order falls back to the user's own region first, then city,
 * then whatever remains. That is usually good enough: people know where their
 * own city is.
 */
export function rankLocations(
  locations: ServiceLocation[],
  origin: Coordinates | null,
  fallback?: { region?: string | null; city?: string | null },
): ServiceLocation[] {
  if (origin) {
    return [...locations].sort((a, b) => {
      const da = distanceKm(origin, a);
      const db = distanceKm(origin, b);
      if (da === null) return db === null ? 0 : 1;
      if (db === null) return -1;
      return da - db;
    });
  }

  const region = fallback?.region?.toLowerCase();
  const city = fallback?.city?.toLowerCase();
  const score = (l: ServiceLocation) => {
    if (city && l.city?.toLowerCase() === city) return 0;
    if (region && l.region?.toLowerCase() === region) return 1;
    return 2;
  };
  return [...locations].sort((a, b) => score(a) - score(b));
}

// --------------------------------------------------------------------------
// Opening hours
// --------------------------------------------------------------------------

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export type OpeningStatus =
  | { state: 'open'; closesAt: string }
  | { state: 'closed'; opensDay: DayKey; opensAt: string }
  | { state: 'closed_today' }
  | { state: 'unknown' };

/**
 * Whether a branch is open, in its own timezone.
 *
 * Deliberately returns `unknown` rather than "closed" when hours are missing.
 * "Closed" is a claim; not knowing is a fact, and telling someone a branch is
 * shut when it is open is worse than telling them to phone ahead.
 */
export function openingStatus(
  hours: OpeningHours | null,
  now: Date = new Date(),
  timeZone?: string | null,
): OpeningStatus {
  if (!hours || Object.keys(hours).length === 0) return { state: 'unknown' };

  const local = localParts(now, timeZone);
  const todayKey = DAY_KEYS[local.weekday];
  const today = todayKey ? hours[todayKey] : undefined;

  if (today) {
    const [open, close] = today;
    if (local.minutes >= toMinutes(open) && local.minutes < toMinutes(close)) {
      return { state: 'open', closesAt: close };
    }
    if (local.minutes < toMinutes(open)) {
      return { state: 'closed', opensDay: todayKey as DayKey, opensAt: open };
    }
  }

  // Walk forward for the next day with hours. Seven steps covers the week; a
  // provider with no hours at all was already handled above.
  for (let step = 1; step <= 7; step += 1) {
    const key = DAY_KEYS[(local.weekday + step) % 7];
    const slot = key ? hours[key] : undefined;
    if (slot && key) return { state: 'closed', opensDay: key, opensAt: slot[0] };
  }

  return { state: 'closed_today' };
}

function toMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Weekday and minute-of-day in the branch's zone, not the device's. */
function localParts(now: Date, timeZone?: string | null): { weekday: number; minutes: number } {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone ?? undefined,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const weekdayName = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    const index = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekdayName);
    return { weekday: index < 0 ? 0 : index, minutes: hour * 60 + minute };
  } catch {
    return { weekday: now.getUTCDay(), minutes: now.getUTCHours() * 60 + now.getUTCMinutes() };
  }
}

// --------------------------------------------------------------------------
// Service readiness
// --------------------------------------------------------------------------

export type ReadinessItem = {
  key:
    | 'proof_of_purchase'
    | 'serial_number'
    | 'model'
    | 'warranty_document'
    | 'issue_description'
    | 'issue_photo';
  ready: boolean;
  /** True when the provider's own clauses demand it. */
  required: boolean;
};

export type ServiceReadiness = {
  items: ReadinessItem[];
  readyCount: number;
  total: number;
  /** Required items still missing — the ones that will stop a claim. */
  blocking: ReadinessItem[];
};

/**
 * What to have in hand before contacting service.
 *
 * Deliberately not another score out of a hundred. "4 of 5 ready, missing the
 * serial number" is something a person can finish in a minute; a percentage is
 * something they can only feel bad about.
 *
 * `required` comes from the policy's own claim-requirement clauses where we have
 * them, so "you need the receipt" is the warranty talking, not us.
 */
export function serviceReadiness(input: {
  hasProofDocument: boolean;
  serialNumber: string | null;
  model: string | null;
  hasWarrantyDocument: boolean;
  issueDescription: string | null;
  photoCount: number;
  /** Requirement keys derived from claim_requirement clauses. */
  requiredKeys?: ReadinessItem['key'][];
}): ServiceReadiness {
  const required = new Set(input.requiredKeys ?? ['proof_of_purchase', 'issue_description']);

  const items: ReadinessItem[] = [
    {
      key: 'proof_of_purchase',
      ready: input.hasProofDocument,
      required: required.has('proof_of_purchase'),
    },
    {
      key: 'serial_number',
      ready: nonEmpty(input.serialNumber),
      required: required.has('serial_number'),
    },
    { key: 'model', ready: nonEmpty(input.model), required: required.has('model') },
    {
      key: 'warranty_document',
      ready: input.hasWarrantyDocument,
      required: required.has('warranty_document'),
    },
    {
      key: 'issue_description',
      ready: nonEmpty(input.issueDescription),
      required: required.has('issue_description'),
    },
    // Never required. A photo helps a technician and helps a claim, but no
    // warranty makes it a condition, and marking it required would manufacture
    // an obstacle out of a nicety.
    { key: 'issue_photo', ready: input.photoCount > 0, required: false },
  ];

  return {
    items,
    readyCount: items.filter((i) => i.ready).length,
    total: items.length,
    blocking: items.filter((i) => i.required && !i.ready),
  };
}

function nonEmpty(value: string | null): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

// --------------------------------------------------------------------------
// Prepared request
// --------------------------------------------------------------------------

export type ServiceRequestInput = {
  productName: string;
  brandName: string | null;
  model: string | null;
  serialNumber: string | null;
  purchaseDate: string | null;
  warrantyEnd: string | null;
  issueDescription: string | null;
  coverageVerdict: string | null;
  /** One clause reference, when the assessment cited one. */
  clauseReference: string | null;
  providerName: string | null;
  labels: Record<string, string>;
};

/**
 * The message the user sends.
 *
 * Assembled from what we already know so nobody retypes their own serial number
 * into a WhatsApp box. Facts only — the coverage verdict is included as *the
 * app's assessment*, never as a claim that the provider is obliged to honour,
 * because a message that opens by telling a service desk what they owe you is a
 * message that gets a worse answer.
 *
 * Returned as text for the user to edit. Nothing is ever sent automatically.
 */
export function buildServiceRequest(input: ServiceRequestInput): string {
  const l = input.labels;
  const lines: string[] = [];

  if (input.providerName) lines.push(`${l.greeting ?? 'Hello'} ${input.providerName},`, '');
  lines.push(l.intro ?? 'I would like to request warranty service for the following product.');
  lines.push('');

  const fact = (label: string | undefined, value: string | null) => {
    if (label && value) lines.push(`${label}: ${value}`);
  };

  fact(l.product, productLabel(input.brandName, input.productName));
  fact(l.model, input.model);
  fact(l.serial, input.serialNumber);
  fact(l.purchased, input.purchaseDate);
  fact(l.warrantyUntil, input.warrantyEnd);

  if (input.issueDescription) {
    lines.push('', `${l.issue ?? 'Issue'}:`, input.issueDescription);
  }

  if (input.coverageVerdict) {
    lines.push('', `${l.assessment ?? 'App assessment'}: ${input.coverageVerdict}`);
    if (input.clauseReference) {
      lines.push(`${l.clause ?? 'Referenced clause'}: ${input.clauseReference}`);
    }
  }

  lines.push('', l.closing ?? 'Please let me know how to proceed. Thank you.');
  return lines.join('\n');
}

/**
 * "Samsung OLED S95D", not "Samsung Samsung OLED S95D".
 *
 * Most people name a product with its brand already in it. Prefixing blindly
 * produces a message that reads as generated, which is the last thing a service
 * request should look like.
 */
function productLabel(brandName: string | null, productName: string): string {
  if (!brandName) return productName;
  const alreadyNamed = productName.toLowerCase().includes(brandName.toLowerCase());
  return alreadyNamed ? productName : `${brandName} ${productName}`;
}

// --------------------------------------------------------------------------
// Deep links
// --------------------------------------------------------------------------

/** E.164-ish, for `tel:` and WhatsApp. Israeli local numbers get their prefix. */
export function toDialable(value: string, defaultCountry = 'IL'): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('+')) return `+${trimmed.slice(1).replace(/[^\d]/g, '')}`;
  const digits = trimmed.replace(/[^\d]/g, '');
  if (defaultCountry === 'IL' && digits.startsWith('0')) return `+972${digits.slice(1)}`;
  return digits;
}

export type MapProvider = 'apple' | 'google' | 'waze';

/**
 * A map URL per provider. Which of these a device can actually open is a
 * question for the platform, not for us — hard-coding one provider is how an
 * app ends up sending an Android user to Apple Maps.
 */
export function mapUrl(
  provider: MapProvider,
  location: Pick<ServiceLocation, 'latitude' | 'longitude' | 'addressLine' | 'city' | 'name'>,
): string {
  const hasCoords = location.latitude !== null && location.longitude !== null;
  const coords = hasCoords ? `${location.latitude},${location.longitude}` : '';
  const query = encodeURIComponent(
    [location.name, location.addressLine, location.city].filter(Boolean).join(', '),
  );

  switch (provider) {
    case 'apple':
      return hasCoords
        ? `http://maps.apple.com/?daddr=${coords}`
        : `http://maps.apple.com/?daddr=${query}`;
    case 'google':
      return hasCoords
        ? `https://www.google.com/maps/dir/?api=1&destination=${coords}`
        : `https://www.google.com/maps/dir/?api=1&destination=${query}`;
    case 'waze':
      return hasCoords
        ? `https://waze.com/ul?ll=${coords}&navigate=yes`
        : `https://waze.com/ul?q=${query}&navigate=yes`;
    default:
      return '';
  }
}

/** WhatsApp with a pre-filled, still-editable message. Never auto-sends. */
export function whatsappUrl(phone: string, message: string): string {
  const number = toDialable(phone).replace(/^\+/, '');
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

export function mailtoUrl(address: string, subject: string, body: string): string {
  return `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
