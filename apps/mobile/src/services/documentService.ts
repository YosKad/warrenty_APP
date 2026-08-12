import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';

import { AppError, toAppError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Database, DocumentKindDb } from '@/types/database';

/**
 * Document upload and retrieval.
 *
 * Files go into a private bucket under `<ownerId>/<productId>/<uuid>.<ext>`. That
 * layout is not cosmetic: the Storage RLS policies authorise on the first path
 * segment, so the path itself is the access control. Signed URLs are minted on
 * demand and expire; nothing is ever public.
 */

const BUCKET = 'documents';
const IMAGE_BUCKET = 'product-images';

/** 25 MB, matching the Postgres check constraint and the bucket configuration. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export type DocumentRecord = {
  id: string;
  productId: string;
  kind: DocumentKindDb;
  fileName: string;
  mimeType: string;
  byteSize: number;
  storagePath: string;
  createdAt: string;
};

type DocumentRow = Database['public']['Tables']['product_documents']['Row'];

export type UploadInput = {
  productId: string;
  ownerId: string;
  localUri: string;
  fileName: string;
  mimeType: string;
  kind: DocumentKindDb;
};

export async function uploadDocument(input: UploadInput): Promise<DocumentRecord> {
  try {
    assertMimeAllowed(input.mimeType);

    // Photographs from a modern phone camera are 4–8 MB and add nothing over a
    // 2000px JPEG for a receipt. Compressing before upload saves the user's data
    // plan and makes OCR faster.
    const prepared = isImage(input.mimeType)
      ? await compressImage(input.localUri)
      : { uri: input.localUri, mimeType: input.mimeType };

    const file = new File(prepared.uri);
    if (!file.exists) throw new AppError('not_found');
    const byteSize = file.size;
    // Checked before reading the bytes, so an oversized file is rejected without
    // first pulling 40 MB into memory.
    if (byteSize > MAX_FILE_BYTES) {
      throw new AppError('file_too_large', { meta: { byteSize } });
    }

    const bytes = await file.bytes();
    // Hash of the file itself, used for duplicate-receipt detection.
    const contentHash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      await file.base64(),
    );

    const extension = extensionFor(prepared.mimeType);
    const storagePath = `${input.ownerId}/${input.productId}/${Crypto.randomUUID()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, bytes, {
        contentType: prepared.mimeType,
        upsert: false,
      });
    if (uploadError) throw uploadError;

    const { data, error } = await supabase
      .from('product_documents')
      .insert({
        product_id: input.productId,
        owner_id: input.ownerId,
        kind: input.kind,
        storage_path: storagePath,
        file_name: input.fileName.slice(0, 200),
        mime_type: prepared.mimeType,
        byte_size: byteSize,
        content_hash: contentHash,
      })
      .select('*')
      .single();

    if (error) {
      // Don't leave an orphaned object behind if the metadata insert is rejected.
      await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => undefined);
      throw error;
    }

    return toDocument(data as DocumentRow);
  } catch (error) {
    throw toAppError(error);
  }
}

export async function listDocuments(productId: string): Promise<DocumentRecord[]> {
  try {
    const { data, error } = await supabase
      .from('product_documents')
      .select('*')
      .eq('product_id', productId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row) => toDocument(row as DocumentRow));
  } catch (error) {
    throw toAppError(error);
  }
}

/**
 * Short-lived signed URL for viewing a document. 5 minutes is long enough to open a
 * PDF and short enough that a leaked URL is worthless.
 */
export async function getSignedUrl(
  storagePath: string,
  expiresInSeconds = 300,
): Promise<string> {
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, expiresInSeconds);
    if (error) throw error;
    if (!data?.signedUrl) throw new AppError('not_found');
    return data.signedUrl;
  } catch (error) {
    throw toAppError(error);
  }
}

export async function deleteDocument(
  documentId: string,
  storagePath: string,
): Promise<void> {
  try {
    const { error } = await supabase
      .from('product_documents')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', documentId);
    if (error) throw error;
    // Storage removal is best-effort; the metadata row is the source of truth and a
    // nightly job reconciles orphans.
    await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => undefined);
  } catch (error) {
    throw toAppError(error);
  }
}

/**
 * Duplicate detection. Returns any existing documents with the same content hash so
 * the UI can *warn* — never auto-delete. A user who deliberately re-uploads a
 * receipt for a second identical product is doing something reasonable.
 */
export async function findDuplicatesByHash(
  contentHash: string,
): Promise<DocumentRecord[]> {
  try {
    const { data, error } = await supabase
      .from('product_documents')
      .select('*')
      .eq('content_hash', contentHash)
      .is('deleted_at', null);
    if (error) throw error;
    return (data ?? []).map((row) => toDocument(row as DocumentRow));
  } catch (error) {
    throw toAppError(error);
  }
}

export async function uploadProductImage(params: {
  ownerId: string;
  productId: string;
  localUri: string;
}): Promise<string> {
  try {
    const compressed = await compressImage(params.localUri, 1400);
    const bytes = await new File(compressed.uri).bytes();
    const storagePath = `${params.ownerId}/${params.productId}/${Crypto.randomUUID()}.jpg`;
    const { error } = await supabase.storage
      .from(IMAGE_BUCKET)
      .upload(storagePath, bytes, {
        contentType: 'image/jpeg',
        upsert: false,
      });
    if (error) throw error;
    return storagePath;
  } catch (error) {
    throw toAppError(error);
  }
}

export async function getProductImageUrl(
  storagePath: string,
  expiresInSeconds = 3600,
): Promise<string | null> {
  const { data } = await supabase.storage
    .from(IMAGE_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  return data?.signedUrl ?? null;
}

// --- helpers ---------------------------------------------------------------

function assertMimeAllowed(mimeType: string): asserts mimeType is AllowedMimeType {
  if (!ALLOWED_MIME_TYPES.includes(mimeType as AllowedMimeType)) {
    throw new AppError('unsupported_file', { meta: { mimeType } });
  }
}

function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

async function compressImage(
  uri: string,
  maxWidth = 2000,
): Promise<{ uri: string; mimeType: 'image/jpeg' }> {
  const context = ImageManipulator.ImageManipulator.manipulate(uri).resize({
    width: maxWidth,
  });
  const rendered = await context.renderAsync();
  // 0.8 keeps receipt text legible for OCR while roughly halving the file size.
  const result = await rendered.saveAsync({
    compress: 0.8,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return { uri: result.uri, mimeType: 'image/jpeg' };
}

function extensionFor(mimeType: string): string {
  switch (mimeType) {
    case 'application/pdf':
      return 'pdf';
    case 'image/png':
      return 'png';
    case 'image/heic':
    case 'image/heif':
      return 'heic';
    case 'image/webp':
      return 'webp';
    default:
      return 'jpg';
  }
}

function toDocument(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    productId: row.product_id,
    kind: row.kind,
    fileName: row.file_name,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    storagePath: row.storage_path,
    createdAt: row.created_at,
  };
}
