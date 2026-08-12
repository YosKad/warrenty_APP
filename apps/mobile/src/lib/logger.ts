import { isProduction } from './config';
import { isAppError, type AppError } from './errors';

/**
 * Logging + crash reporting facade.
 *
 * Sentry is wired in through `crashReporting.ts`, which registers a sink here. This
 * indirection keeps the vendor out of every call site and makes the redaction rule
 * enforceable in one place: receipts, warranty documents and OCR text are personal
 * data and must never reach a third-party error service.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogContext = Record<string, string | number | boolean | undefined>;

type Sink = {
  captureException: (error: unknown, context?: LogContext) => void;
  captureMessage: (message: string, level: LogLevel, context?: LogContext) => void;
};

let sink: Sink | null = null;

export function registerLogSink(next: Sink | null): void {
  sink = next;
}

/** Keys whose values are never safe to transmit or print. */
const FORBIDDEN_KEYS = [
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'receipt',
  'receiptText',
  'ocrText',
  'documentText',
  'clauseText',
  'serialNumber',
  'email',
  'address',
  'phone',
];

export function redact(context?: LogContext): LogContext | undefined {
  if (!context) return undefined;
  const safe: LogContext = {};
  for (const [key, value] of Object.entries(context)) {
    const forbidden = FORBIDDEN_KEYS.some((f) =>
      key.toLowerCase().includes(f.toLowerCase()),
    );
    safe[key] = forbidden ? '[redacted]' : value;
  }
  return safe;
}

export const logger = {
  debug(message: string, context?: LogContext) {
    if (!isProduction) {
      // eslint-disable-next-line no-console
      console.log(`[debug] ${message}`, redact(context) ?? '');
    }
  },
  info(message: string, context?: LogContext) {
    if (!isProduction) {
      // eslint-disable-next-line no-console
      console.log(`[info] ${message}`, redact(context) ?? '');
    }
    sink?.captureMessage(message, 'info', redact(context));
  },
  warn(message: string, context?: LogContext) {
    console.warn(`[warn] ${message}`, redact(context) ?? '');
    sink?.captureMessage(message, 'warn', redact(context));
  },
  error(error: unknown, context?: LogContext) {
    const merged: LogContext = { ...redact(context) };
    if (isAppError(error)) {
      const appError = error as AppError;
      merged.errorCode = appError.code;
      Object.assign(merged, redact(appError.meta as LogContext | undefined));
    }
    if (!isProduction) {
      console.error('[error]', error, merged);
    }
    sink?.captureException(error, merged);
  },
};
