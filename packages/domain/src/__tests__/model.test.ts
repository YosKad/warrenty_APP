import { describe, expect, it } from 'vitest';

import {
  compareModels,
  familyKey,
  matchesPattern,
  modelSimilarity,
  ocrVariants,
  parseModel,
  patternSpecificity,
  repairWithOcr,
} from '../model';

const BRANDS = ['Samsung', 'Apple', 'Dyson', 'LG', 'Bosch'];
const parse = (raw: string) => parseModel(raw, { brands: BRANDS });

/** Two strings are the same product. */
const same = (a: string, b: string) => compareModels(parse(a), parse(b));

describe('parseModel', () => {
  it('strips the brand from either end but not from the middle', () => {
    expect(parse('Samsung QE65S95D').tokens).toEqual(['S95D']);
    expect(parse('QE65S95D Samsung').tokens).toEqual(['S95D']);
    // "Galaxy Book" is a product name that happens to contain a brand.
    expect(parse('Samsung Galaxy Book Samsung Edition').tokens).toContain('GALAXY');
  });

  it('pulls the screen size out of a television part code', () => {
    const parsed = parse('QE65S95DATXXH');
    expect(parsed.tokens).toEqual(['S95D']);
    expect(parsed.screenSize).toBe(65);
    expect(parsed.region).toBe('ATXXH');
  });

  it('reads a size written the way a person writes it', () => {
    expect(parse('MacBook Air 13-inch M4').screenSize).toBe(13);
    expect(parse('Samsung S95D 65"').screenSize).toBe(65);
    expect(parse('MacBook Air 13 M4').screenSize).toBe(13);
  });

  it('reads capacity', () => {
    expect(parse('MacBook Air M4 512GB').capacity).toBe('512GB');
    expect(parse('MacBook Air M4 1TB').capacity).toBe('1TB');
  });

  it('gives word order no weight', () => {
    expect(parse('MacBook Air M4').identity).toBe(parse('M4 MacBook Air').identity);
  });

  it('treats every separator the same way', () => {
    const forms = ['MacBook Air M4', 'MacBook-Air-M4', 'MacBook_Air/M4', 'MacBook  Air   M4'];
    expect(new Set(forms.map((form) => parse(form).identity)).size).toBe(1);
  });

  it('survives the invisible characters that arrive with Hebrew exports', () => {
    expect(parse('‏QE65S95D‎').tokens).toEqual(['S95D']);
  });

  it('keeps the raw string untouched', () => {
    expect(parse('  qe65s95d  ').raw).toBe('  qe65s95d  ');
  });

  it('reports an empty identity rather than inventing one', () => {
    expect(parse('').identity).toBe('');
    expect(parse('   ').tokens).toEqual([]);
  });
});

describe('compareModels — the forms that must agree', () => {
  it('resolves every way people write the MacBook Air M4', () => {
    // The regression this phase exists for.
    for (const form of [
      'MacBook Air 13-inch M4',
      'MacBook Air 13 M4',
      'M4 MacBook Air',
      'MacBook Air (M4)',
      'MACBOOK AIR M4',
    ]) {
      expect(same('MacBook Air M4', form)).toBe('exact');
    }
  });

  it('resolves the Samsung television forms', () => {
    expect(same('Samsung QE65S95D', 'QE65S95DATXXH')).toBe('exact');
    expect(same('Samsung QE65S95D', 'S95D')).toBe('exact');
    expect(same('Samsung S95D 65', 'QE65S95D')).toBe('exact');
  });

  it('calls a size difference a variant, not a match and not a miss', () => {
    // Same television, two sizes. Whether the terms are the same is a question
    // about the policy, so the comparison reports the difference instead of
    // deciding.
    expect(same('QE65S95D', 'QE55S95D')).toBe('variant');
  });

  it('treats a size stated on one side only as agreement', () => {
    expect(same('S95D', 'QE65S95D')).toBe('exact');
  });
});

describe('compareModels — false friends that must NOT collapse', () => {
  it('keeps television generations apart', () => {
    expect(same('S95D', 'S95C')).not.toBe('exact');
    expect(same('QE65S95D', 'QE65S95C')).not.toBe('exact');
  });

  it('keeps different Macs with the same chip apart', () => {
    expect(same('MacBook Air M4', 'MacBook Pro M4')).not.toBe('exact');
    expect(same('MacBook Air M4', 'Mac mini M4')).not.toBe('exact');
    expect(same('MacBook Air M4', 'iPad Pro M4')).not.toBe('exact');
  });

  it('keeps chip generations apart', () => {
    expect(same('MacBook Air M4', 'MacBook Air M3')).not.toBe('exact');
  });

  it('does not collapse Dyson variants into one another', () => {
    // V15 Detect Absolute is a member of the V15 line, not the same SKU.
    expect(same('Dyson V15', 'Dyson V15 Detect')).toBe('family');
    expect(same('Dyson V15 Detect', 'Dyson V15 Detect Absolute')).toBe('family');
    expect(same('Dyson V15', 'Dyson V12')).not.toBe('exact');
  });

  it('does not treat two unrelated codes as related', () => {
    expect(same('QE65S95D', 'SV18')).toBe('none');
  });
});

describe('familyKey', () => {
  it('drops the trailing generation letter and nothing else', () => {
    expect(familyKey(parse('S95D'))).toBe('S95');
    expect(familyKey(parse('S95C'))).toBe('S95');
    expect(familyKey(parse('V15'))).toBe('V15');
    expect(familyKey(parse('M4'))).toBe('M4');
  });

  it('is null for a string with no code in it', () => {
    expect(familyKey(parse(''))).toBeNull();
  });
});

describe('OCR', () => {
  it('offers the substitutions an engine actually makes', () => {
    const variants = ocrVariants('S95D');
    expect(variants).toContain('595D');
    expect(variants).toContain('S95O');
  });

  it('offers nothing for a plain word', () => {
    // "Air" was never misread as "A1r" often enough to justify the false
    // matches that tolerance would produce.
    expect(ocrVariants('AIR')).toEqual(['AIR']);
  });

  it('repairs a code when exactly one known model is reachable', () => {
    const repaired = repairWithOcr('QE65595D', ['QE65S95D', 'SV18'], { brands: BRANDS });
    expect(repaired.corrected).toBe('QE65S95D');
    expect(repaired.ambiguous).toBe(false);
  });

  it('refuses to repair when two known models are reachable', () => {
    const repaired = repairWithOcr('S95O', ['S95D', 'S95C', 'S950'], { brands: BRANDS });
    expect(repaired.corrected).toBeNull();
  });

  it('never rewrites the original', () => {
    const repaired = repairWithOcr('QE65595D', ['QE65S95D'], { brands: BRANDS });
    expect(repaired.corrected).toBe('QE65S95D');
    // The parsed input still carries what the camera saw.
    expect(parse('QE65595D').raw).toBe('QE65595D');
  });
});

describe('pattern specificity', () => {
  it('calls a two-character pattern too broad', () => {
    expect(patternSpecificity('%M4%').specific).toBe(false);
    expect(patternSpecificity('M4%').specific).toBe(false);
  });

  it('trusts a pattern with real literals in it', () => {
    expect(patternSpecificity('QE%S95%').specific).toBe(true);
    expect(patternSpecificity('MACBOOKAIRM4').specific).toBe(true);
  });

  it('evaluates LIKE the way the database does', () => {
    expect(matchesPattern('QE65S95DATXXH', 'QE%S95%')).toBe(true);
    expect(matchesPattern('MACBOOKAIRM4', 'M4%')).toBe(false);
    expect(matchesPattern('M4MACBOOKAIR', 'M4%')).toBe(true);
    expect(matchesPattern('qe65s95d', 'QE%')).toBe(true);
  });
});

describe('modelSimilarity', () => {
  it('is 1 for the same tokens in any order', () => {
    expect(modelSimilarity(parse('MacBook Air M4'), parse('M4 Air MacBook'))).toBe(1);
  });

  it('is 0 against nothing', () => {
    expect(modelSimilarity(parse(''), parse('S95D'))).toBe(0);
  });
});
