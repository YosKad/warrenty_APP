import {
  confidenceBand,
  needsClarification,
  parseCoverageAnalysis,
  verdictTone,
} from '../coverage';

/**
 * Model output is untrusted input. These tests pin the two behaviours that keep a
 * bad response from becoming a confident, wrong answer on screen: strict schema
 * validation, and the demotion of an ungrounded "likely covered".
 */

const valid = {
  verdict: 'likely_covered',
  confidence: 0.86,
  summary: 'Manufacturing defects in the display panel appear to be covered.',
  reasoningSummary: 'The fault described matches the panel defect clause.',
  relevantClauses: [
    {
      clauseId: '8f2f2c6e-1f2a-4c3e-9a1f-2b3c4d5e6f70',
      section: 'What is covered',
      excerpt: 'Defects in materials and workmanship of the display panel.',
      relevance: 0.91,
    },
  ],
  exclusions: ['Physical damage', 'Unauthorised repair'],
  recommendedAction: 'Contact the authorised service centre with your receipt.',
  disclaimer: 'coverage.disclaimer',
};

describe('parseCoverageAnalysis', () => {
  it('accepts a well-formed analysis object', () => {
    const result = parseCoverageAnalysis(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.analysis.verdict).toBe('likely_covered');
      expect(result.analysis.relevantClauses).toHaveLength(1);
    }
  });

  it('accepts a JSON string and a fenced code block', () => {
    expect(parseCoverageAnalysis(JSON.stringify(valid)).ok).toBe(true);
    expect(
      parseCoverageAnalysis('```json\n' + JSON.stringify(valid) + '\n```').ok,
    ).toBe(true);
  });

  it('rejects non-JSON output', () => {
    const result = parseCoverageAnalysis('I think it is probably covered!');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toMatch(/not valid JSON/i);
  });

  it('rejects an unknown verdict rather than guessing at it', () => {
    const result = parseCoverageAnalysis({ ...valid, verdict: 'definitely_covered' });
    expect(result.ok).toBe(false);
  });

  it('rejects a confidence outside 0–1', () => {
    expect(parseCoverageAnalysis({ ...valid, confidence: 1.4 }).ok).toBe(false);
    expect(parseCoverageAnalysis({ ...valid, confidence: -0.1 }).ok).toBe(false);
  });

  it('rejects a missing summary', () => {
    const { summary: _omitted, ...withoutSummary } = valid;
    expect(parseCoverageAnalysis(withoutSummary).ok).toBe(false);
  });

  it('demotes "likely covered" when no clause supports it', () => {
    // An ungrounded confident verdict is precisely the failure this product cannot
    // ship. It is downgraded rather than displayed as-is.
    const result = parseCoverageAnalysis({ ...valid, relevantClauses: [] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.analysis.verdict).toBe('possibly_covered');
      expect(result.analysis.confidence).toBeLessThanOrEqual(0.5);
    }
  });

  it('leaves a negative verdict alone when it has no clauses', () => {
    const result = parseCoverageAnalysis({
      ...valid,
      verdict: 'likely_not_covered',
      relevantClauses: [],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.analysis.verdict).toBe('likely_not_covered');
  });

  it('defaults optional collections rather than leaving them undefined', () => {
    const minimal = {
      verdict: 'insufficient_information',
      confidence: 0.2,
      summary: 'Not enough information to assess this.',
      disclaimer: 'coverage.disclaimer',
    };
    const result = parseCoverageAnalysis(minimal);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.analysis.exclusions).toEqual([]);
      expect(result.analysis.relevantClauses).toEqual([]);
      expect(result.analysis.recommendedAction).toBe('');
    }
  });

  it('rejects an over-long summary instead of truncating silently', () => {
    expect(parseCoverageAnalysis({ ...valid, summary: 'x'.repeat(700) }).ok).toBe(false);
  });
});

describe('presentation helpers', () => {
  it('bands confidence into three levels', () => {
    expect(confidenceBand(0.9)).toBe('high');
    expect(confidenceBand(0.75)).toBe('high');
    expect(confidenceBand(0.6)).toBe('medium');
    expect(confidenceBand(0.45)).toBe('medium');
    expect(confidenceBand(0.2)).toBe('low');
  });

  it('maps each verdict to a distinct tone', () => {
    expect(verdictTone('likely_covered')).toBe('success');
    expect(verdictTone('possibly_covered')).toBe('warning');
    expect(verdictTone('likely_not_covered')).toBe('danger');
    expect(verdictTone('insufficient_information')).toBe('info');
  });
});

/**
 * Phase G additions. A result that asks a question instead of guessing is a
 * better result, but only if the app can tell the difference — and a photo the
 * model never received must never be reported as one it looked at.
 */
describe('clarification and attachments', () => {
  it('accepts follow-up questions on an insufficient-information verdict', () => {
    const result = parseCoverageAnalysis({
      ...valid,
      verdict: 'insufficient_information',
      confidence: 0.2,
      relevantClauses: [],
      followUpQuestions: [
        {
          id: 'impact',
          question: 'Did the line appear after the screen was knocked or pressed?',
          options: ['After an impact', 'It appeared on its own', "I'm not sure"],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(needsClarification(result.analysis)).toBe(true);
      expect(result.analysis.followUpQuestions[0]?.options).toHaveLength(3);
    }
  });

  it('does not treat a plain insufficient verdict as a clarification request', () => {
    const result = parseCoverageAnalysis({
      ...valid,
      verdict: 'insufficient_information',
      relevantClauses: [],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(needsClarification(result.analysis)).toBe(false);
  });

  it('never treats a confident verdict as a clarification request', () => {
    const result = parseCoverageAnalysis({
      ...valid,
      followUpQuestions: [{ id: 'q', question: 'Anything else?', options: [] }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(needsClarification(result.analysis)).toBe(false);
  });

  it('carries missing information as a list the user can act on', () => {
    const result = parseCoverageAnalysis({
      ...valid,
      missingInformation: ['The purchase date', 'A photo of the fault'],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.analysis.missingInformation).toHaveLength(2);
  });

  it('defaults to attachments not analysed', () => {
    // The default has to be false. A default of true would mean a forgotten flag
    // becomes the app claiming to have looked at a photo it never received.
    const result = parseCoverageAnalysis(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.analysis.attachmentsAnalysed).toBe(false);
      expect(result.analysis.attachmentCount).toBe(0);
      expect(result.analysis.followUpQuestions).toEqual([]);
      expect(result.analysis.missingInformation).toEqual([]);
    }
  });

  it('rejects more follow-up questions than a person will answer', () => {
    const result = parseCoverageAnalysis({
      ...valid,
      followUpQuestions: Array.from({ length: 4 }, (_, i) => ({
        id: `q${i}`,
        question: 'Why?',
        options: [],
      })),
    });
    expect(result.ok).toBe(false);
  });
});
