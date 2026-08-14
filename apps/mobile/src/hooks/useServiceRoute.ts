import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryClient';
import { findServiceLocations, getServiceRoute } from '@/services/serviceConciergeService';

/**
 * The service route for a product.
 *
 * Cached hard and keyed on the product alone. Provider chains change when an
 * importer changes, which is a matter of years, not minutes — re-fetching on
 * every screen focus would spend round trips to produce the identical answer.
 *
 * Locations are fetched first so the recommendation knows whether "visit a
 * service centre" is even an option; recommending a branch that does not exist
 * is worse than recommending nothing.
 */
export function useServiceRoute(
  productId: string,
  filter: { region?: string | null; city?: string | null } = {},
) {
  const locations = useQuery({
    queryKey: queryKeys.service.locations(productId, filter),
    queryFn: () => findServiceLocations(productId, filter),
    enabled: productId.length > 0,
    staleTime: 30 * 60 * 1000,
  });

  const route = useQuery({
    queryKey: queryKeys.service.route(productId, (locations.data ?? []).length > 0),
    queryFn: () =>
      getServiceRoute(productId, {
        hasCompatibleLocation: (locations.data ?? []).length > 0,
      }),
    enabled: productId.length > 0 && !locations.isLoading,
    staleTime: 30 * 60 * 1000,
  });

  return {
    route: route.data ?? null,
    locations: locations.data ?? [],
    isLoading: route.isLoading || locations.isLoading,
    error: route.error ?? locations.error ?? null,
  };
}
