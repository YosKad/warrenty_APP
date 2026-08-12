import * as Sentry from '@sentry/react-native';

import { appEnv, config, isProduction } from './config';
import { registerLogSink, redact, type LogContext } from './logger';

/**
 * Crash and error reporting.
 *
 * Sentry is optional: with no DSN configured the app runs normally and nothing is
 * transmitted. When it is enabled, two rules apply and are enforced here rather than
 * left to call sites.
 *
 * 1. No document content, OCR text, warranty clauses or product details in any
 *    event. `beforeSend` strips request bodies and breadcrumb data outright — a
 *    stack trace is useful, a user's receipt is not ours to collect.
 * 2. PII is off (`sendDefaultPii: false`), and the user is identified by uuid only.
 */

export function initCrashReporting(): void {
  if (!config.sentryDsn) return;

  Sentry.init({
    dsn: config.sentryDsn,
    environment: appEnv,
    sendDefaultPii: false,
    // Full traces in development, a sample in production.
    tracesSampleRate: isProduction ? 0.1 : 1.0,
    enableAutoSessionTracking: true,
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.headers;
      }
      if (event.user) {
        event.user = { id: event.user.id };
      }
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((crumb) => ({
          ...crumb,
          data: undefined,
        }));
      }
      return event;
    },
    beforeBreadcrumb(breadcrumb) {
      // Console breadcrumbs can capture logged objects; drop them entirely.
      if (breadcrumb.category === 'console') return null;
      return breadcrumb;
    },
  });

  registerLogSink({
    captureException: (error, context) => {
      Sentry.captureException(error, { extra: redact(context) as Record<string, unknown> });
    },
    captureMessage: (message, level, context) => {
      Sentry.captureMessage(message, {
        level: level === 'warn' ? 'warning' : level,
        extra: redact(context) as Record<string, unknown>,
      });
    },
  });
}

export function identifyUser(userId: string | null): void {
  if (!config.sentryDsn) return;
  Sentry.setUser(userId ? { id: userId } : null);
}

/** Non-fatal instrumentation for the flows most likely to fail in the field. */
export function reportOperationFailure(
  operation: 'ocr' | 'ai_coverage' | 'upload' | 'billing' | 'sync',
  context?: LogContext,
): void {
  if (!config.sentryDsn) return;
  Sentry.captureMessage(`operation_failed:${operation}`, {
    level: 'warning',
    extra: redact(context) as Record<string, unknown>,
  });
}
