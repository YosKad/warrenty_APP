import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  CONFLICT_SCORE_MARGIN,
  MATCH_CONFIRM_THRESHOLD,
  MATCH_SIGNALS,
  MATCH_STRONG_THRESHOLD,
  MATCH_TOTAL_WEIGHT,
  MATCH_VERIFIED_THRESHOLD,
} from '../match';
import { SOURCE_PRIORITY } from '../sources';

/**
 * The scoring model exists in two runtimes and must agree in both.
 *
 * `warranty-resolve` runs on Deno inside Supabase and cannot import this
 * package — Edge Function bundling does not reach outside `supabase/functions`.
 * So it carries a transcription, and a comment telling the next person to change
 * both. Comments do not fail builds; this does.
 *
 * The test reads the Deno source as text rather than importing it, because
 * importing it would pull in `npm:zod` and `Deno.serve`.
 */

const denoSource = readFileSync(
  fileURLToPath(new URL('../../../../supabase/functions/warranty-resolve/index.ts', import.meta.url)),
  'utf8',
);

/** Reads `key: 42,` pairs out of a named `const X = { ... }` block. */
function numericRecord(source: string, name: string): Record<string, number> {
  const block = new RegExp(`const ${name}[^=]*=\\s*{([^}]*)}`, 's').exec(source);
  if (!block) throw new Error(`${name} not found in warranty-resolve`);

  const entries: Record<string, number> = {};
  for (const line of block[1]!.split('\n')) {
    const pair = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(\d+)\s*,?\s*$/.exec(line);
    if (pair) entries[pair[1]!] = Number(pair[2]);
  }
  return entries;
}

function numericConst(source: string, name: string): number {
  const match = new RegExp(`const ${name}\\s*=\\s*(\\d+)`).exec(source);
  if (!match) throw new Error(`${name} not found in warranty-resolve`);
  return Number(match[1]);
}

describe('the shared scoring model', () => {
  it('totals exactly 100, so a score has a stated maximum', () => {
    expect(MATCH_TOTAL_WEIGHT).toBe(100);
  });

  it('keeps its thresholds ordered', () => {
    expect(MATCH_CONFIRM_THRESHOLD).toBeLessThan(MATCH_STRONG_THRESHOLD);
    expect(MATCH_STRONG_THRESHOLD).toBeLessThan(MATCH_VERIFIED_THRESHOLD);
  });
});

describe('parity with the Edge Function transcription', () => {
  it('uses the same signal weights', () => {
    const deno = numericRecord(denoSource, 'SIGNAL_WEIGHTS');
    const shared = Object.fromEntries(MATCH_SIGNALS.map((s) => [s.key, s.weight]));
    expect(deno).toEqual(shared);
  });

  it('uses the same source hierarchy', () => {
    expect(numericRecord(denoSource, 'SOURCE_PRIORITY')).toEqual(SOURCE_PRIORITY);
  });

  it('uses the same thresholds', () => {
    expect(numericConst(denoSource, 'STRONG_THRESHOLD')).toBe(MATCH_STRONG_THRESHOLD);
    expect(numericConst(denoSource, 'CONFIRM_THRESHOLD')).toBe(MATCH_CONFIRM_THRESHOLD);
    expect(numericConst(denoSource, 'VERIFIED_THRESHOLD')).toBe(MATCH_VERIFIED_THRESHOLD);
    expect(numericConst(denoSource, 'CONFLICT_SCORE_MARGIN')).toBe(CONFLICT_SCORE_MARGIN);
  });
});
