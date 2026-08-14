import { supabase } from '@/lib/supabase';
import { toAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type { VerificationState } from '@/domain/warrantyIntelligence';
import type { WarrantySource } from '@/domain/warranty';
import {
  collapseChain,
  recommendRoute,
  responsibleForRepair,
  responsibleForWarranty,
  type ChainNode,
  type ContactKind,
  type ContactMethod,
  type ContactPurpose,
  type OpeningHours,
  type Recommendation,
  type RouteOrganisation,
  type ServiceCapability,
  type ServiceLocation,
  type ServiceRole,
} from '@/domain/serviceConcierge';

/**
 * Service concierge data access.
 *
 * Two round trips, deliberately: the route (organisations, their channels and
 * their capabilities) and the compatible locations. Both are RPCs that already
 * do the joining, so the screen never fans out into an N+1 over branches — and
 * the location query never receives coordinates, which is what lets the whole
 * feature work without a location grant.
 */

export type ServiceRoute = {
  productId: string;
  /** One entry per company, with every role it plays. */
  chain: ChainNode[];
  warrantyHolder: ChainNode | null;
  repairer: ChainNode | null;
  contacts: ContactMethod[];
  capabilities: ServiceCapability[];
  recommendation: Recommendation;
};

type RouteRow = {
  role: string;
  organisation_id: string;
  name: string;
  legal_name: string | null;
  country_code: string | null;
  website: string | null;
  is_verified: boolean;
  contacts: unknown;
  capabilities: unknown;
};

type ContactRow = {
  id: string;
  kind: string;
  purpose: string;
  value: string;
  label: string | null;
  language_codes: string[];
  country_code: string | null;
  hours: unknown;
  hours_note: string | null;
  priority: number;
  source: string;
  verification: string;
  verified_at: string | null;
  source_url: string | null;
};

type CapabilityRow = {
  id: string;
  kind: string;
  availability: string;
  country_code: string | null;
  region: string | null;
  typical_lead_time_days: number | null;
  fee_note: string | null;
  verification: string;
  verified_at: string | null;
};

export async function getServiceRoute(
  productId: string,
  options: { hasCompatibleLocation?: boolean } = {},
): Promise<ServiceRoute> {
  try {
    const { data, error } = await supabase.rpc('get_service_route', {
      p_product_id: productId,
    });
    if (error) throw error;

    const rows = (data ?? []) as RouteRow[];

    const links: RouteOrganisation[] = rows.map((row) => ({
      role: row.role as ServiceRole,
      organisationId: row.organisation_id,
      name: row.name,
      legalName: row.legal_name,
      countryCode: row.country_code,
      website: row.website,
      isVerified: row.is_verified,
    }));

    const chain = collapseChain(links);

    // Contacts and capabilities arrive per role, and a company appearing under
    // two roles brings its channels twice. Deduplicated by id rather than by
    // position, because the same number under two roles is one number.
    const contacts = dedupeById(
      rows.flatMap((row) =>
        asArray<ContactRow>(row.contacts).map((c) => toContact(c, row.organisation_id)),
      ),
    );
    const capabilities = dedupeById(
      rows.flatMap((row) =>
        asArray<CapabilityRow>(row.capabilities).map((c) =>
          toCapability(c, row.organisation_id),
        ),
      ),
    );

    return {
      productId,
      chain,
      warrantyHolder: responsibleForWarranty(chain),
      repairer: responsibleForRepair(chain),
      contacts,
      capabilities,
      recommendation: recommendRoute({
        contacts,
        capabilities,
        hasCompatibleLocation: options.hasCompatibleLocation ?? false,
      }),
    };
  } catch (error) {
    throw toAppError(error);
  }
}

/**
 * Locations that can actually service this product.
 *
 * Compatibility is decided in SQL; distance ranking happens on the device with
 * coordinates that never leave it. `region` and `city` are the manual path and
 * are the *default* path — nothing here requires a location permission.
 */
export async function findServiceLocations(
  productId: string,
  filter: { countryCode?: string | null; region?: string | null; city?: string | null } = {},
): Promise<ServiceLocation[]> {
  try {
    const { data, error } = await supabase.rpc('find_service_locations', {
      p_product_id: productId,
      p_country_code: filter.countryCode ?? null,
      p_region: filter.region ?? null,
      p_city: filter.city ?? null,
    });
    if (error) throw error;

    return (data ?? []).map((row) => ({
      id: row.id,
      organisationId: row.organisation_id,
      name: row.name,
      city: row.city,
      region: row.region,
      addressLine: row.address_line,
      postalCode: row.postal_code,
      countryCode: row.country_code,
      phone: row.phone,
      latitude: row.latitude,
      longitude: row.longitude,
      openingHours: (row.opening_hours as OpeningHours | null) ?? null,
      timeZone: row.time_zone,
      appointmentRequired: row.appointment_required,
      verification: row.verification as VerificationState,
      verifiedAt: row.verified_at,
    }));
  } catch (error) {
    throw toAppError(error);
  }
}

/**
 * A user telling us something is wrong.
 *
 * Writes to a queue, never to the shared record. One person reporting a number
 * as wrong must not be able to remove it for everyone — the cheapest attack on
 * a warranty app is making the right number disappear.
 */
export async function reportServiceData(input: {
  reporterId: string;
  kind:
    | 'wrong_phone'
    | 'location_closed'
    | 'wrong_importer'
    | 'service_unavailable'
    | 'wrong_address'
    | 'wrong_hours'
    | 'other';
  organisationId?: string | null;
  serviceLocationId?: string | null;
  contactMethodId?: string | null;
  productId?: string | null;
  note?: string;
  suggestedValue?: string;
}): Promise<void> {
  try {
    const { error } = await supabase.from('service_data_reports').insert({
      reporter_id: input.reporterId,
      kind: input.kind,
      organisation_id: input.organisationId ?? null,
      service_location_id: input.serviceLocationId ?? null,
      contact_method_id: input.contactMethodId ?? null,
      product_id: input.productId ?? null,
      note: input.note ?? null,
      suggested_value: input.suggestedValue ?? null,
    });
    if (error) throw error;
  } catch (error) {
    throw toAppError(error);
  }
}

/**
 * Records that something happened to a product, for the activity history.
 *
 * Fire-and-forget through an Edge Function: `activity_events` is server-written
 * by design, and a failure to log must never block a user from phoning a
 * service centre.
 */
export async function recordServiceActivity(input: {
  productId: string;
  kind: 'service_route_viewed' | 'provider_contacted' | 'directions_opened' | 'service_request_prepared';
  payload?: Record<string, unknown>;
}): Promise<void> {
  try {
    await supabase.functions.invoke('record-activity', {
      body: { productId: input.productId, kind: input.kind, payload: input.payload ?? {} },
    });
  } catch {
    logger.warn('activity event not recorded');
  }
}

// --------------------------------------------------------------------------

function toContact(row: ContactRow, organisationId: string): ContactMethod {
  return {
    id: row.id,
    organisationId,
    kind: row.kind as ContactKind,
    purpose: row.purpose as ContactPurpose,
    value: row.value,
    label: row.label,
    languageCodes: row.language_codes ?? [],
    countryCode: row.country_code,
    hours: (row.hours as OpeningHours | null) ?? null,
    hoursNote: row.hours_note,
    priority: row.priority,
    source: row.source as WarrantySource,
    verification: row.verification as VerificationState,
    verifiedAt: row.verified_at,
    sourceUrl: row.source_url,
  };
}

function toCapability(row: CapabilityRow, organisationId: string): ServiceCapability {
  return {
    id: row.id,
    organisationId,
    kind: row.kind as ServiceCapability['kind'],
    availability: row.availability as ServiceCapability['availability'],
    countryCode: row.country_code,
    region: row.region,
    typicalLeadTimeDays: row.typical_lead_time_days,
    feeNote: row.fee_note,
    verification: row.verification as VerificationState,
    verifiedAt: row.verified_at,
  };
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Map<string, T>();
  for (const item of items) if (!seen.has(item.id)) seen.set(item.id, item);
  return [...seen.values()];
}
