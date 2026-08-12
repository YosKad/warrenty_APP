import { toAppError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

/**
 * The user's profile and workspace.
 *
 * `getProfile` returns the personal workspace id alongside the profile because every
 * product write needs it, and fetching it separately on each add would be a wasted
 * round trip.
 */

export type UserProfile = {
  id: string;
  displayName: string | null;
  email: string;
  countryCode: string;
  region: string | null;
  preferredLanguage: string;
  timeZone: string;
  preferredCurrency: string;
  marketingOptIn: boolean;
  analyticsOptIn: boolean;
  biometricLock: boolean;
  onboardingCompletedAt: string | null;
  personalWorkspaceId: string | null;
};

export async function getProfile(): Promise<UserProfile> {
  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .is('deleted_at', null)
      .single();
    if (error) throw error;

    const { data: workspace } = await supabase
      .from('workspaces')
      .select('id')
      .eq('kind', 'personal')
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();

    return {
      id: data.id,
      displayName: data.display_name,
      email: data.email,
      countryCode: data.country_code,
      region: data.region,
      preferredLanguage: data.preferred_language,
      timeZone: data.time_zone,
      preferredCurrency: data.preferred_currency,
      marketingOptIn: data.marketing_opt_in,
      analyticsOptIn: data.analytics_opt_in,
      biometricLock: data.biometric_lock,
      onboardingCompletedAt: data.onboarding_completed_at,
      personalWorkspaceId: workspace?.id ?? null,
    };
  } catch (error) {
    throw toAppError(error);
  }
}

export async function updateProfile(patch: {
  displayName?: string;
  countryCode?: string;
  region?: string | null;
  preferredLanguage?: string;
  timeZone?: string;
  preferredCurrency?: string;
  marketingOptIn?: boolean;
  analyticsOptIn?: boolean;
  biometricLock?: boolean;
}): Promise<void> {
  try {
    const { error } = await supabase
      .from('user_profiles')
      .update({
        ...(patch.displayName !== undefined && { display_name: patch.displayName }),
        ...(patch.countryCode !== undefined && {
          country_code: patch.countryCode.toUpperCase(),
        }),
        ...(patch.region !== undefined && { region: patch.region }),
        ...(patch.preferredLanguage !== undefined && {
          preferred_language: patch.preferredLanguage,
        }),
        ...(patch.timeZone !== undefined && { time_zone: patch.timeZone }),
        ...(patch.preferredCurrency !== undefined && {
          preferred_currency: patch.preferredCurrency.toUpperCase(),
        }),
        ...(patch.marketingOptIn !== undefined && { marketing_opt_in: patch.marketingOptIn }),
        ...(patch.analyticsOptIn !== undefined && { analytics_opt_in: patch.analyticsOptIn }),
        ...(patch.biometricLock !== undefined && { biometric_lock: patch.biometricLock }),
      })
      .neq('id', '00000000-0000-0000-0000-000000000000'); // RLS scopes this to self
    if (error) throw error;
  } catch (error) {
    throw toAppError(error);
  }
}

export async function completeOnboarding(): Promise<void> {
  await supabase
    .from('user_profiles')
    .update({ onboarding_completed_at: new Date().toISOString() })
    .neq('id', '00000000-0000-0000-0000-000000000000');
}

/**
 * Data export. Runs server-side so it can gather Storage objects alongside rows and
 * return one signed archive URL. Offered on every plan: a user's own data is not a
 * premium feature, and being able to leave is part of being trustworthy.
 */
export async function requestDataExport(): Promise<{ downloadUrl: string }> {
  try {
    const { data, error } = await supabase.functions.invoke<{ downloadUrl: string }>(
      'export-data',
      { body: {} },
    );
    if (error) throw error;
    if (!data?.downloadUrl) throw new Error('missing download url');
    return data;
  } catch (error) {
    throw toAppError(error);
  }
}

export type CategoryOption = {
  id: string;
  slug: string;
  label: string;
  icon: string | null;
  typicalWarrantyMonths: number | null;
};

export async function listCategories(language: string): Promise<CategoryOption[]> {
  try {
    const { data, error } = await supabase
      .from('product_categories')
      .select('id, slug, labels, icon, typical_warranty_months, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (error) throw error;

    return (data ?? []).map((row) => ({
      id: row.id,
      slug: row.slug,
      // Falls back through the user's language → English → the slug, so a category
      // added by an admin is usable immediately even before it is translated.
      label: row.labels[language] ?? row.labels.en ?? row.slug,
      icon: row.icon,
      typicalWarrantyMonths: row.typical_warranty_months,
    }));
  } catch (error) {
    throw toAppError(error);
  }
}

export type BrandOption = { id: string; name: string; logoUrl: string | null };

export async function searchBrands(search: string): Promise<BrandOption[]> {
  if (search.trim().length < 2) return [];
  try {
    const { data, error } = await supabase
      .from('organisations')
      .select('id, name, logo_url')
      .contains('roles', ['manufacturer'])
      .ilike('name', `%${search.trim()}%`)
      .limit(20);
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      logoUrl: row.logo_url,
    }));
  } catch (error) {
    throw toAppError(error);
  }
}

export async function searchRetailers(search: string): Promise<BrandOption[]> {
  if (search.trim().length < 2) return [];
  try {
    const { data, error } = await supabase
      .from('organisations')
      .select('id, name, logo_url')
      .contains('roles', ['retailer'])
      .ilike('name', `%${search.trim()}%`)
      .limit(20);
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      logoUrl: row.logo_url,
    }));
  } catch (error) {
    throw toAppError(error);
  }
}
