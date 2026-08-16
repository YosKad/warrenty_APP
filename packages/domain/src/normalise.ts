/**
 * Normalisation for comparison.
 *
 * Every one of these returns a *comparison key*, never a display value. A
 * normalised string is never written back to a record — "סמסונג אלקטרוניקה
 * בע\"מ" is the organisation's name and "סמסונג אלקטרוניקה" is only how we
 * decide whether a spreadsheet row is talking about it.
 *
 * The Hebrew handling matters more than it looks. Israeli company records are
 * full of בע"מ, גרשיים typed as quotes or as U+05F4, and מקף typed three
 * different ways; without folding those, half the corpus duplicates itself.
 */

/** Legal-form suffixes that carry no identifying information. */
const LEGAL_SUFFIXES = [
  'בעמ',
  'בע"מ',
  'ltd',
  'limited',
  'inc',
  'incorporated',
  'llc',
  'gmbh',
  'co',
  'corp',
  'corporation',
  'company',
  'sa',
  'srl',
  'bv',
  'nv',
  'ag',
  'plc',
];

/**
 * Folds a name to a comparison key.
 *
 * Case, diacritics, punctuation and legal form all disappear. Word order does
 * not: "Samsung Israel" and "Israel Samsung" are different companies until a
 * human says otherwise.
 */
export function normaliseName(input: string | null | undefined): string {
  if (!input) return '';

  const folded = input
    .normalize('NFKD')
    // Latin diacritics only. Hebrew niqqud is in the same range as combining
    // marks but is almost never typed in company names, and stripping it here
    // is harmless.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // Geresh and gershayim, and the ASCII lookalikes people actually type.
    .replace(/[׳״'"`‘’“”]/g, '')
    // Every dash, plus the separators that show up in exported spreadsheets.
    .replace(/[‐-―\-_/\\|]/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = folded.split(' ').filter((word) => word && !LEGAL_SUFFIXES.includes(word));
  return words.join(' ');
}

/**
 * Folds a model designation.
 *
 * Manufacturers write the same model as "QN65S95D", "QN65S95DAFXZA" and
 * "QN-65-S95D" across their own documents. Separators go; the alphanumeric
 * sequence stays exactly as it is, because in a model number a digit is never
 * noise.
 */
export function normaliseModel(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Reduces a URL to the thing worth comparing: host without `www`, path without
 * a trailing slash. Query strings and fragments go — a warranty page reached
 * with a tracking parameter is the same page.
 */
export function normaliseUrl(input: string | null | undefined): string {
  if (!input) return '';
  try {
    const url = new URL(input.trim());
    const host = url.host.replace(/^www\./, '').toLowerCase();
    const path = url.pathname.replace(/\/+$/, '');
    return `${host}${path}`;
  } catch {
    return input.trim().toLowerCase();
  }
}

/**
 * Reduces a phone number to comparable digits, defaulting to Israel because
 * that is where the corpus starts.
 *
 * `03-6100000`, `+972 3 6100000` and `972-3-610-0000` are one number. `*3345`
 * is not a number at all in the E.164 sense but is how a large share of Israeli
 * service lines are actually reached, so it is preserved verbatim rather than
 * mangled into digits.
 */
export function normalisePhone(
  input: string | null | undefined,
  defaultCountry = 'IL',
): string {
  if (!input) return '';
  const trimmed = input.trim();

  // Israeli short codes. Keeping the star is the whole identity of the number.
  if (/^\*\d{3,5}$/.test(trimmed)) return trimmed;

  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';

  if (trimmed.startsWith('+')) return `+${digits}`;
  if (defaultCountry === 'IL') {
    if (digits.startsWith('972')) return `+${digits}`;
    if (digits.startsWith('0')) return `+972${digits.slice(1)}`;
  }
  return digits;
}

/** A slug safe for a URL and stable across languages. */
export function slugify(input: string): string {
  const key = normaliseName(input);
  const latin = key.replace(/[^a-z0-9 ]/g, '').trim();
  // A purely Hebrew name has no Latin characters left, and an empty slug is
  // worse than a transliterated-looking one. Fall back to the raw fold.
  const base = latin || key;
  return base.replace(/\s+/g, '-').slice(0, 60) || 'org';
}

/** Two-letter uppercase, or null. Never guesses a country. */
export function normaliseCountry(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(trimmed) ? trimmed : null;
}

/**
 * Parses a spreadsheet date without inventing one.
 *
 * Accepts ISO and the two orderings people actually type. An ambiguous
 * `03/04/2025` is read day-first, because the corpus is Israeli and that is
 * what an Israeli operator means — a decision recorded here rather than
 * scattered through the importer.
 */
export function parseSheetDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const value = String(input).trim();
  if (!value) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) return isRealDate(value) ? value : null;

  const slashed = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(value);
  if (slashed) {
    const day = slashed[1]!.padStart(2, '0');
    const month = slashed[2]!.padStart(2, '0');
    const candidate = `${slashed[3]}-${month}-${day}`;
    return isRealDate(candidate) ? candidate : null;
  }

  return null;
}

function isRealDate(iso: string): boolean {
  const parsed = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso;
}

/**
 * Reads a whole number of months, or nothing.
 *
 * Accepts "24", "24 months", "שנתיים"-free plain years like "2 years". Returns
 * null on anything it cannot read, which the importer turns into a row error
 * rather than a silent 12.
 */
export function parseDurationMonths(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const value = String(input).trim().toLowerCase();
  if (!value) return null;

  const years = /^(\d+(?:\.\d+)?)\s*(years?|yrs?|שנים|שנה)$/.exec(value);
  if (years) {
    const months = Number(years[1]) * 12;
    return Number.isInteger(months) && months > 0 ? months : null;
  }

  const months = /^(\d+)\s*(months?|mos?|חודשים|חודש)?$/.exec(value);
  if (months) {
    const n = Number(months[1]);
    return n > 0 && n <= 1200 ? n : null;
  }

  return null;
}
