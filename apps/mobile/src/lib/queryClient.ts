import { QueryClient } from '@tanstack/react-query';

import { isAppError } from './errors';

/**
 * Query defaults tuned for a warranty app: data changes rarely (a warranty end date
 * is stable for years), so we keep a generous stale time and lean on the cache for
 * offline reads rather than refetching aggressively.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        gcTime: 24 * 60 * 60 * 1000,
        retry: (failureCount, error) => {
          // Retrying an auth or permission failure just burns battery.
          if (isAppError(error)) {
            if (
              error.code === 'unauthenticated' ||
              error.code === 'forbidden' ||
              error.code === 'not_found' ||
              error.code === 'validation' ||
              error.code === 'quota_exceeded' ||
              error.code === 'payment_required'
            ) {
              return false;
            }
          }
          return failureCount < 2;
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

/**
 * Centralised query keys. Co-locating them prevents the classic bug where an
 * invalidation misses because two call sites spelled the key differently.
 */
export const queryKeys = {
  session: ['session'] as const,
  profile: ['profile'] as const,
  entitlement: ['entitlement'] as const,
  products: {
    all: ['products'] as const,
    list: (filters: Record<string, unknown> = {}) => ['products', 'list', filters] as const,
    summary: ['products', 'summary'] as const,
    detail: (id: string) => ['products', 'detail', id] as const,
    documents: (id: string) => ['products', 'documents', id] as const,
  },
  /** Protection Score inputs — every product plus its proof documents. */
  protection: ['protection'] as const,
  warranty: {
    detail: (productId: string) => ['warranty', productId] as const,
  },
  alerts: {
    list: ['alerts'] as const,
    unreadCount: ['alerts', 'unread-count'] as const,
  },
  claims: {
    forProduct: (productId: string) => ['claims', productId] as const,
    detail: (id: string) => ['claims', 'detail', id] as const,
  },
  serviceProviders: {
    forProduct: (productId: string) => ['service-providers', productId] as const,
  },
  taxonomy: {
    categories: ['taxonomy', 'categories'] as const,
    brands: (search: string) => ['taxonomy', 'brands', search] as const,
    retailers: (search: string) => ['taxonomy', 'retailers', search] as const,
  },
  featureFlags: ['feature-flags'] as const,
} as const;
