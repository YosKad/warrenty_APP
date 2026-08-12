import { toAppError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

/**
 * Service provider discovery.
 *
 * The chain the app resolves is: product → brand → country → warranty provider
 * (often the local importer, not the manufacturer) → service provider → nearest
 * location. Those are four distinct entities and the UI names them separately,
 * because "call Samsung" is unhelpful when the company that actually honours the
 * warranty in your country is a local importer with a different phone number.
 */

export type ServiceProvider = {
  id: string;
  name: string;
  roles: string[];
  countryCode: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  isVerified: boolean;
};

export type ServiceLocation = {
  id: string;
  organisationId: string;
  name: string | null;
  city: string | null;
  region: string | null;
  addressLine: string | null;
  postalCode: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  openingHours: Record<string, [string, string]> | null;
};

export type ProviderChain = {
  manufacturer: ServiceProvider | null;
  warrantyProvider: ServiceProvider | null;
  serviceProvider: ServiceProvider | null;
  retailer: ServiceProvider | null;
  locations: ServiceLocation[];
};

export async function getProviderChain(productId: string): Promise<ProviderChain> {
  try {
    const { data: product, error } = await supabase
      .from('products')
      .select(
        `country_code,
         brand:brand_id ( id, name, roles, country_code, support_phone, support_email, website, is_verified ),
         warranty_provider:warranty_provider_id ( id, name, roles, country_code, support_phone, support_email, website, is_verified ),
         service_provider:service_provider_id ( id, name, roles, country_code, support_phone, support_email, website, is_verified ),
         retailer:retailer_id ( id, name, roles, country_code, support_phone, support_email, website, is_verified )`,
      )
      .eq('id', productId)
      .single();
    if (error) throw error;

    const manufacturer = toProvider(firstRelation(product.brand));
    const warrantyProvider = toProvider(firstRelation(product.warranty_provider));
    const serviceProvider = toProvider(firstRelation(product.service_provider));
    const retailer = toProvider(firstRelation(product.retailer));

    // Prefer the explicitly linked service provider; fall back to whoever honours the
    // warranty, then to the manufacturer. Something is always better than nothing here.
    const locationOrgId =
      serviceProvider?.id ?? warrantyProvider?.id ?? manufacturer?.id ?? null;

    const locations = locationOrgId
      ? await listLocations(locationOrgId, product.country_code)
      : [];

    return { manufacturer, warrantyProvider, serviceProvider, retailer, locations };
  } catch (error) {
    throw toAppError(error);
  }
}

export async function listLocations(
  organisationId: string,
  countryCode: string,
  region?: string,
): Promise<ServiceLocation[]> {
  try {
    let query = supabase
      .from('service_locations')
      .select('*')
      .eq('organisation_id', organisationId)
      .eq('country_code', countryCode)
      .eq('is_active', true)
      .limit(25);
    if (region) query = query.eq('region', region);

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map(toLocation);
  } catch (error) {
    throw toAppError(error);
  }
}

/**
 * Ranks locations by straight-line distance. Deliberately crude: an approximate
 * ordering is all "which branch is nearest" needs, and it means the app never has to
 * ask for precise GPS. Locations without coordinates sort last rather than being
 * hidden.
 */
export function rankByProximity(
  locations: ServiceLocation[],
  origin: { latitude: number; longitude: number } | null,
): ServiceLocation[] {
  if (!origin) return locations;
  return [...locations].sort((a, b) => {
    const da = haversineKm(origin, a);
    const db = haversineKm(origin, b);
    if (da === null) return db === null ? 0 : 1;
    if (db === null) return -1;
    return da - db;
  });
}

function haversineKm(
  origin: { latitude: number; longitude: number },
  target: ServiceLocation,
): number | null {
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

type OrganisationRelation = {
  id: string;
  name: string;
  roles: string[];
  country_code: string | null;
  support_phone: string | null;
  support_email: string | null;
  website: string | null;
  is_verified: boolean;
};

function toProvider(row: OrganisationRelation | null): ServiceProvider | null {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    roles: row.roles,
    countryCode: row.country_code,
    phone: row.support_phone,
    email: row.support_email,
    website: row.website,
    isVerified: row.is_verified,
  };
}

type LocationRow = {
  id: string;
  organisation_id: string;
  name: string | null;
  city: string | null;
  region: string | null;
  address_line: string | null;
  postal_code: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  opening_hours: unknown;
};

function toLocation(row: LocationRow): ServiceLocation {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    name: row.name,
    city: row.city,
    region: row.region,
    addressLine: row.address_line,
    postalCode: row.postal_code,
    phone: row.phone,
    latitude: row.latitude,
    longitude: row.longitude,
    openingHours: (row.opening_hours as Record<string, [string, string]> | null) ?? null,
  };
}

function firstRelation<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
