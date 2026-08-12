import { logger } from './logger';

/**
 * Product analytics.
 *
 * Two constraints shape this module.
 *
 * 1. The event vocabulary is a closed union. You cannot log an event that isn't
 *    declared here, and each event's properties are typed — which stops the usual
 *    drift where the same action is logged three different ways.
 *
 * 2. No warranty content, document text, product names, serial numbers, prices or
 *    free text ever leaves as a property. Events carry counts, enums and booleans.
 *    Knowing a user scanned a receipt is useful; knowing what the receipt said is
 *    surveillance.
 */

export type AnalyticsEvent =
  | { name: 'signup_completed'; props: { method: 'email' | 'apple' | 'google' } }
  | { name: 'onboarding_completed'; props: { skipped: boolean } }
  | {
      name: 'product_added';
      props: { method: 'manual' | 'receipt' | 'barcode' | 'photo'; hasWarrantyEnd: boolean };
    }
  | { name: 'product_deleted'; props: Record<string, never> }
  | { name: 'receipt_scanned'; props: { source: 'camera' | 'gallery' | 'file' } }
  | { name: 'product_detected'; props: { accepted: boolean; confidenceBand: string } }
  | { name: 'warranty_detected'; props: { source: string; confidenceBand: string } }
  | { name: 'warranty_confirmed'; props: { edited: boolean } }
  | { name: 'warranty_alert_opened'; props: { daysRemaining: number } }
  | { name: 'problem_reported'; props: { category: string } }
  | { name: 'coverage_analysis_completed'; props: { verdict: string; confidenceBand: string } }
  | { name: 'claim_started'; props: Record<string, never> }
  | { name: 'paywall_viewed'; props: { trigger: 'product_limit' | 'ai_coverage' | 'smart_scan' | 'profile' } }
  | { name: 'subscription_started'; props: { plan: string; period: string } }
  | { name: 'subscription_upgraded'; props: { from: string; to: string } }
  | { name: 'subscription_cancelled'; props: { plan: string } }
  | { name: 'purchases_restored'; props: { found: number } }
  | { name: 'search_performed'; props: { resultCount: number } }
  | { name: 'export_requested'; props: Record<string, never> }
  | { name: 'account_deleted'; props: Record<string, never> };

type Sink = (name: string, props: Record<string, unknown>) => void;

let sink: Sink | null = null;
let optedIn = true;

export function registerAnalyticsSink(next: Sink | null): void {
  sink = next;
}

/** Mirrors `user_profiles.analytics_opt_in`. Opting out stops collection immediately. */
export function setAnalyticsOptIn(value: boolean): void {
  optedIn = value;
}

export function track<E extends AnalyticsEvent>(event: E): void {
  if (!optedIn) return;
  try {
    sink?.(event.name, event.props as Record<string, unknown>);
    logger.debug(`analytics: ${event.name}`);
  } catch {
    // Analytics must never be able to break a user flow.
  }
}
