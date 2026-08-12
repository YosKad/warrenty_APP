import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import type { PlanId } from '@/domain/entitlements';

/**
 * Feature flags.
 *
 * Server-driven, so a capability can be dark-launched, ramped and killed without an
 * app release. Evaluation happens on the device against a fetched rule set: a stable
 * hash of the user id decides the rollout bucket, which means a user's bucket never
 * changes between sessions and a 10% rollout is the same 10% every time.
 */

export type FeatureFlagKey =
  | 'barcode_scan'
  | 'receipt_ocr'
  | 'ai_coverage'
  | 'provider_discovery'
  | 'claim_assistant'
  | 'email_import'
  | 'family_sharing'
  | 'biometric_lock';

export type FeatureFlagRule = {
  key: string;
  enabled: boolean;
  rolloutPercent: number;
  plans: PlanId[] | null;
  minAppVersion: string | null;
};

/**
 * Defaults used before the first fetch and whenever the network is unavailable.
 * Everything optional defaults to off, so a flag fetch failure degrades to the
 * conservative product rather than to a half-built feature.
 */
export const DEFAULT_FLAGS: Record<FeatureFlagKey, boolean> = {
  barcode_scan: false,
  receipt_ocr: false,
  ai_coverage: false,
  provider_discovery: false,
  claim_assistant: false,
  email_import: false,
  family_sharing: false,
  biometric_lock: true,
};

export async function fetchFlags(): Promise<FeatureFlagRule[]> {
  try {
    const { data, error } = await supabase
      .from('feature_flags')
      .select('key, enabled, rollout_percent, plans, min_app_version');
    if (error) throw error;
    return (data ?? []).map((row) => ({
      key: row.key,
      enabled: row.enabled,
      rolloutPercent: row.rollout_percent,
      plans: row.plans,
      minAppVersion: row.min_app_version,
    }));
  } catch (error) {
    logger.warn('feature flag fetch failed; using defaults');
    return [];
  }
}

export function evaluateFlag(
  key: FeatureFlagKey,
  rules: FeatureFlagRule[],
  context: { userId: string; plan: PlanId; appVersion: string },
): boolean {
  const rule = rules.find((r) => r.key === key);
  if (!rule) return DEFAULT_FLAGS[key];
  if (!rule.enabled) return false;
  if (rule.plans && !rule.plans.includes(context.plan)) return false;
  if (rule.minAppVersion && compareVersions(context.appVersion, rule.minAppVersion) < 0) {
    return false;
  }
  if (rule.rolloutPercent >= 100) return true;
  if (rule.rolloutPercent <= 0) return false;
  return bucketFor(context.userId, key) < rule.rolloutPercent;
}

/**
 * Deterministic 0–99 bucket. FNV-1a over `userId:flagKey` — keying on both means a
 * user unlucky in one rollout isn't systematically excluded from every other.
 */
export function bucketFor(userId: string, flagKey: string): number {
  const input = `${userId}:${flagKey}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 100;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
