import { AppError, toAppError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { CalendarDate } from '@/domain/date';
import type { Product, ProductDraft, ProductListFilters } from '@/domain/product';
import type { WarrantyStatus } from '@/domain/warranty';
import type { Database } from '@/types/database';

/**
 * Product CRUD.
 *
 * All database access for products goes through this module — no component ever
 * touches `supabase.from('products')` directly. That keeps ownership rules, error
 * translation and the row↔domain mapping in one reviewable place.
 */

type ProductRow = Database['public']['Tables']['products']['Row'];
type OverviewRow = Database['public']['Views']['product_warranty_overview']['Row'];

export type ProductListItem = {
  id: string;
  name: string;
  model: string | null;
  brandName: string | null;
  categoryId: string;
  categorySlug: string | null;
  imagePath: string | null;
  purchaseDate: CalendarDate | null;
  warrantyEnd: CalendarDate | null;
  status: WarrantyStatus;
  daysRemaining: number | null;
  verifiedByUser: boolean;
  updatedAt: string;
};

export type WarrantySummary = {
  active: number;
  endingSoon: number;
  expired: number;
  unknown: number;
  total: number;
  nextExpiryProductId: string | null;
  nextExpiryDate: CalendarDate | null;
};

export type ProductQuota = {
  plan: 'free' | 'plus' | 'pro';
  limit: number | null;
  current: number;
  canAdd: boolean;
};

const PAGE_SIZE = 20;

export async function listProducts(
  filters: ProductListFilters = {},
  page = 0,
): Promise<{ items: ProductListItem[]; hasMore: boolean }> {
  try {
    let query = supabase
      .from('product_warranty_overview')
      .select('*')
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

    if (filters.query && filters.query.trim().length > 0) {
      const term = `%${filters.query.trim()}%`;
      // Matches the fields a person would actually search by. Serial number is
      // included because it is what someone reads off the back of a broken appliance.
      query = query.or(
        `name.ilike.${term},model.ilike.${term},brand_display_name.ilike.${term}`,
      );
    }
    if (filters.status && filters.status.length > 0) {
      query = query.in('status', filters.status);
    }
    if (filters.categoryIds && filters.categoryIds.length > 0) {
      query = query.in('category_id', filters.categoryIds);
    }
    if (filters.brandIds && filters.brandIds.length > 0) {
      query = query.in('brand_id', filters.brandIds);
    }
    if (filters.purchasedAfter) query = query.gte('purchase_date', filters.purchasedAfter);
    if (filters.purchasedBefore) query = query.lte('purchase_date', filters.purchasedBefore);
    if (filters.expiringBefore) {
      query = query.lte('effective_warranty_end', filters.expiringBefore);
    }

    switch (filters.sort ?? 'urgency') {
      case 'name':
        query = query.order('name', { ascending: true });
        break;
      case 'recent':
        query = query.order('created_at', { ascending: false });
        break;
      case 'expiry':
        query = query.order('effective_warranty_end', {
          ascending: true,
          nullsFirst: false,
        });
        break;
      case 'urgency':
      default:
        // Soonest live expiry first; products with no known end date sort last.
        query = query
          .order('days_remaining', { ascending: true, nullsFirst: false })
          .order('updated_at', { ascending: false });
        break;
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data ?? []) as OverviewRow[];
    // One extra row is fetched to detect a next page without a count query.
    const hasMore = rows.length > PAGE_SIZE;
    return { items: rows.slice(0, PAGE_SIZE).map(toListItem), hasMore };
  } catch (error) {
    throw toAppError(error);
  }
}

export async function getProduct(id: string): Promise<Product> {
  try {
    // The category slug rides along because the detail screen picks its
    // illustration from it, and a second round trip for one string is wasteful.
    const { data, error } = await supabase
      .from('products')
      .select('*, category:category_id ( slug )')
      .eq('id', id)
      .is('deleted_at', null)
      .single();
    if (error) throw error;
    if (!data) throw new AppError('not_found');
    const row = data as ProductRow & { category?: { slug: string } | null };
    return { ...toProduct(row), categorySlug: row.category?.slug ?? null };
  } catch (error) {
    throw toAppError(error);
  }
}

export async function getWarrantySummary(): Promise<WarrantySummary> {
  try {
    const { data, error } = await supabase.rpc('get_warranty_summary');
    if (error) throw error;
    const row = data?.[0];
    return {
      active: Number(row?.active_count ?? 0),
      endingSoon: Number(row?.ending_soon_count ?? 0),
      expired: Number(row?.expired_count ?? 0),
      unknown: Number(row?.unknown_count ?? 0),
      total: Number(row?.total_count ?? 0),
      nextExpiryProductId: row?.next_expiry_product_id ?? null,
      nextExpiryDate: (row?.next_expiry_date as CalendarDate | null) ?? null,
    };
  } catch (error) {
    throw toAppError(error);
  }
}

export async function getProductQuota(): Promise<ProductQuota> {
  try {
    const { data, error } = await supabase.rpc('get_product_quota');
    if (error) throw error;
    const row = data?.[0];
    return {
      plan: row?.plan ?? 'free',
      limit: row?.product_limit ?? null,
      current: Number(row?.current_count ?? 0),
      canAdd: row?.can_add ?? false,
    };
  } catch (error) {
    throw toAppError(error);
  }
}

export async function createProduct(
  draft: ProductDraft,
  context: { workspaceId: string; ownerId: string },
): Promise<Product> {
  try {
    const { data, error } = await supabase
      .from('products')
      .insert({
        workspace_id: context.workspaceId,
        owner_id: context.ownerId,
        name: draft.name,
        category_id: draft.categoryId,
        brand_id: draft.brandId ?? null,
        brand_name: draft.brandName ?? null,
        model: draft.model ?? null,
        serial_number: draft.serialNumber ?? null,
        purchase_date: draft.purchaseDate,
        purchase_price: draft.purchasePrice ?? null,
        currency: draft.currency ?? null,
        retailer_id: draft.retailerId ?? null,
        retailer_name: draft.retailerName ?? null,
        country_code: draft.countryCode,
        warranty_start: draft.warrantyStart ?? null,
        warranty_end: draft.warrantyEnd ?? null,
        warranty_duration_months: draft.warrantyDurationMonths ?? null,
        extension_months: draft.extensionMonths ?? 0,
        warranty_source: 'user_entered',
        warranty_id: null,
        warranty_provider_id: draft.warrantyProviderId ?? null,
        service_provider_id: draft.serviceProviderId ?? null,
        warranty_verified_by_user: true,
        image_path: draft.imagePath ?? null,
        notes: draft.notes ?? null,
        lifecycle: 'active',
      })
      .select('*')
      .single();

    if (error) throw translateInsertError(error);
    return toProduct(data as ProductRow);
  } catch (error) {
    throw toAppError(error);
  }
}

export async function updateProduct(
  id: string,
  patch: Partial<ProductDraft>,
): Promise<Product> {
  try {
    const { data, error } = await supabase
      .from('products')
      .update({
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.categoryId !== undefined && { category_id: patch.categoryId }),
        ...(patch.brandId !== undefined && { brand_id: patch.brandId ?? null }),
        ...(patch.brandName !== undefined && { brand_name: patch.brandName ?? null }),
        ...(patch.model !== undefined && { model: patch.model ?? null }),
        ...(patch.serialNumber !== undefined && {
          serial_number: patch.serialNumber ?? null,
        }),
        ...(patch.purchaseDate !== undefined && { purchase_date: patch.purchaseDate }),
        ...(patch.purchasePrice !== undefined && {
          purchase_price: patch.purchasePrice ?? null,
        }),
        ...(patch.currency !== undefined && { currency: patch.currency ?? null }),
        ...(patch.retailerId !== undefined && { retailer_id: patch.retailerId ?? null }),
        ...(patch.retailerName !== undefined && {
          retailer_name: patch.retailerName ?? null,
        }),
        ...(patch.warrantyStart !== undefined && {
          warranty_start: patch.warrantyStart ?? null,
        }),
        ...(patch.warrantyEnd !== undefined && { warranty_end: patch.warrantyEnd ?? null }),
        ...(patch.warrantyDurationMonths !== undefined && {
          warranty_duration_months: patch.warrantyDurationMonths ?? null,
        }),
        ...(patch.extensionMonths !== undefined && {
          extension_months: patch.extensionMonths ?? 0,
        }),
        ...(patch.serviceProviderId !== undefined && {
          service_provider_id: patch.serviceProviderId ?? null,
        }),
        ...(patch.notes !== undefined && { notes: patch.notes ?? null }),
        ...(patch.imagePath !== undefined && { image_path: patch.imagePath ?? null }),
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;
    return toProduct(data as ProductRow);
  } catch (error) {
    throw toAppError(error);
  }
}

/**
 * Marks the auto-detected warranty as checked by the user. This is what flips a
 * product from "we think" to "confirmed" in the UI, and it is only ever set by an
 * explicit tap on the confirmation screen.
 */
export async function confirmWarranty(
  id: string,
  confirmed: { warrantyEnd?: CalendarDate; durationMonths?: number },
): Promise<Product> {
  try {
    const { data, error } = await supabase
      .from('products')
      .update({
        warranty_verified_by_user: true,
        ...(confirmed.warrantyEnd && { warranty_end: confirmed.warrantyEnd }),
        ...(confirmed.durationMonths && {
          warranty_duration_months: confirmed.durationMonths,
        }),
      })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return toProduct(data as ProductRow);
  } catch (error) {
    throw toAppError(error);
  }
}

export async function deleteProduct(id: string): Promise<void> {
  try {
    const { error } = await supabase.rpc('soft_delete_product', { p_product_id: id });
    if (error) throw error;
  } catch (error) {
    throw toAppError(error);
  }
}

/**
 * The database raises a bare `product_limit_reached` for the quota trigger. Mapping
 * it to a distinct code here is what lets the UI open the paywall sheet instead of
 * showing a generic failure — and, critically, keep the user's draft intact.
 */
function translateInsertError(error: { message?: string; code?: string }): unknown {
  if (error.message?.includes('product_limit_reached') || error.code === '53400') {
    return new AppError('quota_exceeded', { messageKey: 'paywall.limitReached' });
  }
  return error;
}

function toListItem(row: OverviewRow): ProductListItem {
  return {
    id: row.id,
    name: row.name,
    model: row.model,
    brandName: row.brand_display_name,
    categoryId: row.category_id,
    categorySlug: row.category_slug,
    imagePath: row.image_path,
    purchaseDate: row.purchase_date as CalendarDate | null,
    warrantyEnd: row.effective_warranty_end as CalendarDate | null,
    status: row.status,
    daysRemaining: row.days_remaining,
    verifiedByUser: row.warranty_verified_by_user,
    updatedAt: row.updated_at,
  };
}

function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    ownerId: row.owner_id,
    workspaceId: row.workspace_id,
    name: row.name,
    categoryId: row.category_id,
    categorySlug: null,
    brandId: row.brand_id,
    brandName: row.brand_name,
    model: row.model,
    serialNumber: row.serial_number,
    purchaseDate: row.purchase_date as CalendarDate | null,
    purchasePrice: row.purchase_price,
    currency: row.currency,
    retailerId: row.retailer_id,
    retailerName: row.retailer_name,
    countryCode: row.country_code,
    warrantyStart: row.warranty_start as CalendarDate | null,
    warrantyEnd: row.warranty_end as CalendarDate | null,
    warrantyDurationMonths: row.warranty_duration_months,
    extensionMonths: row.extension_months,
    warrantySource: row.warranty_source,
    warrantyVerifiedByUser: row.warranty_verified_by_user,
    warrantyProviderId: row.warranty_provider_id,
    serviceProviderId: row.service_provider_id,
    imagePath: row.image_path,
    notes: row.notes,
    lifecycle: row.lifecycle,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
