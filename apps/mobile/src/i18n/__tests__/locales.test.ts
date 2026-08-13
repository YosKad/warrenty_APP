import en from '../locales/en.json';
import he from '../locales/he.json';

/**
 * Locale parity.
 *
 * The rule the product depends on is "no hard-coded English in a screen", and the
 * failure mode that rule actually produces is a key added to `en.json` and
 * forgotten in `he.json` — which ships silently, because i18next falls back to
 * English rather than throwing. These tests make that a build failure.
 *
 * Plurals are compared by their base key: Hebrew has a `_two` category English
 * does not, and an English `_one` form may legitimately have no Hebrew equivalent
 * beyond `_one`/`_other`, so the contract is "every base key resolves in both
 * languages with at least `_one` and `_other`".
 */

const PLURAL_SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other'];

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      out.set(path, value);
    } else {
      for (const [nested, nestedValue] of flatten(value, path)) {
        out.set(nested, nestedValue);
      }
    }
  }
  return out;
}

/** `product.daysRemaining_one` → `{ base: 'product.daysRemaining', plural: true }`. */
function splitPlural(key: string): { base: string; plural: boolean } {
  for (const suffix of PLURAL_SUFFIXES) {
    if (key.endsWith(suffix)) return { base: key.slice(0, -suffix.length), plural: true };
  }
  return { base: key, plural: false };
}

function placeholders(value: string): Set<string> {
  return new Set(value.match(/\{\{\s*[\w.]+\s*\}\}/g)?.map((m) => m.replace(/\s/g, '')) ?? []);
}

const enFlat = flatten(en as Tree);
const heFlat = flatten(he as Tree);

function groupByBase(flat: Map<string, string>): Map<string, Map<string, string>> {
  const groups = new Map<string, Map<string, string>>();
  for (const [key, value] of flat) {
    const { base } = splitPlural(key);
    const group = groups.get(base) ?? new Map<string, string>();
    group.set(key, value);
    groups.set(base, group);
  }
  return groups;
}

const enGroups = groupByBase(enFlat);
const heGroups = groupByBase(heFlat);

describe('locale parity', () => {
  it('translates every English key into Hebrew', () => {
    const missing = [...enGroups.keys()].filter((base) => !heGroups.has(base));
    expect(missing).toEqual([]);
  });

  it('has no Hebrew keys that no longer exist in English', () => {
    const orphaned = [...heGroups.keys()].filter((base) => !enGroups.has(base));
    expect(orphaned).toEqual([]);
  });

  it('provides both plural categories in each language', () => {
    const incomplete: string[] = [];
    for (const [base, group] of enGroups) {
      const isPlural = [...group.keys()].some((key) => splitPlural(key).plural);
      if (!isPlural) continue;
      for (const [language, groups] of [
        ['en', enGroups],
        ['he', heGroups],
      ] as const) {
        const forms = groups.get(base);
        if (!forms?.has(`${base}_one`) || !forms.has(`${base}_other`)) {
          incomplete.push(`${language}:${base}`);
        }
      }
    }
    expect(incomplete).toEqual([]);
  });

  it('never introduces an interpolation variable Hebrew does not receive', () => {
    // A Hebrew string may legitimately drop `{{count}}` ("נותר יום אחד"), but one
    // that *adds* a variable renders the raw `{{...}}` to the user.
    const invented: string[] = [];
    for (const [base, group] of heGroups) {
      const allowed = new Set<string>();
      for (const value of enGroups.get(base)?.values() ?? []) {
        for (const token of placeholders(value)) allowed.add(token);
      }
      for (const [key, value] of group) {
        for (const token of placeholders(value)) {
          if (!allowed.has(token)) invented.push(`${key}: ${token}`);
        }
      }
    }
    expect(invented).toEqual([]);
  });

  it('has no blank strings in either language', () => {
    const blank = [...enFlat, ...heFlat]
      .filter(([, value]) => value.trim().length === 0)
      .map(([key]) => key);
    expect(blank).toEqual([]);
  });

  it('covers every protection factor with a name and an action', () => {
    // The Protection Score renders `protection.action.<factor>` for whichever
    // factor is missing, so a new factor without copy would render its own key.
    const factors = [
      'purchase_date',
      'warranty_end',
      'proof_of_purchase',
      'warranty_provider',
      'warranty_terms',
      'serial_number',
      'service_provider',
      'model',
    ];
    for (const factor of factors) {
      for (const flat of [enFlat, heFlat]) {
        expect(flat.get(`protection.factor.${factor}`)).toBeTruthy();
        expect(flat.get(`protection.action.${factor}`)).toBeTruthy();
      }
    }
  });
});
