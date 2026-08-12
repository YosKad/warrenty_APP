import { create } from 'zustand';

import type { ProductDraft, ProductSuggestions } from '@/domain/product';

/**
 * The in-progress product draft.
 *
 * This store exists for one specific requirement: when a Free user fills in a form
 * and hits the product limit, the paywall must open *without* discarding what they
 * typed. Losing a user's input to show them a purchase prompt is a hostile pattern
 * and a reliable way to lose the sale as well as the user.
 *
 * The draft therefore survives the paywall sheet, an upgrade round trip, and
 * navigation away and back. It is cleared only on a successful save or an explicit
 * discard.
 */

export type AddMethod = 'manual' | 'receipt' | 'barcode' | 'photo';

type DraftState = {
  draft: Partial<ProductDraft> | null;
  suggestions: ProductSuggestions;
  method: AddMethod;
  /** Document already uploaded for this draft, so a retry doesn't re-upload. */
  pendingDocumentId: string | null;
  setDraft: (draft: Partial<ProductDraft>) => void;
  mergeDraft: (patch: Partial<ProductDraft>) => void;
  setSuggestions: (suggestions: ProductSuggestions) => void;
  setMethod: (method: AddMethod) => void;
  setPendingDocumentId: (id: string | null) => void;
  clear: () => void;
};

export const useDraftStore = create<DraftState>((set) => ({
  draft: null,
  suggestions: {},
  method: 'manual',
  pendingDocumentId: null,

  setDraft: (draft) => set({ draft }),
  mergeDraft: (patch) =>
    set((state) => ({ draft: { ...(state.draft ?? {}), ...patch } })),
  setSuggestions: (suggestions) => set({ suggestions }),
  setMethod: (method) => set({ method }),
  setPendingDocumentId: (pendingDocumentId) => set({ pendingDocumentId }),
  clear: () =>
    set({ draft: null, suggestions: {}, method: 'manual', pendingDocumentId: null }),
}));

/**
 * Turns extraction suggestions into initial form values. Confidence is preserved
 * separately (in `suggestions`) so the form can flag low-confidence fields for
 * review rather than silently accepting them.
 */
export function draftFromSuggestions(
  suggestions: ProductSuggestions,
): Partial<ProductDraft> {
  const draft: Partial<ProductDraft> = {};
  if (suggestions.name) draft.name = suggestions.name.value;
  if (suggestions.brandName) draft.brandName = suggestions.brandName.value;
  if (suggestions.model) draft.model = suggestions.model.value;
  if (suggestions.purchaseDate) draft.purchaseDate = suggestions.purchaseDate.value;
  if (suggestions.retailerName) draft.retailerName = suggestions.retailerName.value;
  if (suggestions.purchasePrice) draft.purchasePrice = suggestions.purchasePrice.value;
  if (suggestions.currency) draft.currency = suggestions.currency.value;
  if (suggestions.warrantyDurationMonths) {
    draft.warrantyDurationMonths = suggestions.warrantyDurationMonths.value;
  }
  return draft;
}
