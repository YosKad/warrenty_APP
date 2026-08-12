/**
 * A single error vocabulary for the whole app.
 *
 * Services translate transport-level failures (Postgres codes, HTTP status, fetch
 * exceptions) into an `AppError` with a stable `code`. The UI maps that code to a
 * translated, human-readable message. Raw backend messages are never rendered —
 * they leak schema details and are not localisable.
 */

export type AppErrorCode =
  | 'network'
  | 'timeout'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'payment_required'
  | 'file_too_large'
  | 'unsupported_file'
  | 'server'
  | 'unknown';

export class AppError extends Error {
  readonly code: AppErrorCode;
  /** i18n key resolved by the UI layer. */
  readonly messageKey: string;
  readonly cause?: unknown;
  /** Extra context for logging — must never contain document contents or PII. */
  readonly meta?: Record<string, string | number | boolean>;

  constructor(
    code: AppErrorCode,
    options: {
      messageKey?: string;
      cause?: unknown;
      meta?: Record<string, string | number | boolean>;
    } = {},
  ) {
    super(options.messageKey ?? `errors.${code}`);
    this.name = 'AppError';
    this.code = code;
    this.messageKey = options.messageKey ?? `errors.${code}`;
    this.cause = options.cause;
    this.meta = options.meta;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** Postgres / PostgREST error codes we care about, mapped to our vocabulary. */
const POSTGREST_CODE_MAP: Record<string, AppErrorCode> = {
  '23505': 'conflict', // unique_violation
  '23503': 'validation', // foreign_key_violation
  '23514': 'validation', // check_violation
  '42501': 'forbidden', // insufficient_privilege (an RLS denial)
  PGRST301: 'unauthenticated', // JWT expired
  PGRST116: 'not_found', // no rows when single() expected one
};

type SupabaseLikeError = { code?: string; message?: string; status?: number };

/**
 * Normalise anything a service catch-block might see into an `AppError`.
 * Always call this before letting an error escape a service module.
 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;

  if (error instanceof TypeError && /network|fetch/i.test(error.message)) {
    return new AppError('network', { cause: error });
  }

  if (typeof error === 'object' && error !== null) {
    const e = error as SupabaseLikeError;
    if (e.code && POSTGREST_CODE_MAP[e.code]) {
      return new AppError(POSTGREST_CODE_MAP[e.code] as AppErrorCode, { cause: error });
    }
    if (typeof e.status === 'number') {
      if (e.status === 401) return new AppError('unauthenticated', { cause: error });
      if (e.status === 402) return new AppError('payment_required', { cause: error });
      if (e.status === 403) return new AppError('forbidden', { cause: error });
      if (e.status === 404) return new AppError('not_found', { cause: error });
      if (e.status === 409) return new AppError('conflict', { cause: error });
      if (e.status === 413) return new AppError('file_too_large', { cause: error });
      if (e.status === 415) return new AppError('unsupported_file', { cause: error });
      if (e.status === 422) return new AppError('validation', { cause: error });
      if (e.status === 429) return new AppError('rate_limited', { cause: error });
      if (e.status >= 500) return new AppError('server', { cause: error });
    }
  }

  return new AppError('unknown', { cause: error });
}
