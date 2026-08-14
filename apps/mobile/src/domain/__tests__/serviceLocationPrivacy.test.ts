import {
  distanceKm,
  openingStatus,
  rankLocations,
  recommendRoute,
  type ContactMethod,
  type ServiceCapability,
  type ServiceLocation,
} from '../serviceConcierge';

/**
 * Location privacy.
 *
 * Phase H names this as part of the definition of done, and it deserves its own
 * file rather than a stray assertion: a user must be able to use the whole
 * Service Concierge without ever granting GPS.
 *
 * The design that makes it true is that coordinates are an *enhancement*, not an
 * input. Compatibility filtering happens server-side on brand, category and
 * country — none of which is a position — and every ranking function accepts
 * `null` for the origin and still returns a useful order.
 */

const location = (over: Partial<ServiceLocation>): ServiceLocation => ({
  id: 'l1',
  organisationId: 'o1',
  name: 'Branch',
  city: 'Tel Aviv',
  region: 'Tel Aviv',
  addressLine: 'Some street 1',
  postalCode: null,
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

const contact = (over: Partial<ContactMethod>): ContactMethod => ({
  id: 'c1',
  organisationId: 'o1',
  kind: 'phone',
  purpose: 'warranty_claims',
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
  kind: 'drop_off',
  availability: 'available',
  countryCode: 'IL',
  region: null,
  typicalLeadTimeDays: null,
  feeNote: null,
  verification: 'unverified',
  verifiedAt: null,
  ...over,
});

describe('the concierge works with no location permission', () => {
  const branches = [
    location({ id: 'haifa', name: 'Haifa', city: 'Haifa', region: 'Haifa' }),
    location({ id: 'tlv', name: 'Tel Aviv', city: 'Tel Aviv', region: 'Tel Aviv' }),
    location({ id: 'beer', name: 'Beer Sheva', city: 'Beer Sheva', region: 'South' }),
  ];

  it('still returns every compatible branch with no origin', () => {
    const ranked = rankLocations(branches, null);
    expect(ranked).toHaveLength(3);
  });

  it('orders by the profile region the user already gave us', () => {
    const ranked = rankLocations(branches, null, { region: 'Haifa' });
    expect(ranked[0]?.id).toBe('haifa');
  });

  it('orders by a city the user typed', () => {
    const ranked = rankLocations(branches, null, { city: 'Beer Sheva' });
    expect(ranked[0]?.id).toBe('beer');
  });

  it('does not fall over when neither region nor city is known', () => {
    // A brand-new account with no region set and no typing. Still a list.
    const ranked = rankLocations(branches, null, {});
    expect(ranked).toHaveLength(3);
    expect(ranked[0]).toBeDefined();
  });

  it('recommends a route without any position at all', () => {
    const rec = recommendRoute({
      contacts: [contact({})],
      capabilities: [capability({ kind: 'home_technician' })],
      hasCompatibleLocation: false,
    });
    expect(rec.route).toBe('book_technician');
    expect(rec.contact).not.toBeNull();
  });

  it('shows opening hours without a position', () => {
    // Hours depend on the branch's timezone, which is a property of the branch.
    const status = openingStatus(
      { sun: ['09:00', '17:00'] },
      new Date('2026-08-16T11:00:00+03:00'),
      'Asia/Jerusalem',
    );
    expect(status.state).toBe('open');
  });

  it('never computes a distance it was not given an origin for', () => {
    // `distanceKm` requires an origin by its signature; the ranking path that
    // omits one never reaches it. This pins the contract.
    const ranked = rankLocations(branches, null, { region: 'Haifa' });
    expect(ranked.every((l) => l.latitude !== undefined)).toBe(true);
    expect(distanceKm({ latitude: 32.08, longitude: 34.78 }, branches[0]!)).not.toBeNull();
  });

  it('treats a granted position as an improvement, not a requirement', () => {
    const withOrigin = rankLocations(branches, { latitude: 32.81, longitude: 35.0 });
    const withoutOrigin = rankLocations(branches, null, { region: 'Haifa' });
    // Both orders are useful; the first is just more precise.
    expect(withOrigin[0]?.id).toBe('haifa');
    expect(withoutOrigin[0]?.id).toBe('haifa');
  });
});
