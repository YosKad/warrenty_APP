import {
  FRESH_STALE_DAYS,
  buildServiceRequest,
  capabilityState,
  collapseChain,
  contactScore,
  distanceKm,
  freshness,
  isServiceable,
  mapUrl,
  mailtoUrl,
  openingStatus,
  rankContacts,
  rankLocations,
  recommendRoute,
  responsibleForRepair,
  responsibleForWarranty,
  serviceReadiness,
  toDialable,
  whatsappUrl,
  type ContactMethod,
  type RouteOrganisation,
  type ServiceCapability,
  type ServiceLocation,
} from '../serviceConcierge';

/**
 * Each of these is a way the concierge could waste somebody's afternoon: the
 * spare-parts line recommended for a repair, the nearest branch that cannot
 * touch the product, a two-year-old phone number presented as current, or a
 * "closed" claimed about a shop whose hours we simply do not have.
 */

const org = (over: Partial<RouteOrganisation>): RouteOrganisation => ({
  role: 'manufacturer',
  organisationId: 'o1',
  name: 'Samsung',
  legalName: null,
  countryCode: 'IL',
  website: null,
  isVerified: true,
  ...over,
});

const contact = (over: Partial<ContactMethod>): ContactMethod => ({
  id: 'c1',
  organisationId: 'o1',
  kind: 'phone',
  purpose: 'general',
  value: '03-5555000',
  label: null,
  languageCodes: [],
  countryCode: 'IL',
  hours: null,
  hoursNote: null,
  priority: 100,
  source: 'internal_db',
  verification: 'unverified',
  verifiedAt: null,
  sourceUrl: null,
  ...over,
});

const capability = (over: Partial<ServiceCapability>): ServiceCapability => ({
  id: 'k1',
  organisationId: 'o1',
  kind: 'home_technician',
  availability: 'available',
  countryCode: 'IL',
  region: null,
  typicalLeadTimeDays: null,
  feeNote: null,
  verification: 'unverified',
  verifiedAt: null,
  ...over,
});

const location = (over: Partial<ServiceLocation>): ServiceLocation => ({
  id: 'l1',
  organisationId: 'o1',
  name: 'Tel Aviv service centre',
  city: 'Tel Aviv',
  region: 'Tel Aviv',
  addressLine: 'רחוב הרכבת 58',
  postalCode: '6777016',
  countryCode: 'IL',
  phone: '03-5555101',
  latitude: 32.064,
  longitude: 34.78,
  openingHours: null,
  timeZone: 'Asia/Jerusalem',
  appointmentRequired: null,
  verification: 'unverified',
  verifiedAt: null,
  ...over,
});

describe('provider chain', () => {
  it('collapses one company holding several roles into one entry', () => {
    // Samline imports the television and honours its warranty. Printing it twice
    // makes a three-company chain look like a five-company bureaucracy.
    const chain = collapseChain([
      org({ role: 'manufacturer', organisationId: 'samsung', name: 'Samsung' }),
      org({ role: 'importer', organisationId: 'samline', name: 'Samline' }),
      org({ role: 'warranty_provider', organisationId: 'samline', name: 'Samline' }),
      org({ role: 'service_provider', organisationId: 'xyz', name: 'XYZ Service' }),
    ]);

    expect(chain).toHaveLength(3);
    expect(chain[1]?.name).toBe('Samline');
    expect(chain[1]?.roles).toEqual(['importer', 'warranty_provider']);
  });

  it('keeps manufacturer → importer → repairer order', () => {
    const chain = collapseChain([
      org({ role: 'service_provider', organisationId: 'xyz', name: 'XYZ' }),
      org({ role: 'manufacturer', organisationId: 'samsung', name: 'Samsung' }),
      org({ role: 'importer', organisationId: 'samline', name: 'Samline' }),
    ]);
    expect(chain.map((n) => n.name)).toEqual(['Samsung', 'Samline', 'XYZ']);
  });

  it('handles a single company filling every role', () => {
    // iDigital is importer, retailer, warranty provider and repairer at once.
    const chain = collapseChain([
      org({ role: 'importer', organisationId: 'idigital', name: 'iDigital' }),
      org({ role: 'retailer', organisationId: 'idigital', name: 'iDigital' }),
      org({ role: 'warranty_provider', organisationId: 'idigital', name: 'iDigital' }),
      org({ role: 'service_provider', organisationId: 'idigital', name: 'iDigital' }),
    ]);
    expect(chain).toHaveLength(1);
    expect(chain[0]?.roles).toHaveLength(4);
  });

  it('names the repairer and the warranty holder separately', () => {
    const chain = collapseChain([
      org({ role: 'manufacturer', organisationId: 'samsung', name: 'Samsung' }),
      org({ role: 'warranty_provider', organisationId: 'samline', name: 'Samline' }),
      org({ role: 'service_provider', organisationId: 'xyz', name: 'XYZ Service' }),
    ]);
    expect(responsibleForWarranty(chain)?.name).toBe('Samline');
    expect(responsibleForRepair(chain)?.name).toBe('XYZ Service');
  });

  it('falls back through the chain when the repairer is unknown', () => {
    const chain = collapseChain([
      org({ role: 'manufacturer', organisationId: 'samsung', name: 'Samsung' }),
      org({ role: 'importer', organisationId: 'samline', name: 'Samline' }),
    ]);
    expect(responsibleForRepair(chain)?.name).toBe('Samline');
  });

  it('returns nothing rather than guessing when the chain is empty', () => {
    expect(responsibleForRepair([])).toBeNull();
    expect(responsibleForWarranty([])).toBeNull();
  });

  it('routes two identical products differently when the importer differs', () => {
    // The parallel-import case: same television, different chain.
    const official = collapseChain([
      org({ role: 'importer', organisationId: 'samline', name: 'Samline' }),
      org({ role: 'warranty_provider', organisationId: 'samline', name: 'Samline' }),
    ]);
    const parallel = collapseChain([
      org({ role: 'importer', organisationId: 'grey-co', name: 'Grey Importer' }),
      org({ role: 'warranty_provider', organisationId: 'grey-co', name: 'Grey Importer' }),
    ]);
    expect(responsibleForWarranty(official)?.name).not.toBe(
      responsibleForWarranty(parallel)?.name,
    );
  });
});

describe('contact ranking', () => {
  it('puts a warranty-claims form above a general phone line', () => {
    const ranked = rankContacts([
      contact({ id: 'general', kind: 'phone', purpose: 'customer_service' }),
      contact({ id: 'form', kind: 'web_form', purpose: 'warranty_claims' }),
    ]);
    expect(ranked[0]?.id).toBe('form');
  });

  it('orders the channels within a purpose: form, WhatsApp, phone, email', () => {
    const ranked = rankContacts([
      contact({ id: 'email', kind: 'email', purpose: 'warranty_claims' }),
      contact({ id: 'phone', kind: 'phone', purpose: 'warranty_claims' }),
      contact({ id: 'wa', kind: 'whatsapp', purpose: 'warranty_claims' }),
      contact({ id: 'form', kind: 'web_form', purpose: 'warranty_claims' }),
    ]);
    expect(ranked.map((c) => c.id)).toEqual(['form', 'wa', 'phone', 'email']);
  });

  it('ranks purpose above channel', () => {
    // A warranty-claims email beats a general web form, because reaching the
    // right department matters more than the shape of the channel.
    expect(contactScore(contact({ kind: 'email', purpose: 'warranty_claims' }))).toBeLessThan(
      contactScore(contact({ kind: 'web_form', purpose: 'general' })),
    );
  });

  it('never treats spare parts or sales as a service channel', () => {
    expect(isServiceable(contact({ purpose: 'spare_parts' }))).toBe(false);
    expect(isServiceable(contact({ purpose: 'sales' }))).toBe(false);
    expect(isServiceable(contact({ purpose: 'warranty_claims' }))).toBe(true);
  });

  it('breaks a tie on freshness before the curated priority', () => {
    const now = new Date('2026-08-14T00:00:00Z');
    const ranked = rankContacts([
      contact({ id: 'old', purpose: 'warranty_claims', priority: 1, verifiedAt: '2023-01-01T00:00:00Z' }),
      contact({
        id: 'fresh',
        purpose: 'warranty_claims',
        priority: 99,
        verifiedAt: new Date(now.getTime() - 5 * 86_400_000).toISOString(),
      }),
    ]);
    expect(ranked[0]?.id).toBe('fresh');
  });
});

describe('freshness', () => {
  const now = new Date('2026-08-14T00:00:00Z');
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

  it('reads a never-verified contact as unknown, not as fine', () => {
    expect(freshness(null, 'unverified', now)).toBe('unknown');
  });

  it('reads a recently verified official contact as recent', () => {
    expect(freshness(daysAgo(10), 'official', now)).toBe('recent');
  });

  it('does not call an unverified record "recent" however new it is', () => {
    expect(freshness(daysAgo(1), 'unverified', now)).toBe('verified');
  });

  it('escalates with age', () => {
    expect(freshness(daysAgo(200), 'official', now)).toBe('verified');
    expect(freshness(daysAgo(400), 'official', now)).toBe('recheck');
    expect(freshness(daysAgo(FRESH_STALE_DAYS + 10), 'official', now)).toBe('stale');
  });

  it('treats a future timestamp as unknown rather than fresh', () => {
    expect(freshness(daysAgo(-5), 'official', now)).toBe('unknown');
  });
});

describe('capabilities', () => {
  it('treats an uncatalogued capability as unknown, never as unavailable', () => {
    expect(capabilityState([], 'home_technician')).toBe('unknown');
  });

  it('treats home_visit and home_technician as the same thing', () => {
    expect(capabilityState([capability({ kind: 'home_visit' })], 'home_technician')).toBe(
      'available',
    );
  });

  it('lets one branch offering a service outweigh another not offering it', () => {
    const state = capabilityState(
      [
        capability({ id: 'a', kind: 'courier', availability: 'unavailable' }),
        capability({ id: 'b', kind: 'courier', availability: 'available' }),
      ],
      'courier',
    );
    expect(state).toBe('available');
  });

  it('reports a confirmed no as unavailable', () => {
    expect(
      capabilityState([capability({ kind: 'home_technician', availability: 'unavailable' })], 'home_technician'),
    ).toBe('unavailable');
  });
});

describe('recommendation', () => {
  const claimsForm = contact({ id: 'form', kind: 'web_form', purpose: 'warranty_claims' });

  it('recommends a technician when one can come to you', () => {
    const rec = recommendRoute({
      contacts: [claimsForm],
      capabilities: [capability({ kind: 'home_technician', availability: 'available' })],
      hasCompatibleLocation: true,
    });
    expect(rec.route).toBe('book_technician');
    expect(rec.contact?.id).toBe('form');
  });

  it('prefers a courier over making the user carry a television across town', () => {
    const rec = recommendRoute({
      contacts: [claimsForm],
      capabilities: [
        capability({ kind: 'home_technician', availability: 'unavailable' }),
        capability({ id: 'k2', kind: 'courier', availability: 'available' }),
        capability({ id: 'k3', kind: 'drop_off', availability: 'available' }),
      ],
      hasCompatibleLocation: true,
    });
    expect(rec.route).toBe('request_pickup');
  });

  it('falls to visiting a centre only when nothing comes to the user', () => {
    const rec = recommendRoute({
      contacts: [claimsForm],
      capabilities: [capability({ kind: 'drop_off', availability: 'available' })],
      hasCompatibleLocation: true,
    });
    expect(rec.route).toBe('visit_centre');
    expect(rec.needsLocation).toBe(true);
  });

  it('does not send a user to a centre when no compatible one exists', () => {
    const rec = recommendRoute({
      contacts: [claimsForm],
      capabilities: [capability({ kind: 'drop_off', availability: 'available' })],
      hasCompatibleLocation: false,
    });
    expect(rec.route).toBe('contact');
  });

  it('recommends the best channel when no capability is known', () => {
    const rec = recommendRoute({
      contacts: [contact({ id: 'p', purpose: 'warranty_claims' })],
      capabilities: [],
      hasCompatibleLocation: false,
    });
    expect(rec.route).toBe('contact');
    expect(rec.contact?.id).toBe('p');
  });

  it('recommends nothing rather than the spare-parts line', () => {
    // A generic number that cannot help teaches the user not to trust the next
    // recommendation either.
    const rec = recommendRoute({
      contacts: [contact({ id: 'parts', purpose: 'spare_parts' })],
      capabilities: [],
      hasCompatibleLocation: false,
    });
    expect(rec.route).toBe('none');
    expect(rec.contact).toBeNull();
  });
});

describe('locations', () => {
  const telAviv = { latitude: 32.0853, longitude: 34.7818 };

  it('ranks by distance when the user shares a position', () => {
    const ranked = rankLocations(
      [
        location({ id: 'haifa', city: 'Haifa', latitude: 32.81, longitude: 35.0 }),
        location({ id: 'tlv', city: 'Tel Aviv', latitude: 32.064, longitude: 34.78 }),
      ],
      telAviv,
    );
    expect(ranked[0]?.id).toBe('tlv');
  });

  it('works with no position at all, falling back to the profile region', () => {
    // Location permission is never required. This is the default path, not a
    // degraded one.
    const ranked = rankLocations(
      [
        location({ id: 'haifa', city: 'Haifa', region: 'Haifa' }),
        location({ id: 'tlv', city: 'Tel Aviv', region: 'Tel Aviv' }),
      ],
      null,
      { region: 'Tel Aviv' },
    );
    expect(ranked[0]?.id).toBe('tlv');
  });

  it('prefers an exact city match over a region match', () => {
    const ranked = rankLocations(
      [
        location({ id: 'region', city: 'Herzliya', region: 'Tel Aviv' }),
        location({ id: 'city', city: 'Tel Aviv', region: 'Tel Aviv' }),
      ],
      null,
      { region: 'Tel Aviv', city: 'Tel Aviv' },
    );
    expect(ranked[0]?.id).toBe('city');
  });

  it('sorts a location without coordinates last rather than hiding it', () => {
    const ranked = rankLocations(
      [
        location({ id: 'nocoords', latitude: null, longitude: null }),
        location({ id: 'coords' }),
      ],
      telAviv,
    );
    expect(ranked.map((l) => l.id)).toEqual(['coords', 'nocoords']);
  });

  it('measures a plausible distance', () => {
    const km = distanceKm(telAviv, location({ latitude: 32.81, longitude: 35.0 }));
    expect(km).toBeGreaterThan(70);
    expect(km).toBeLessThan(100);
  });
});

describe('opening hours', () => {
  const hours = {
    sun: ['09:00', '17:00'] as [string, string],
    mon: ['09:00', '17:00'] as [string, string],
    thu: ['08:00', '15:00'] as [string, string],
  };

  it('says unknown when hours are missing rather than claiming closed', () => {
    // "Closed" is a claim. Not knowing is a fact.
    expect(openingStatus(null).state).toBe('unknown');
    expect(openingStatus({}).state).toBe('unknown');
  });

  it('reports open with a closing time', () => {
    const status = openingStatus(hours, new Date('2026-08-16T11:00:00+03:00'), 'Asia/Jerusalem');
    expect(status).toEqual({ state: 'open', closesAt: '17:00' });
  });

  it('reports closed before opening with today’s opening time', () => {
    const status = openingStatus(hours, new Date('2026-08-16T07:00:00+03:00'), 'Asia/Jerusalem');
    expect(status).toEqual({ state: 'closed', opensDay: 'sun', opensAt: '09:00' });
  });

  it('rolls forward to the next day that has hours', () => {
    // Sunday evening, closed. Monday is the next open day.
    const status = openingStatus(hours, new Date('2026-08-16T20:00:00+03:00'), 'Asia/Jerusalem');
    expect(status).toEqual({ state: 'closed', opensDay: 'mon', opensAt: '09:00' });
  });

  it('reads the branch’s timezone, not the device’s', () => {
    // 23:00 UTC is 02:00 in Jerusalem — the small hours of Monday, not Sunday
    // evening, so the branch is shut and opens later that morning.
    const status = openingStatus(hours, new Date('2026-08-16T23:00:00Z'), 'Asia/Jerusalem');
    expect(status).toEqual({ state: 'closed', opensDay: 'mon', opensAt: '09:00' });
  });
});

describe('service readiness', () => {
  const base = {
    hasProofDocument: true,
    serialNumber: 'RZ8N40FKT9L',
    model: 'QE65S95D',
    hasWarrantyDocument: true,
    issueDescription: 'Vertical black line on the right of the screen',
    photoCount: 0,
  };

  it('counts what is ready without inventing a percentage', () => {
    const readiness = serviceReadiness(base);
    expect(readiness.total).toBe(6);
    expect(readiness.readyCount).toBe(5);
    expect(readiness.blocking).toEqual([]);
  });

  it('blocks only on what the policy actually requires', () => {
    const readiness = serviceReadiness({
      ...base,
      serialNumber: null,
      requiredKeys: ['proof_of_purchase', 'serial_number'],
    });
    expect(readiness.blocking.map((i) => i.key)).toEqual(['serial_number']);
  });

  it('never requires a photo', () => {
    // No warranty makes a photograph a condition. Marking it required would
    // manufacture an obstacle out of a nicety.
    const readiness = serviceReadiness({ ...base, photoCount: 0 });
    expect(readiness.items.find((i) => i.key === 'issue_photo')?.required).toBe(false);
  });

  it('treats whitespace as missing', () => {
    const readiness = serviceReadiness({ ...base, serialNumber: '   ' });
    expect(readiness.items.find((i) => i.key === 'serial_number')?.ready).toBe(false);
  });
});

describe('prepared request', () => {
  const labels = {
    greeting: 'Hello',
    intro: 'I would like to request warranty service for the following product.',
    product: 'Product',
    model: 'Model',
    serial: 'Serial number',
    purchased: 'Purchased',
    warrantyUntil: 'Warranty until',
    issue: 'Issue',
    assessment: 'App assessment',
    clause: 'Referenced clause',
    closing: 'Please let me know how to proceed. Thank you.',
  };

  it('assembles the facts the user would otherwise retype', () => {
    const message = buildServiceRequest({
      productName: 'OLED S95D',
      brandName: 'Samsung',
      model: 'QE65S95D',
      serialNumber: 'RZ8N40FKT9L',
      purchaseDate: '20 August 2024',
      warrantyEnd: '31 August 2026',
      issueDescription: 'A vertical black line appeared on the right of the screen.',
      coverageVerdict: 'Likely covered',
      clauseReference: 'Section 4.2',
      providerName: 'Samline',
      labels,
    });

    expect(message).toContain('Hello Samline,');
    expect(message).toContain('Model: QE65S95D');
    expect(message).toContain('Serial number: RZ8N40FKT9L');
    expect(message).toContain('Section 4.2');
  });

  it('does not repeat a brand the product name already carries', () => {
    // "Samsung Samsung OLED S95D" reads as generated, which is the last thing a
    // service request should look like.
    const message = buildServiceRequest({
      productName: 'Samsung OLED S95D',
      brandName: 'Samsung',
      model: null,
      serialNumber: null,
      purchaseDate: null,
      warrantyEnd: null,
      issueDescription: null,
      coverageVerdict: null,
      clauseReference: null,
      providerName: null,
      labels,
    });
    expect(message).toContain('Product: Samsung OLED S95D');
    expect(message).not.toContain('Samsung Samsung');
  });

  it('still prefixes the brand when the name omits it', () => {
    const message = buildServiceRequest({
      productName: 'OLED S95D',
      brandName: 'Samsung',
      model: null,
      serialNumber: null,
      purchaseDate: null,
      warrantyEnd: null,
      issueDescription: null,
      coverageVerdict: null,
      clauseReference: null,
      providerName: null,
      labels,
    });
    expect(message).toContain('Product: Samsung OLED S95D');
  });

  it('omits facts it does not have instead of writing blanks', () => {
    const message = buildServiceRequest({
      productName: 'OLED S95D',
      brandName: null,
      model: null,
      serialNumber: null,
      purchaseDate: null,
      warrantyEnd: null,
      issueDescription: null,
      coverageVerdict: null,
      clauseReference: null,
      providerName: null,
      labels,
    });
    expect(message).not.toContain('Model:');
    expect(message).not.toContain('Serial number:');
    expect(message).not.toContain('Hello');
  });
});

describe('deep links', () => {
  it('turns an Israeli local number into a dialable one', () => {
    expect(toDialable('03-5555000')).toBe('+97235555000');
    expect(toDialable('+972-3-5555000')).toBe('+97235555000');
  });

  it('builds a WhatsApp link with an editable message and no auto-send', () => {
    const url = whatsappUrl('03-5555000', 'Hello');
    expect(url).toBe('https://wa.me/97235555000?text=Hello');
  });

  it('offers every map provider rather than hard-coding one', () => {
    const target = location({});
    expect(mapUrl('apple', target)).toContain('maps.apple.com');
    expect(mapUrl('google', target)).toContain('google.com/maps');
    expect(mapUrl('waze', target)).toContain('waze.com');
  });

  it('falls back to an address query when there are no coordinates', () => {
    const target = location({ latitude: null, longitude: null });
    expect(mapUrl('google', target)).toContain('destination=');
    expect(mapUrl('google', target)).not.toContain('destination=null');
  });

  it('encodes a mail body so a newline does not truncate it', () => {
    const url = mailtoUrl('service@example.invalid', 'Warranty service', 'Line one\nLine two');
    expect(url).toContain('subject=Warranty%20service');
    expect(url).toContain('Line%20one%0ALine%20two');
  });
});
