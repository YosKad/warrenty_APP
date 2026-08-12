import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryClient';
import { track } from '@/lib/analytics';
import * as productService from '@/services/productService';
import * as subscriptionService from '@/services/subscriptionService';
import type { ProductDraft, ProductListFilters } from '@/domain/product';
import { canAddProduct, entitlementsForPlan } from '@/domain/entitlements';
import { useSessionStore } from '@/state/session';

/**
 * Product data hooks.
 *
 * Screens use these; they never call the service layer or Supabase directly. The
 * invalidation rules live here, which is why adding a product reliably refreshes the
 * list, the Home summary and the quota in one place.
 */

export function useProductList(filters: ProductListFilters = {}) {
  return useQuery({
    queryKey: queryKeys.products.list(filters),
    queryFn: () => productService.listProducts(filters),
  });
}

export function useProduct(id: string) {
  return useQuery({
    queryKey: queryKeys.products.detail(id),
    queryFn: () => productService.getProduct(id),
    enabled: id.length > 0,
  });
}

export function useWarrantySummary() {
  return useQuery({
    queryKey: queryKeys.products.summary,
    queryFn: productService.getWarrantySummary,
  });
}

export function useSubscriptionState() {
  return useQuery({
    queryKey: queryKeys.entitlement,
    queryFn: subscriptionService.getSubscriptionState,
    // Entitlement drives paywalls, so it is refreshed more eagerly than product data.
    staleTime: 60 * 1000,
  });
}

/**
 * Quota check for the add flow.
 *
 * Deliberately combines the server's count with the locally-known plan so the paywall
 * decision is available synchronously once both queries have resolved — the server
 * still enforces the real limit on insert.
 */
export function useProductQuota() {
  const subscription = useSubscriptionState();
  const quota = useQuery({
    queryKey: ['products', 'quota'],
    queryFn: productService.getProductQuota,
    staleTime: 30 * 1000,
  });

  const plan = subscription.data?.plan ?? 'free';
  const entitlements = subscription.data?.entitlements ?? entitlementsForPlan('free');
  const current = quota.data?.current ?? 0;

  return {
    isLoading: quota.isLoading || subscription.isLoading,
    plan,
    entitlements,
    current,
    check: canAddProduct(entitlements, current, plan),
  };
}

export function useCreateProduct() {
  const queryClient = useQueryClient();
  const profile = useSessionStore((s) => s.profile);
  const userId = useSessionStore((s) => s.session?.user.id);

  return useMutation({
    mutationFn: async (input: { draft: ProductDraft; method: 'manual' | 'receipt' | 'barcode' | 'photo' }) => {
      if (!profile?.personalWorkspaceId || !userId) {
        throw new Error('No workspace available for this account');
      }
      return productService.createProduct(input.draft, {
        workspaceId: profile.personalWorkspaceId,
        ownerId: userId,
      });
    },
    onSuccess: (product, variables) => {
      track({
        name: 'product_added',
        props: {
          method: variables.method,
          hasWarrantyEnd: product.warrantyEnd !== null,
        },
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.products.summary });
      void queryClient.invalidateQueries({ queryKey: ['products', 'quota'] });
    },
  });
}

export function useUpdateProduct(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<ProductDraft>) => productService.updateProduct(id, patch),
    onSuccess: (product) => {
      queryClient.setQueryData(queryKeys.products.detail(id), product);
      void queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.products.summary });
    },
  });
}

export function useDeleteProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => productService.deleteProduct(id),
    onSuccess: () => {
      track({ name: 'product_deleted', props: {} });
      void queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.products.summary });
      void queryClient.invalidateQueries({ queryKey: ['products', 'quota'] });
    },
  });
}

export function useConfirmWarranty(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (confirmed: { warrantyEnd?: string; durationMonths?: number }) =>
      productService.confirmWarranty(id, confirmed),
    onSuccess: (product) => {
      track({ name: 'warranty_confirmed', props: { edited: false } });
      queryClient.setQueryData(queryKeys.products.detail(id), product);
      void queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
    },
  });
}
