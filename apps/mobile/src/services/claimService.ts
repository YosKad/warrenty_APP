import { toAppError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { ClaimStatusDb, Database } from '@/types/database';

/**
 * Claims — the record of "something went wrong with this product".
 *
 * A claim opens as a `draft` the moment the user describes a problem, before any
 * analysis. That ordering matters: the user's own account of the fault is the durable
 * artefact, and it survives whether or not the coverage analysis succeeds.
 */

export type Claim = {
  id: string;
  productId: string;
  status: ClaimStatusDb;
  issueDescription: string;
  issueCategory: string | null;
  serviceProviderId: string | null;
  referenceNumber: string | null;
  resolutionNotes: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ClaimMessage = {
  id: string;
  claimId: string;
  author: 'user' | 'system' | 'provider';
  body: string;
  createdAt: string;
};

type ClaimRow = Database['public']['Tables']['claims']['Row'];

export const ISSUE_CATEGORIES = [
  'not_working',
  'physical_damage',
  'intermittent_fault',
  'noise',
  'overheating',
  'battery',
  'display',
  'connectivity',
  'water_damage',
  'other',
] as const;

export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

export async function createClaim(params: {
  productId: string;
  ownerId: string;
  issueDescription: string;
  issueCategory?: IssueCategory;
}): Promise<Claim> {
  try {
    const { data, error } = await supabase
      .from('claims')
      .insert({
        product_id: params.productId,
        owner_id: params.ownerId,
        issue_description: params.issueDescription.trim(),
        issue_category: params.issueCategory ?? null,
        status: 'draft',
      })
      .select('*')
      .single();
    if (error) throw error;
    return toClaim(data as ClaimRow);
  } catch (error) {
    throw toAppError(error);
  }
}

export async function listClaims(productId: string): Promise<Claim[]> {
  try {
    const { data, error } = await supabase
      .from('claims')
      .select('*')
      .eq('product_id', productId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row) => toClaim(row as ClaimRow));
  } catch (error) {
    throw toAppError(error);
  }
}

export async function updateClaimStatus(
  claimId: string,
  status: ClaimStatusDb,
  extra: { referenceNumber?: string; resolutionNotes?: string } = {},
): Promise<Claim> {
  try {
    const { data, error } = await supabase
      .from('claims')
      .update({
        status,
        ...(extra.referenceNumber !== undefined && {
          reference_number: extra.referenceNumber,
        }),
        ...(extra.resolutionNotes !== undefined && {
          resolution_notes: extra.resolutionNotes,
        }),
        ...(isTerminal(status) && { resolved_at: new Date().toISOString() }),
      })
      .eq('id', claimId)
      .select('*')
      .single();
    if (error) throw error;
    return toClaim(data as ClaimRow);
  } catch (error) {
    throw toAppError(error);
  }
}

export async function addClaimNote(params: {
  claimId: string;
  ownerId: string;
  body: string;
}): Promise<void> {
  try {
    const { error } = await supabase.from('claim_messages').insert({
      claim_id: params.claimId,
      owner_id: params.ownerId,
      author: 'user',
      body: params.body.trim().slice(0, 4000),
    });
    if (error) throw error;
  } catch (error) {
    throw toAppError(error);
  }
}

export async function listClaimMessages(claimId: string): Promise<ClaimMessage[]> {
  try {
    const { data, error } = await supabase
      .from('claim_messages')
      .select('id, claim_id, author, body, created_at')
      .eq('claim_id', claimId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: row.id,
      claimId: row.claim_id,
      author: row.author,
      body: row.body,
      createdAt: row.created_at,
    }));
  } catch (error) {
    throw toAppError(error);
  }
}

/**
 * Everything a service provider will ask for, gathered in one place so the user is
 * not hunting through the app mid-phone-call. This is the payload behind the claim
 * assistant's "prepare your information" step.
 */
export type ClaimPacket = {
  productName: string;
  brandName: string | null;
  model: string | null;
  serialNumber: string | null;
  purchaseDate: string | null;
  retailerName: string | null;
  warrantyEnd: string | null;
  issueDescription: string;
  documentIds: string[];
};

export async function buildClaimPacket(
  claimId: string,
): Promise<ClaimPacket | null> {
  try {
    const { data, error } = await supabase
      .from('claims')
      .select(
        `issue_description,
         product:product_id (
           name, model, serial_number, purchase_date, retailer_name, warranty_end, brand_name
         )`,
      )
      .eq('id', claimId)
      .single();
    if (error) throw error;
    const product = Array.isArray(data.product) ? data.product[0] : data.product;
    if (!product) return null;

    const { data: documents } = await supabase
      .from('product_documents')
      .select('id')
      .eq('product_id', (data as unknown as { product_id: string }).product_id ?? '')
      .is('deleted_at', null);

    return {
      productName: product.name,
      brandName: product.brand_name,
      model: product.model,
      serialNumber: product.serial_number,
      purchaseDate: product.purchase_date,
      retailerName: product.retailer_name,
      warrantyEnd: product.warranty_end,
      issueDescription: data.issue_description,
      documentIds: (documents ?? []).map((d) => d.id),
    };
  } catch (error) {
    throw toAppError(error);
  }
}

function isTerminal(status: ClaimStatusDb): boolean {
  return status === 'resolved' || status === 'rejected' || status === 'cancelled';
}

function toClaim(row: ClaimRow): Claim {
  return {
    id: row.id,
    productId: row.product_id,
    status: row.status,
    issueDescription: row.issue_description,
    issueCategory: row.issue_category,
    serviceProviderId: row.service_provider_id,
    referenceNumber: row.reference_number,
    resolutionNotes: row.resolution_notes,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
