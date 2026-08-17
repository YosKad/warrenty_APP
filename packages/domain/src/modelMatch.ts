import {
  compareModels,
  familyKey,
  matchesPattern,
  modelSimilarity,
  parseModel,
  patternSpecificity,
  repairWithOcr,
  type ModelRelation,
  type ParsedModel,
} from './model';
import type { PublicationStatus, VerificationState } from './sources';

/**
 * Staged model matching.
 *
 * Six stages, tried in order of how much they can be trusted, and each one says
 * so out loud. The point of naming them is that "the model matched" is not one
 * fact: an exact hit on a verified alias and a 60% token overlap are both
 * "matched" to a percentage and only one of them should ever reach a user
 * without a person looking first.
 *
 *   A  canonical      the corpus's own name for the product
 *   B  verified alias a researched, reviewed spelling of it
 *   C  normalised     the same string once separators and OCR noise are gone
 *   D  family         same product line, different member
 *   E  pattern        a policy's `model_pattern`, the pre-existing mechanism
 *   F  fuzzy          tokens overlap and nothing structural agrees
 *
 * A, B, C and a *specific* E resolve on their own. D, a broad E, and F produce
 * candidates for review. That split is the whole phase: a wrong automatic match
 * is worse than no match, because the user acts on it.
 */

export type MatchStage = 'canonical' | 'alias' | 'normalised' | 'family' | 'pattern' | 'fuzzy';

/** Whether a stage's answer may be used without a person confirming it. */
export type MatchTrust = 'trusted' | 'probable' | 'weak';

export const STAGE_ORDER: MatchStage[] = [
  'canonical',
  'alias',
  'normalised',
  'family',
  'pattern',
  'fuzzy',
];

export const STAGE_TRUST: Record<MatchStage, MatchTrust> = {
  canonical: 'trusted',
  alias: 'trusted',
  normalised: 'trusted',
  family: 'probable',
  // Overridden per candidate: a specific pattern is trusted, a broad one is not.
  pattern: 'probable',
  fuzzy: 'weak',
};

export type ModelAlias = {
  value: string;
  verification: VerificationState;
  publicationStatus: PublicationStatus;
  sourceId: string | null;
};

export type CanonicalModel = {
  id: string;
  /** The corpus's preferred name, e.g. "Samsung S95D". */
  canonicalModel: string;
  manufacturerName: string | null;
  /** Product line, e.g. "S95". Corpus knowledge, not derived. */
  family: string | null;
  /** "Detect Absolute", "13-inch". Distinguishes members of a line. */
  variant: string | null;
  /** The market-specific part number, e.g. "QE65S95DATXXH". */
  regionalModel: string | null;
  categoryId: string | null;
  aliases: ModelAlias[];
};

/** A policy's `model_pattern`, the mechanism that existed before this phase. */
export type PatternRule = {
  warrantyId: string;
  pattern: string;
};

export type ModelCandidate = {
  stage: MatchStage;
  trust: MatchTrust;
  relation: ModelRelation;
  /** Set for stages A–D and F. */
  model: CanonicalModel | null;
  /** Set for stage E. */
  warrantyId: string | null;
  /** Ordered, human-readable, and shown in the tester rather than a score. */
  evidence: string[];
  score: number;
};

export type Distinguisher =
  | 'model_code'
  | 'serial_number'
  | 'purchase_date'
  | 'screen_size'
  | 'capacity'
  | 'region';

export type ModelResolution = {
  input: ParsedModel;
  state: 'resolved' | 'ambiguous' | 'unresolved';
  /** Only set when `state` is `resolved`. */
  resolved: ModelCandidate | null;
  candidates: ModelCandidate[];
  /** What would settle it, when it is ambiguous. */
  distinguishers: Distinguisher[];
  /** The reasoning, in order, for the tester and the Model Resolver tool. */
  explanation: string[];
  ocr: { corrected: string | null; ambiguous: boolean } | null;
};

export const FUZZY_THRESHOLD = 0.5;

/**
 * Only aliases a person approved count as aliases.
 *
 * A model may suggest one during ingestion — that is useful — but a suggestion
 * that resolves a stranger's warranty is a suggestion pretending to be a fact.
 * Candidates sit in the review queue like every other researched claim.
 */
export function isTrustedAlias(alias: ModelAlias): boolean {
  return (
    (alias.publicationStatus === 'published' || alias.publicationStatus === 'verified') &&
    alias.verification !== 'unverified' &&
    alias.verification !== 'ai_extracted'
  );
}

export function resolveModel(
  rawModel: string,
  models: CanonicalModel[],
  options: { patterns?: PatternRule[]; brands?: string[] } = {},
): ModelResolution {
  const brands = options.brands ?? modelBrands(models);
  const input = parseModel(rawModel, { brands });
  const explanation: string[] = [];

  explanation.push(
    input.normalised
      ? `Read “${rawModel}” as ${describe(input)}`
      : `“${rawModel}” contains nothing that identifies a product`,
  );

  const candidates: ModelCandidate[] = [];
  const parsedCanonical = new Map<string, ParsedModel>();
  const parseFor = (model: CanonicalModel) => {
    let parsed = parsedCanonical.get(model.id);
    if (!parsed) {
      parsed = parseModel(model.canonicalModel, { brands });
      parsedCanonical.set(model.id, parsed);
    }
    return parsed;
  };

  // ---- A. canonical -------------------------------------------------------
  for (const model of models) {
    const relation = compareModels(input, parseFor(model));
    if (relation === 'exact' || relation === 'variant') {
      candidates.push({
        stage: 'canonical',
        trust: relation === 'exact' ? 'trusted' : 'probable',
        relation,
        model,
        warrantyId: null,
        evidence: [
          `Matches the canonical model “${model.canonicalModel}”`,
          ...(relation === 'variant'
            ? [`Differs on ${differingAttributes(input, parseFor(model)).join(' and ')}`]
            : []),
        ],
        score: relation === 'exact' ? 100 : 80,
      });
    }
  }

  // ---- B. verified alias --------------------------------------------------
  for (const model of models) {
    for (const alias of model.aliases) {
      if (!isTrustedAlias(alias)) continue;
      const relation = compareModels(input, parseModel(alias.value, { brands }));
      if (relation !== 'exact') continue;
      candidates.push({
        stage: 'alias',
        trust: 'trusted',
        relation,
        model,
        warrantyId: null,
        evidence: [
          `“${alias.value}” is a ${alias.verification.replace(/_/g, ' ')} alias of “${model.canonicalModel}”`,
          alias.sourceId ? 'Alias carries a source' : 'Alias has no source recorded',
        ],
        score: 95,
      });
    }
  }

  // ---- C. normalised exact, with OCR tolerance ----------------------------
  const knownStrings = models.flatMap((model) => [
    model.canonicalModel,
    ...(model.regionalModel ? [model.regionalModel] : []),
    ...model.aliases.filter(isTrustedAlias).map((alias) => alias.value),
  ]);

  let ocr: ModelResolution['ocr'] = null;
  if (candidates.length === 0 && input.codes.length > 0) {
    const repair = repairWithOcr(rawModel, knownStrings, { brands });
    ocr = { corrected: repair.corrected, ambiguous: repair.ambiguous };

    if (repair.corrected) {
      const repaired = parseModel(repair.corrected, { brands });
      for (const model of models) {
        if (compareModels(repaired, parseFor(model)) === 'exact') {
          candidates.push({
            stage: 'normalised',
            trust: 'trusted',
            relation: 'exact',
            model,
            warrantyId: null,
            evidence: [
              `Reading “${rawModel}” as “${repair.corrected}” — OCR confuses these characters`,
              `Only one known model is reachable that way`,
            ],
            score: 88,
          });
        }
      }
      explanation.push(`OCR repair: “${rawModel}” → “${repair.corrected}”`);
    } else if (repair.ambiguous) {
      explanation.push(
        `OCR repair found more than one possible reading, so none was applied`,
      );
    }
  }

  // ---- D. family ----------------------------------------------------------
  if (!candidates.some((candidate) => candidate.trust === 'trusted')) {
    for (const model of models) {
      const parsed = parseFor(model);
      const declared = model.family?.toUpperCase() ?? null;
      const derived = familyKey(parsed);
      const inputFamily = familyKey(input);
      const same =
        (declared !== null && inputFamily !== null && declared === inputFamily) ||
        (derived !== null && inputFamily !== null && derived === inputFamily) ||
        compareModels(input, parsed) === 'family';

      if (!same) continue;
      candidates.push({
        stage: 'family',
        trust: 'probable',
        relation: 'family',
        model,
        warrantyId: null,
        evidence: [
          `Same product line as “${model.canonicalModel}”${
            model.family ? ` (family ${model.family})` : ''
          }`,
          'Family members can have different terms — a person should confirm',
        ],
        score: 60,
      });
    }
  }

  // ---- E. structured pattern ---------------------------------------------
  for (const rule of options.patterns ?? []) {
    if (!matchesPattern(input.normalised, rule.pattern) && !matchesPattern(rawModel, rule.pattern)) {
      continue;
    }
    const { literals, specific } = patternSpecificity(rule.pattern);
    candidates.push({
      stage: 'pattern',
      trust: specific ? 'trusted' : 'probable',
      relation: 'none',
      model: null,
      warrantyId: rule.warrantyId,
      evidence: specific
        ? [`Matches the policy pattern ${rule.pattern}`]
        : [
            `Matches the policy pattern ${rule.pattern}`,
            `Only ${literals} literal characters — too broad to rely on alone`,
          ],
      score: specific ? 75 : 45,
    });
  }

  // ---- F. fuzzy -----------------------------------------------------------
  if (!candidates.some((candidate) => candidate.trust !== 'weak')) {
    for (const model of models) {
      const similarity = modelSimilarity(input, parseFor(model));
      if (similarity < FUZZY_THRESHOLD) continue;
      candidates.push({
        stage: 'fuzzy',
        trust: 'weak',
        relation: 'none',
        model,
        warrantyId: null,
        evidence: [
          `Shares ${Math.round(similarity * 100)}% of its words with “${model.canonicalModel}”`,
          'Nothing structural agrees — this is a suggestion, not a match',
        ],
        score: Math.round(similarity * 40),
      });
    }
  }

  candidates.sort(
    (a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage) || b.score - a.score,
  );

  return finish(input, candidates, explanation, ocr);
}

function finish(
  input: ParsedModel,
  candidates: ModelCandidate[],
  explanation: string[],
  ocr: ModelResolution['ocr'],
): ModelResolution {
  const trusted = candidates.filter((candidate) => candidate.trust === 'trusted');
  const distinctTargets = new Set(
    trusted.map((candidate) => candidate.model?.id ?? `warranty:${candidate.warrantyId}`),
  );

  if (trusted.length > 0 && distinctTargets.size === 1) {
    const winner = trusted[0]!;
    explanation.push(
      `Stage ${stageLetter(winner.stage)} (${winner.stage}) resolved it: ${winner.evidence[0]}`,
    );
    return {
      input,
      state: 'resolved',
      resolved: winner,
      candidates,
      distinguishers: [],
      explanation,
      ocr,
    };
  }

  if (distinctTargets.size > 1) {
    explanation.push(
      `${distinctTargets.size} different products match with equal confidence — not choosing between them`,
    );
    return {
      input,
      state: 'ambiguous',
      resolved: null,
      candidates,
      distinguishers: distinguishersFor(candidates),
      explanation,
      ocr,
    };
  }

  const probable = candidates.filter((candidate) => candidate.trust === 'probable');
  const probableTargets = new Set(
    probable.map((candidate) => candidate.model?.id ?? `warranty:${candidate.warrantyId}`),
  );

  if (probableTargets.size > 1) {
    explanation.push(
      `${probableTargets.size} plausible products and nothing decisive between them`,
    );
    return {
      input,
      state: 'ambiguous',
      resolved: null,
      candidates,
      distinguishers: distinguishersFor(candidates),
      explanation,
      ocr,
    };
  }

  explanation.push(
    candidates.length === 0
      ? 'No stage produced a candidate'
      : `Best available is a ${candidates[0]!.trust} match at stage ${stageLetter(
          candidates[0]!.stage,
        )} — needs a person`,
  );

  return {
    input,
    state: 'unresolved',
    resolved: null,
    candidates,
    distinguishers: candidates.length > 0 ? distinguishersFor(candidates) : [],
    explanation,
    ocr,
  };
}

/**
 * What to ask for, derived from what actually differs between the candidates.
 *
 * Asking a user for a serial number when the two candidates differ only by
 * screen size wastes their time and ours. Purchase date is always offered when
 * the candidates are different generations, because that is usually the one
 * thing a person can find without getting up.
 */
export function distinguishersFor(candidates: ModelCandidate[]): Distinguisher[] {
  const wanted = new Set<Distinguisher>();
  const models = candidates.map((candidate) => candidate.model).filter(Boolean) as CanonicalModel[];

  const variants = new Set(models.map((model) => model.variant ?? ''));
  const regions = new Set(models.map((model) => model.regionalModel ?? ''));
  const families = new Set(models.map((model) => model.family ?? ''));

  if (regions.size > 1) wanted.add('region');
  if (variants.size > 1) wanted.add('model_code');
  if (families.size > 1 || models.length > 1) {
    wanted.add('model_code');
    wanted.add('purchase_date');
  }
  if (candidates.some((candidate) => candidate.relation === 'variant')) {
    wanted.add('screen_size');
    wanted.add('capacity');
  }
  // The label on the back settles almost everything the rest cannot.
  wanted.add('serial_number');

  return [...wanted];
}

function stageLetter(stage: MatchStage): string {
  return String.fromCharCode(65 + STAGE_ORDER.indexOf(stage));
}

function describe(model: ParsedModel): string {
  const parts = [model.tokens.join(' ') || '—'];
  if (model.screenSize !== null) parts.push(`${model.screenSize}"`);
  if (model.capacity) parts.push(model.capacity);
  if (model.region) parts.push(`region ${model.region}`);
  return parts.join(', ');
}

function differingAttributes(a: ParsedModel, b: ParsedModel): string[] {
  const differences: string[] = [];
  if (a.screenSize !== null && b.screenSize !== null && a.screenSize !== b.screenSize) {
    differences.push(`screen size (${a.screenSize}" vs ${b.screenSize}")`);
  }
  if (a.capacity !== null && b.capacity !== null && a.capacity !== b.capacity) {
    differences.push(`capacity (${a.capacity} vs ${b.capacity})`);
  }
  if (a.region !== null && b.region !== null && a.region !== b.region) {
    differences.push(`market (${a.region} vs ${b.region})`);
  }
  return differences.length > 0 ? differences : ['an attribute neither side states'];
}

/** Brand names worth stripping, taken from the corpus rather than guessed. */
export function modelBrands(models: CanonicalModel[]): string[] {
  return [
    ...new Set(
      models
        .map((model) => model.manufacturerName)
        .filter((name): name is string => Boolean(name)),
    ),
  ];
}
