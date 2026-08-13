import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import { toAppError } from '@/lib/errors';
import { queryKeys } from '@/lib/queryClient';
import { useLocale } from '@/hooks/useLocale';
import {
  buildSuggestedActions,
  getPortfolioProtection,
  isScorable,
  scoreProduct,
  type ProtectionInput,
  type ScoredProduct,
  type SuggestedAction,
} from '@/domain/protection';
import { getWarrantySnapshot } from '@/domain/warranty';
import type { CalendarDate } from '@/domain/date';

/**
 * Protection Score for the signed-in workspace.
 *
 * The scoring itself is pure and lives in `src/domain/protection.ts`. This hook
 * only gathers the inputs: the product columns the score reads, plus a count of
 * proof documents per product.
 *
 * The document count is fetched as a single grouped query rather than per
 * product — Home would otherwise fire one request per row.
 */

export type ProtectionProductRow = {
  id: string;
  name: string;
  categorySlug: string | null;
  imagePath: string | null;
  input: ProtectionInput;
  scored: ScoredProduct;
  daysRemaining: number | null;
  warrantyEnd: CalendarDate | null;
};

type RawProduct = {
  id: string;
  name: string;
  purchase_date: string | null;
  warranty_start: string | null;
  warranty_end: string | null;
  warranty_duration_months: number | null;
  extension_months: number | null;
  serial_number: string | null;
  model: string | null;
  warranty_provider_id: string | null;
  service_provider_id: string | null;
  warranty_id: string | null;
  image_path: string | null;
  lifecycle: ProtectionInput['lifecycle'];
  category: { slug: string } | { slug: string }[] | null;
};

async function fetchProtectionInputs(): Promise<{
  products: RawProduct[];
  proofCounts: Map<string, number>;
}> {
  const { data, error } = await supabase
    .from('products')
    .select(
      `id, name, purchase_date, warranty_start, warranty_end,
       warranty_duration_months, extension_months, serial_number, model,
       warranty_provider_id, service_provider_id, warranty_id, image_path, lifecycle,
       category:category_id ( slug )`,
    )
    .is('deleted_at', null);

  if (error) throw toAppError(error);
  const products = (data ?? []) as unknown as RawProduct[];

  // Only receipts and invoices count as proof of purchase — a product photo or
  // a manual does not help you file a claim.
  const { data: docs } = await supabase
    .from('product_documents')
    .select('product_id, kind')
    .in('kind', ['receipt', 'invoice'])
    .is('deleted_at', null);

  const proofCounts = new Map<string, number>();
  for (const doc of docs ?? []) {
    proofCounts.set(doc.product_id, (proofCounts.get(doc.product_id) ?? 0) + 1);
  }

  return { products, proofCounts };
}

export function useProtection() {
  const { today } = useLocale();

  const query = useQuery({
    queryKey: queryKeys.protection,
    queryFn: fetchProtectionInputs,
    staleTime: 60 * 1000,
  });

  return useMemo(() => {
    const rows: ProtectionProductRow[] = (query.data?.products ?? [])
      .filter((raw) => isScorable(raw.lifecycle))
      .map((raw) => {
        const input: ProtectionInput = {
          purchaseDate: raw.purchase_date as CalendarDate | null,
          warrantyStart: raw.warranty_start as CalendarDate | null,
          warrantyEnd: raw.warranty_end as CalendarDate | null,
          durationMonths: raw.warranty_duration_months,
          extensionMonths: raw.extension_months,
          serialNumber: raw.serial_number,
          model: raw.model,
          warrantyProviderId: raw.warranty_provider_id,
          serviceProviderId: raw.service_provider_id,
          warrantyId: raw.warranty_id,
          proofDocumentCount: query.data?.proofCounts.get(raw.id) ?? 0,
          lifecycle: raw.lifecycle,
        };

        const snapshot = getWarrantySnapshot(
          {
            purchaseDate: input.purchaseDate,
            warrantyStart: input.warrantyStart,
            warrantyEnd: input.warrantyEnd,
            durationMonths: input.durationMonths,
            extensionMonths: input.extensionMonths,
          },
          today,
        );

        const category = Array.isArray(raw.category) ? raw.category[0] : raw.category;

        return {
          id: raw.id,
          name: raw.name,
          categorySlug: category?.slug ?? null,
          imagePath: raw.image_path,
          input,
          scored: scoreProduct(raw.id, input, today),
          daysRemaining: snapshot.daysRemaining,
          warrantyEnd: snapshot.end,
        };
      });

    const portfolio = getPortfolioProtection(rows.map((r) => r.scored));

    const actions: SuggestedAction[] = buildSuggestedActions(
      rows.map((r) => ({ ...r.scored, daysRemaining: r.daysRemaining })),
    );

    const byId = new Map(rows.map((r) => [r.id, r]));

    return {
      isLoading: query.isLoading,
      portfolio,
      rows,
      actions,
      /** Resolves an action back to the product it belongs to, for the Home list. */
      productFor: (productId: string) => byId.get(productId) ?? null,
    };
  }, [query.data, query.isLoading, today]);
}

/** Per-product completeness, for the product detail screen. */
export function useProductProtection(productId: string) {
  const protection = useProtection();
  return protection.productFor(productId);
}
