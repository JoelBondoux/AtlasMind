import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeForRoadmapMatch } from '../src/core/ideationDerivation.js';

/**
 * One rule, several places that state it.
 *
 * The failure this catches reads as a data bug and is really a duplicated rule.
 * AtlasMind has one instance of it that is genuinely load-bearing: the roadmap
 * matching key exists in **three** modules — exported from
 * `ideationDerivation`, copied privately into `ideationReadiness`, and copied
 * again into the dashboard panel — each with a comment saying a test pins them
 * together.
 *
 * It is copied rather than imported for a real reason (the derivation owns the
 * contract, the other two read the result), and the cost of that choice is
 * paid here. If the three drift, a card that produced a roadmap item stops
 * being able to find it: provenance is keyed on normalized *text*, not on ids,
 * because roadmap ids are positional. Every stored link breaks at once, and
 * nothing throws — the board simply reports "missing" for items that are
 * sitting right there.
 *
 * The copies are private functions, so they are pinned by **source text**
 * rather than by call. That is uncomfortable and deliberate: the alternative is
 * no check at all, and this is the one thing about them that must not change
 * independently.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Pull one function body out of a source file, by name. */
function functionBody(relativePath: string, name: string): string {
  const source = readFileSync(path.join(ROOT, relativePath), 'utf8');
  const start = source.indexOf(`function ${name}(`);
  expect(start, `${name} not found in ${relativePath} — it was renamed or removed`).toBeGreaterThan(-1);
  const open = source.indexOf('{', start);
  const end = source.indexOf('\n}', open);
  return source.slice(open + 1, end).replace(/\s+/g, ' ').trim();
}

const COPIES: ReadonlyArray<{ file: string; fn: string }> = [
  { file: 'src/core/ideationDerivation.ts', fn: 'normalizeForRoadmapMatch' },
  { file: 'src/core/ideationReadiness.ts', fn: 'normalizeRoadmapKey' },
  { file: 'src/views/projectDashboardPanel.ts', fn: 'normalizeRoadmapText' },
];

describe('the roadmap matching key is stated identically wherever it is stated', () => {
  it('has three copies to compare', () => {
    // Guards against the loop below passing because a rename made the source
    // scan find nothing.
    expect(COPIES.length).toBe(3);
  });

  it('gives every copy the same body', () => {
    const bodies = COPIES.map(copy => ({ ...copy, body: functionBody(copy.file, copy.fn) }));
    const reference = bodies[0]!;

    for (const candidate of bodies.slice(1)) {
      expect(
        candidate.body,
        `${candidate.file}:${candidate.fn} has drifted from ${reference.file}:${reference.fn} — `
        + 'every stored card-to-roadmap link breaks the moment these disagree',
      ).toBe(reference.body);
    }
  });
});

describe('the key behaves the same way for the text it actually sees', () => {
  /** The exported copy, re-implemented from its declared rule. */
  const declared = (text: string): string =>
    text.toLowerCase().replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();

  it('agrees with its declared rule on arbitrary text', () => {
    fc.assert(
      fc.property(fc.string(), text => {
        expect(normalizeForRoadmapMatch(text)).toBe(declared(text));
      }),
      { numRuns: 500 },
    );
  });

  it('matches text that differs only by trailing punctuation or spacing', () => {
    // The three cases the key exists for: a card and its roadmap line rarely
    // agree on the full stop or the whitespace.
    const canonical = normalizeForRoadmapMatch('Add a rate limit to the webhook');
    for (const variant of [
      'Add a rate limit to the webhook.',
      'Add a rate limit to the webhook  ',
      'Add  a  rate  limit  to  the  webhook',
      'ADD A RATE LIMIT TO THE WEBHOOK',
      '\nAdd a rate limit to the webhook\n',
    ]) {
      expect(normalizeForRoadmapMatch(variant), variant).toBe(canonical);
    }
  });

  it('does not collapse two genuinely different items', () => {
    // The opposite failure, and the more expensive one: over-normalising makes
    // one card claim another card's roadmap item.
    expect(normalizeForRoadmapMatch('Add a rate limit to the webhook'))
      .not.toBe(normalizeForRoadmapMatch('Add a rate limit to the API'));
  });

  it('is idempotent, so a key stored once still matches later', () => {
    fc.assert(
      fc.property(fc.string(), text => {
        const once = normalizeForRoadmapMatch(text);
        expect(normalizeForRoadmapMatch(once)).toBe(once);
      }),
      { numRuns: 300 },
    );
  });
});
