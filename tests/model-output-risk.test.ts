import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { parseRiskFindings, sanitizeRiskFindings } from '../src/core/riskOversightManager.js';
import type { RiskFinding } from '../src/types.js';

/**
 * Classifying what a model said, and what happens when it says something odd.
 *
 * The three oversight advisors — ethics, legal, commercial — return findings
 * carrying a likelihood, an impact and a confidence, and those three numbers
 * feed a score that feeds the operational rating. So this is a classifier whose
 * output becomes a record in a git-tracked file, built from text that is
 * untrusted twice over: it is model output, and the model was reading the
 * repository.
 *
 * The failure mode that matters is not a wrong grade. It is a classifier that
 * **collapses**: every enum coerced to the same safe-looking value, producing a
 * register that is uniformly low risk and therefore ignored. A test asserting
 * "it returns findings" passes throughout. So the assertions here are about
 * *distribution and preservation* — a stated grade survives, an unreadable one
 * does not become a confident one, and the range does not flatten.
 *
 * And the whole path must never throw. An advisor that crashes on a reply takes
 * the assessment with it, and the register then reads as "never assessed" for a
 * reason nobody can see.
 */

const LIKELIHOODS = ['low', 'medium', 'high'] as const;
const IMPACTS = ['low', 'medium', 'high'] as const;
const CONFIDENCES = ['low', 'medium', 'high'] as const;

const finding = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  domain: 'legal',
  title: 'Licence of a bundled dependency is unclear',
  detail: 'The package ships without a LICENSE file.',
  likelihood: 'medium',
  impact: 'high',
  confidence: 'medium',
  evidence: ['package.json'],
  ...over,
});

describe('a stated grade survives sanitisation', () => {
  it('preserves every declared likelihood, impact and confidence', () => {
    // The collapse test. If any enum is being coerced to a default, one of
    // these round trips loses its value and the register flattens.
    for (const likelihood of LIKELIHOODS) {
      for (const impact of IMPACTS) {
        for (const confidence of CONFIDENCES) {
          const [record] = sanitizeRiskFindings([finding({ likelihood, impact, confidence })]);
          expect(record, `${likelihood}/${impact}/${confidence} was dropped entirely`).toBeDefined();
          expect(record!.likelihood).toBe(likelihood);
          expect(record!.impact).toBe(impact);
          expect(record!.confidence).toBe(confidence);
        }
      }
    }
  });

  it('produces the full range of grades from a mixed batch', () => {
    const batch = IMPACTS.map((impact, index) => finding({ impact, title: `Finding ${index}` }));
    const impacts = new Set(sanitizeRiskFindings(batch).map(record => record.impact));
    expect(impacts.size, 'the batch collapsed to a single impact').toBe(IMPACTS.length);
  });

  it('keeps the evidence path that makes a finding checkable', () => {
    const [record] = sanitizeRiskFindings([finding()]);
    expect(record!.evidence).toContain('package.json');
  });
});

describe('an unreadable grade does not become a confident one', () => {
  it('never invents a value outside the declared enums', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            domain: fc.oneof(fc.constantFrom('ethics', 'legal', 'commercial'), fc.string()),
            title: fc.string(),
            detail: fc.string(),
            likelihood: fc.oneof(fc.constantFrom(...LIKELIHOODS), fc.string(), fc.integer(), fc.constant(null)),
            impact: fc.oneof(fc.constantFrom(...IMPACTS), fc.string(), fc.integer(), fc.constant(null)),
            confidence: fc.oneof(fc.constantFrom(...CONFIDENCES), fc.string(), fc.constant(null)),
            evidence: fc.oneof(fc.array(fc.string()), fc.string(), fc.constant(null)),
          }, { requiredKeys: [] }),
          { maxLength: 10 },
        ),
        raw => {
          for (const record of sanitizeRiskFindings(raw)) {
            expect(LIKELIHOODS).toContain(record.likelihood);
            expect(IMPACTS).toContain(record.impact);
            expect(CONFIDENCES).toContain(record.confidence);
            expect(['ethics', 'legal', 'commercial']).toContain(record.domain);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('does not grade an unreadable confidence as high', () => {
    // Confidence discounts the score. Reading a missing one as `high` would
    // make a guess weigh as much as an evidenced finding.
    for (const bad of [undefined, null, '', 'very', 42, {}]) {
      const [record] = sanitizeRiskFindings([finding({ confidence: bad })]);
      if (record) {
        expect(record.confidence, `confidence ${JSON.stringify(bad)}`).not.toBe('high');
      }
    }
  });

  it('rejects a traversing evidence path rather than storing it', () => {
    const [record] = sanitizeRiskFindings([finding({ evidence: ['../../etc/passwd', 'src/ok.ts'] })]);
    expect(record).toBeDefined();
    for (const entry of record!.evidence) {
      expect(entry).not.toContain('..');
    }
  });

  it('gives every finding a distinct id', () => {
    // Ids address transitions. A duplicate means accepting one finding
    // silently accepts another.
    fc.assert(
      fc.property(fc.array(fc.constant(finding()), { maxLength: 8 }), raw => {
        const records = sanitizeRiskFindings(raw);
        expect(new Set(records.map((entry: RiskFinding) => entry.id)).size).toBe(records.length);
      }),
      { numRuns: 100 },
    );
  });
});

describe('reading an advisor reply never throws', () => {
  it('returns an array for any text at all', () => {
    fc.assert(
      fc.property(fc.string(), text => {
        expect(Array.isArray(parseRiskFindings(text))).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('reads a fenced JSON block, which is what models actually emit', () => {
    const reply = [
      'Here is what I found.',
      '```json',
      JSON.stringify([finding()]),
      '```',
      'Let me know if you want more detail.',
    ].join('\n');

    const parsed = parseRiskFindings(reply);
    expect(parsed.length).toBe(1);
    expect(sanitizeRiskFindings(parsed).length).toBe(1);
  });

  it('reads nothing out of prose rather than inventing a finding from it', () => {
    expect(parseRiskFindings('I think there might be a licensing problem somewhere.')).toEqual([]);
  });

  it('returns nothing for a non-string reply', () => {
    for (const value of [undefined, null, 42, {}, []]) {
      expect(parseRiskFindings(value)).toEqual([]);
    }
  });
});
