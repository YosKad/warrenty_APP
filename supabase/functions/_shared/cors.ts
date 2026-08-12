/**
 * Shared HTTP helpers for Edge Functions.
 *
 * Every function returns errors in the same envelope: a stable machine-readable
 * `code` and nothing else. Postgres messages, stack traces and provider responses
 * never cross the boundary — they leak schema and vendor details, and the client
 * cannot localise them anyway.
 */

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-scheduler-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export type ErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'rate_limited'
  | 'payment_required'
  | 'conflict'
  | 'server';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  unauthenticated: 401,
  payment_required: 402,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  validation: 422,
  rate_limited: 429,
  server: 500,
};

export function errorResponse(code: ErrorCode): Response {
  return jsonResponse({ error: code }, STATUS_BY_CODE[code]);
}

export function handlePreflight(request: Request): Response | null {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  return null;
}
