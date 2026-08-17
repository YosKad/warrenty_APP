/**
 * Model identity.
 *
 * The question this file answers is "are these two strings the same product",
 * asked of things people actually type and OCR actually produces:
 *
 *   MacBook Air M4 · MacBook Air 13-inch M4 · MBA M4 · M4 MacBook Air
 *   Samsung QE65S95D · S95D · QE65S95DATXXH · Samsung S95D 65"
 *
 * Everything here is deterministic. A model can be parsed, compared and
 * explained without a network call, a database or a model — which is what lets
 * the same answer come out of the phone, the console and the importer, and what
 * makes a wrong answer reproducible instead of mysterious.
 *
 * Two rules shape the whole design.
 *
 * **Nothing collapses on a guess.** `S95D` and `S95C` are one character apart
 * and are different television generations with different terms. Anything this
 * file cannot distinguish structurally, it reports as *ambiguous* rather than
 * picking. A wrong automatic match is worse than no match: the user acts on it.
 *
 * **Product knowledge lives in the corpus, not here.** There is no table
 * mapping "MBA" to "MacBook Air" in this file, because that is a fact about
 * Apple that somebody has to research and a reviewer has to approve. What lives
 * here is *structure*: how separators work, where a screen size hides inside a
 * Samsung part code, which characters OCR confuses. Structure is the same for
 * every manufacturer; product knowledge is not.
 */

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export type ParsedModel = {
  /** Exactly what arrived. Never overwritten — this is what "view source" shows. */
  raw: string;
  /** Uppercase, separators and punctuation gone. The comparison string. */
  normalised: string;
  /** Meaningful tokens, in the order they appeared. */
  tokens: string[];
  /**
   * The tokens that identify the product, sorted, joined.
   *
   * Sorted because "MacBook Air M4" and "M4 MacBook Air" are the same product
   * written by two people. Descriptors — screen size, capacity, region — are
   * *not* in here; they are extracted separately so a match can say whether it
   * ignored them.
   */
  identity: string;
  /** Tokens that look like manufacturer part codes: letters and digits mixed. */
  codes: string[];
  /** Inches, from `13-inch`, `65"`, or the size embedded in a TV part code. */
  screenSize: number | null;
  /** `512GB`, `1TB`. */
  capacity: string | null;
  /** A trailing regional suffix on a structured code — `ATXXH`, `FXZA`. */
  region: string | null;
  /** Brand name found at the start or end, if it was included. */
  brand: string | null;
};

/**
 * Words that describe a product without identifying it.
 *
 * Removing them is what makes `MacBook Air 13-inch M4` and `MacBook Air M4` the
 * same identity. Deliberately short: every word added here is a word two
 * different products could be distinguished by, and the cost of being wrong is
 * a false match.
 */
const DESCRIPTORS = new Set([
  'INCH',
  'INCHES',
  'IN',
  'CM',
  'GEN',
  'GENERATION',
  'MODEL',
  'SERIES',
  'EDITION',
  'THE',
  'WITH',
  'AND',
]);

/** Separators people and exporters use interchangeably. */
const SEPARATORS = /[\s\-–—_/\\|,.:;()[\]{}+*·×"'`״׳]+/g;

const SIZE_SUFFIX = /^(\d{2}(?:\.\d)?)(?:INCH|INCHES|IN|")$/;
const CAPACITY = /^(\d+)(GB|TB|MB)$/;

/**
 * Structured part codes with a size in the middle.
 *
 * Television model codes are built this way across manufacturers: a market
 * prefix, two digits of diagonal, the series, then a regional suffix that
 * varies by country and carries no product meaning.
 *
 *   QE 65 S95D ATXXH   →  prefix QE, 65", series S95D, region ATXXH
 *   QN 65 S95D AFXZA   →  the same television, sold in North America
 *
 * The prefixes are structural, not a product database: they are how the code is
 * laid out, and getting the layout wrong just means the code stays whole.
 */
const TV_CODE = /^(QE|QN|UE|UN|GQ|KQ|KE|OLED|TQ)(\d{2})([A-Z]+\d+[A-Z]?)([A-Z]{2,6})?$/;

/**
 * Splits a raw model string into the parts that identify a product and the
 * parts that describe it.
 *
 * `brands` are stripped when they lead or trail — "Samsung QE65S95D" and
 * "QE65S95D" are the same model — and the caller supplies them because which
 * strings are brand names is corpus knowledge.
 */
export function parseModel(raw: string, options: { brands?: string[] } = {}): ParsedModel {
  const cleaned = (raw ?? '')
    // NFKC folds fullwidth characters and the compatibility forms that arrive
    // from Asian-market exports; the second strip removes bidi controls, which
    // are invisible and would otherwise become part of a token.
    .normalize('NFKC')
    .replace(/[‎‏‪-‮⁦-⁩]/g, '')
    .toUpperCase();

  const brandSet = new Set((options.brands ?? []).map((brand) => brand.toUpperCase()));

  let tokens = cleaned
    .replace(SEPARATORS, ' ')
    .split(' ')
    .filter(Boolean);

  // A brand at either end is context, not identity. In the middle it might be
  // part of a product name ("Samsung Galaxy Book"), so it stays.
  let brand: string | null = null;
  while (tokens.length > 1 && brandSet.has(tokens[0]!)) {
    brand = brand ?? tokens[0]!;
    tokens = tokens.slice(1);
  }
  while (tokens.length > 1 && brandSet.has(tokens[tokens.length - 1]!)) {
    brand = brand ?? tokens[tokens.length - 1]!;
    tokens = tokens.slice(0, -1);
  }

  let screenSize: number | null = null;
  let capacity: string | null = null;
  let region: string | null = null;

  const identityTokens: string[] = [];
  const codes: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;

    if (DESCRIPTORS.has(token)) continue;

    const sized = SIZE_SUFFIX.exec(token);
    if (sized) {
      screenSize = screenSize ?? Number(sized[1]);
      continue;
    }

    const capacityMatch = CAPACITY.exec(token);
    if (capacityMatch) {
      capacity = capacity ?? `${capacityMatch[1]}${capacityMatch[2]}`;
      continue;
    }

    // A bare two-digit number next to a descriptor, or at the end of a
    // television name: `Samsung S95D 65`, `MacBook Air 13 M4`.
    if (/^\d{2}$/.test(token)) {
      const next = tokens[index + 1];
      if (screenSize === null && (next === undefined || DESCRIPTORS.has(next))) {
        screenSize = Number(token);
        continue;
      }
      if (screenSize === null && Number(token) >= 10 && Number(token) <= 99) {
        screenSize = Number(token);
        continue;
      }
    }

    const tv = TV_CODE.exec(token);
    if (tv) {
      screenSize = screenSize ?? Number(tv[2]);
      region = region ?? tv[4] ?? null;
      const core = tv[3]!;
      identityTokens.push(core);
      codes.push(core);
      continue;
    }

    if (looksLikeCode(token)) codes.push(token);
    identityTokens.push(token);
  }

  return {
    raw,
    normalised: identityTokens.join(''),
    tokens: identityTokens,
    identity: [...identityTokens].sort().join(' '),
    codes,
    screenSize,
    capacity,
    region,
    brand,
  };
}

/**
 * Letters and digits mixed — a part number rather than a word.
 *
 * Two characters is enough because chip names are this short and are the
 * identity of the product: `M4` in "MacBook Air M4" is doing all the work.
 */
export function looksLikeCode(token: string): boolean {
  return token.length >= 2 && /[A-Z]/.test(token) && /\d/.test(token);
}

// ---------------------------------------------------------------------------
// OCR
// ---------------------------------------------------------------------------

/**
 * Characters an OCR engine confuses, in both directions.
 *
 * Only applied inside structured codes, and only to generate *candidates* for
 * comparison against models the corpus already knows. Nothing here rewrites a
 * stored value: the original OCR text is what the user photographed, and a
 * silent correction that guesses wrong is unfindable afterwards.
 */
const CONFUSABLE: Record<string, string[]> = {
  // D/O/0 is the trio that actually costs matches on television part codes,
  // where a trailing letter is the generation: S95D read as S950 is both a
  // plausible misreading and a different product.
  O: ['0', 'D'],
  '0': ['O', 'D'],
  D: ['0', 'O'],
  I: ['1', 'L'],
  '1': ['I', 'L'],
  L: ['1', 'I'],
  S: ['5'],
  '5': ['S'],
  B: ['8'],
  '8': ['B'],
  Z: ['2'],
  '2': ['Z'],
  G: ['6'],
  '6': ['G'],
};

/** How many substitutions we are willing to consider. */
export const MAX_OCR_SUBSTITUTIONS = 2;

/**
 * The strings this token might have been before OCR read it.
 *
 * Bounded on purpose: at most two substitutions, and only for tokens that look
 * like part codes. A word gets no variants at all, because "Air" was not
 * misread as "A1r" often enough to justify the false matches that would follow.
 */
export function ocrVariants(token: string, max = MAX_OCR_SUBSTITUTIONS): string[] {
  if (!looksLikeCode(token)) return [token];

  let frontier = [token];
  const seen = new Set(frontier);

  for (let round = 0; round < max; round += 1) {
    const next: string[] = [];
    for (const candidate of frontier) {
      for (let index = 0; index < candidate.length; index += 1) {
        for (const replacement of CONFUSABLE[candidate[index]!] ?? []) {
          const variant =
            candidate.slice(0, index) + replacement + candidate.slice(index + 1);
          if (!seen.has(variant)) {
            seen.add(variant);
            next.push(variant);
          }
        }
      }
    }
    frontier = next;
    // A combinatorial explosion here would make matching slow and, worse, make
    // a false match likely — a long enough code can reach almost anything.
    if (seen.size > 400) break;
  }

  return [...seen];
}

/**
 * Repairs an OCR'd model against models the corpus knows.
 *
 * Returns a correction only when exactly one known model is reachable. Two
 * reachable models means the reading is ambiguous, and the honest output is the
 * original string plus that fact.
 */
export function repairWithOcr(
  raw: string,
  known: string[],
  options: { brands?: string[] } = {},
): { corrected: string | null; ambiguous: boolean; considered: number } {
  const parsed = parseModel(raw, options);
  if (parsed.codes.length === 0) return { corrected: null, ambiguous: false, considered: 0 };

  // Keyed by normalised identity, first spelling wins. Two known strings that
  // normalise to the same thing are one product written twice — `QE65S95D` and
  // `QE55S95D` are the same television in two sizes — and counting that as
  // ambiguity would refuse a repair that is not actually in doubt.
  const index = new Map<string, string>();
  for (const model of known) {
    const key = parseModel(model, options).normalised;
    if (key && !index.has(key)) index.set(key, model);
  }

  const hits = new Set<string>();
  let considered = 0;

  // Substitute within each code token, keeping the rest of the string as read,
  // then parse the result. Parsing again matters: a corrected part code may now
  // be recognisable as a structured one, and `QE65S95D` only equals `S95D` once
  // the market prefix and the diagonal have been pulled back out of it.
  for (const code of parsed.codes) {
    for (const variant of ocrVariants(code)) {
      considered += 1;
      const rebuilt = parsed.tokens.map((token) => (token === code ? variant : token)).join(' ');
      const hit = index.get(parseModel(rebuilt, options).normalised);
      if (hit) hits.add(hit);
    }
  }

  if (hits.size === 1) return { corrected: [...hits][0]!, ambiguous: false, considered };
  return { corrected: null, ambiguous: hits.size > 1, considered };
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/**
 * How closely two parsed models agree.
 *
 * `variant` is the interesting one: same product line, different size or
 * capacity or market. Whether that is the same warranty is a question about the
 * policy, not about the strings — so it is reported rather than decided.
 */
export type ModelRelation = 'exact' | 'variant' | 'family' | 'none';

export function compareModels(a: ParsedModel, b: ParsedModel): ModelRelation {
  if (a.identity === '' || b.identity === '') return 'none';

  if (a.identity === b.identity) {
    const sizesDisagree =
      a.screenSize !== null && b.screenSize !== null && a.screenSize !== b.screenSize;
    const capacitiesDisagree =
      a.capacity !== null && b.capacity !== null && a.capacity !== b.capacity;
    // A size stated on one side and absent on the other is not a disagreement:
    // "S95D" is how people write the television they own.
    return sizesDisagree || capacitiesDisagree ? 'variant' : 'exact';
  }

  // One identity contained in the other is a *family* relationship, never an
  // exact one. "Dyson V15" and "Dyson V15 Detect" are two products, and the
  // second is not a longer way of writing the first — which is exactly the
  // trap a containment-means-equal rule falls into. The cases that genuinely
  // need to agree ("MacBook Air 13-inch M4") already do, because the extra
  // words there are descriptors and were removed during parsing.
  const aTokens = new Set(a.tokens);
  const bTokens = new Set(b.tokens);
  const smaller = aTokens.size <= bTokens.size ? aTokens : bTokens;
  const larger = smaller === aTokens ? bTokens : aTokens;
  if ([...smaller].every((token) => larger.has(token))) return 'family';

  if (familyKey(a) !== null && familyKey(a) === familyKey(b)) return 'family';
  return 'none';
}

/**
 * The family a model belongs to, derived structurally.
 *
 * `S95D` → `S95`; `V15` → `V15`; `M4` → `M4`. The trailing generation letter is
 * dropped and nothing else is, because that is the one suffix convention that
 * holds across manufacturers. Anything richer is corpus knowledge and belongs in
 * `product_models.family`.
 */
export function familyKey(model: ParsedModel): string | null {
  // Only a code has a structural family. "MacBook Air" is a family too, but
  // that is a fact about Apple's naming rather than about the string, so it
  // comes from `product_models.family` and not from here — deriving it would
  // make every MacBook one family and every Galaxy another.
  const code = model.codes[0];
  if (!code) return null;
  const stripped = /^([A-Z]+\d+)[A-Z]$/.exec(code);
  return stripped ? stripped[1]! : code;
}

/**
 * Token overlap, for the last-resort stage only.
 *
 * Never enough to resolve on its own — a value above the threshold produces a
 * candidate for a person, not an answer for a user.
 */
export function modelSimilarity(a: ParsedModel, b: ParsedModel): number {
  const left = new Set(a.tokens);
  const right = new Set(b.tokens);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/**
 * Whether a SQL `LIKE` pattern is specific enough to be trusted on its own.
 *
 * `%M4%` matches every M4 Mac ever made and would resolve a Mac mini to a
 * MacBook Air's terms. The count is of literal characters, because that is what
 * a pattern actually constrains.
 */
export const MIN_SPECIFIC_PATTERN_LITERALS = 4;

export function patternSpecificity(pattern: string): {
  literals: number;
  specific: boolean;
} {
  const literals = pattern.replace(/[%_]/g, '').replace(/[^A-Za-z0-9]/g, '').length;
  return { literals, specific: literals >= MIN_SPECIFIC_PATTERN_LITERALS };
}

/** `ILIKE`, evaluated here so the console and the app agree with the database. */
export function matchesPattern(value: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expression = `^${escaped.replace(/%/g, '.*').replace(/_/g, '.')}$`;
  return new RegExp(expression, 'i').test(value);
}
