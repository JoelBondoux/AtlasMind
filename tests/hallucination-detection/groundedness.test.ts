import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import {
  sanitizeIncomingFindings,
  sanitizeResearchRegister,
  parseResearchFindings,
  seedResearchRegister,
  MAX_CITATIONS_PER_FINDING,
} from '../../src/core/researchRegister.js';
import { parseRiskFindings, sanitizeRiskFindings } from '../../src/core/riskOversightManager.js';

/**
 * Groundedness: a claim only becomes a record if something outside the model
 * backs it.
 *
 * The individual gates already have hand-written cases
 * (`tests/core/researchRegister.test.ts`). What those cannot show is that the
 * gate holds for output nobody thought to write down — and a model asked about
 * a market answers *fluently and specifically* whether or not it looked
 * anything up, which is exactly the input a hand-written case is least likely
 * to imitate. So these are generative: the property is stated once and checked
 * against hundreds of shapes of plausible-looking nonsense.
 *
 * Two properties, and the second is the one that matters. Not throwing keeps
 * the feature working; refusing to *promote* an uncited claim keeps a hunch out
 * of a git-tracked file where a later reader cannot tell it from research.
 */

const NOW = new Date('2026-01-01T00:00:00.000Z');

/** Text a model might emit — including the shapes that break naive parsers. */
const modelText = fc.oneof(
  fc.string(),
  fc.constant(''),
  fc.constant('   '),
  fc.string({ unit: 'grapheme' }),
  // Control characters, which must be stripped rather than stored.
  fc.constant('a [31m bc'),
  fc.constant('```json\n[{"title":"x"}]\n```'),
);

/** A citation-shaped value, valid or otherwise. */
const citationish = fc.oneof(
  fc.webUrl({ validSchemes: ['https'] }),
  fc.webUrl({ validSchemes: ['http'] }),
  fc.constant('ftp://example.com/x'),
  fc.constant('javascript:alert(1)'),
  fc.constant('not a url at all'),
  fc.constant(''),
  fc.record({ url: fc.webUrl({ validSchemes: ['https'] }), title: fc.string() }),
  fc.constant(null),
  fc.integer(),
);

/** An entry as a model might return it, well-formed or not. */
const findingish = fc.oneof(
  fc.record(
    {
      title: modelText,
      detail: modelText,
      citations: fc.array(citationish, { maxLength: 10 }),
      severity: fc.oneof(fc.constantFrom('low', 'medium', 'high'), fc.string()),
      deadline: fc.oneof(fc.string(), fc.constant('2027-01-01')),
    },
    { requiredKeys: [] },
  ),
  fc.string(),
  fc.constant(null),
  fc.integer(),
  fc.array(fc.string()),
);

describe('groundedness: an uncited claim never becomes a finding', () => {
  it('never promotes an entry that carries no usable https citation', () => {
    fc.assert(
      fc.property(fc.array(findingish, { maxLength: 12 }), raw => {
        const result = sanitizeIncomingFindings(raw, 'competition', NOW);
        // The invariant, stated positively: everything graded as a *finding*
        // has at least one citation. A `question` may have none — that is the
        // point of demoting rather than discarding.
        for (const finding of result.findings) {
          expect(finding.citations.length).toBeGreaterThan(0);
          for (const citation of finding.citations) {
            expect(citation.url.startsWith('https://')).toBe(true);
          }
        }
        for (const question of result.questions) {
          expect(question.kind).toBe('question');
        }
      }),
      { numRuns: 300 },
    );
  });

  it('accounts for every entry as promoted, demoted, deduplicated or unreadable', () => {
    // A silent drop is the failure this catches: an entry that is neither
    // recorded nor counted is a claim the register cannot tell you it discarded.
    fc.assert(
      fc.property(fc.array(findingish, { maxLength: 12 }), raw => {
        const result = sanitizeIncomingFindings(raw, 'competition', NOW);
        const accounted = result.findings.length + result.questions.length + result.unreadable;
        expect(accounted).toBeLessThanOrEqual(raw.length);
      }),
      { numRuns: 200 },
    );
  });

  it('caps citations per finding rather than storing everything a model listed', () => {
    const many = Array.from({ length: 40 }, (_, index) => `https://example-${index}.com/page`);
    const result = sanitizeIncomingFindings(
      [{ title: 'A cited claim', detail: 'Something observed.', citations: many }],
      'competition',
      NOW,
    );
    for (const finding of result.findings) {
      expect(finding.citations.length).toBeLessThanOrEqual(MAX_CITATIONS_PER_FINDING);
    }
  });

  it('holds the same invariant on read, so a hand-edited file cannot smuggle one in', () => {
    // The gate is in the sanitizer rather than the prompt precisely so it also
    // applies to a file somebody edited by hand months later.
    fc.assert(
      fc.property(fc.array(findingish, { maxLength: 8 }), raw => {
        const register = sanitizeResearchRegister(
          { ...seedResearchRegister(NOW), findings: raw },
          NOW,
        );
        for (const finding of register.findings) {
          if (finding.kind === 'finding') {
            expect(finding.citations.length).toBeGreaterThan(0);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe('groundedness: reading a model reply never throws', () => {
  it('parses arbitrary text into an array or gives up quietly', () => {
    // A parser that throws here takes down the turn that called it, and the
    // input is by definition not under our control.
    fc.assert(
      fc.property(modelText, text => {
        expect(Array.isArray(parseResearchFindings(text))).toBe(true);
        expect(Array.isArray(parseRiskFindings(text))).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('sanitizes arbitrary risk output into records without throwing', () => {
    fc.assert(
      fc.property(fc.anything(), value => {
        const findings = sanitizeRiskFindings(value);
        expect(Array.isArray(findings)).toBe(true);
        // Ids must be distinct or a later transition updates the wrong record.
        expect(new Set(findings.map(f => f.id)).size).toBe(findings.length);
      }),
      { numRuns: 300 },
    );
  });

  it('reads nothing out of prose, rather than inventing a record from it', () => {
    // The alternative failure: a lenient parser that turns a paragraph into one
    // vague finding. Nothing is the correct answer to un-parseable output.
    expect(parseResearchFindings('I think there are probably three competitors.')).toEqual([]);
    expect(parseRiskFindings('There may be some legal risk here.')).toEqual([]);
  });
});
