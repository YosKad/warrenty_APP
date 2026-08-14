import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryClient';
import { getApplicableWarranty } from '@/services/warrantyIntelligenceService';

/**
 * Warranty intelligence for one product.
 *
 * Cached hard. Matching is deterministic and the inputs — the product, the
 * policy corpus — change rarely, so re-resolving on every screen focus would
 * spend round trips to produce the identical answer. A correction or a document
 * upload invalidates the key explicitly.
 */
export function useWarrantyIntelligence(productId: string) {
  return useQuery({
    queryKey: queryKeys.warranty.intelligence(productId),
    queryFn: () => getApplicableWarranty(productId),
    enabled: productId.length > 0,
    staleTime: 10 * 60 * 1000,
  });
}
