import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { parseGhReviewComments } from '../src/core/pullRequestTracker.js';

/**
 * Type drift: the compiler checks the *assertion* about incoming data, never
 * the data.
 *
 * The interesting boundary in AtlasMind is `gh`. Its JSON is declared as a
 * TypeScript interface and arrives from a binary that ships on its own release
 * cadence, from a REST API that ships on another — so `ReviewCommentRecord`
 * describes what GitHub sent *the day somebody wrote the interface*. A renamed
 * field keeps compiling and starts reading `undefined` in production, which is
 * the exact shape of failure this policy exists for.
 *
 * Two things must hold at that boundary, and they pull in opposite directions:
 * it must never throw (a malformed reply cannot be allowed to take down the
 * turn that asked for it), and it must never *invent* — a record built out of
 * missing fields is worse than no record, because the panel renders it as real.
 *
 * The path field carries a third requirement. It arrives from a third party and
 * becomes a file somebody clicks, so it is traversal-checked, and an untrusted
 * one is **emptied rather than rewritten** — the comment text is still worth
 * reading, so the record survives with the button withheld.
 */

/** A comment as `gh` returns it, with any field possibly wrong or missing. */
const commentish = fc.record(
  {
    id: fc.oneof(fc.integer(), fc.string(), fc.constant(null)),
    body: fc.oneof(fc.string(), fc.constant(null), fc.integer()),
    path: fc.oneof(
      fc.constantFrom('src/core/thing.ts', 'docs/readme.md'),
      fc.constantFrom('../outside.ts', '../../etc/passwd', '/absolute/path.ts', 'a/../../b.ts'),
      fc.string(),
      fc.constant(null),
    ),
    line: fc.oneof(fc.integer(), fc.constant(null), fc.string()),
    html_url: fc.oneof(fc.webUrl({ validSchemes: ['https'] }), fc.string(), fc.constant(null)),
    user: fc.oneof(fc.record({ login: fc.string() }), fc.constant(null), fc.string()),
    created_at: fc.oneof(fc.constant('2026-01-01T00:00:00.000Z'), fc.string(), fc.constant(null)),
  },
  { requiredKeys: [] },
);

describe('the gh review-comment boundary never throws', () => {
  it('survives arbitrary text where JSON was expected', () => {
    fc.assert(
      fc.property(fc.string(), raw => {
        expect(Array.isArray(parseGhReviewComments(raw))).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('survives valid JSON of the wrong shape', () => {
    fc.assert(
      fc.property(fc.anything(), value => {
        expect(Array.isArray(parseGhReviewComments(JSON.stringify(value) ?? 'null'))).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('survives a list of half-formed comments', () => {
    fc.assert(
      fc.property(fc.array(commentish, { maxLength: 10 }), comments => {
        expect(Array.isArray(parseGhReviewComments(JSON.stringify(comments)))).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});

describe('a field that drifted is not read as a value', () => {
  it('produces only well-formed records, whatever it was handed', () => {
    fc.assert(
      fc.property(fc.array(commentish, { maxLength: 10 }), comments => {
        for (const record of parseGhReviewComments(JSON.stringify(comments))) {
          // Every declared field is the declared type. The alternative is a
          // record carrying `undefined` that the panel renders as blank, which
          // reads as "the reviewer said nothing" rather than "we lost it".
          expect(typeof record.body).toBe('string');
          expect(typeof record.author).toBe('string');
          expect(typeof record.path).toBe('string');
          expect(typeof record.line).toBe('number');
          expect(Number.isFinite(record.line)).toBe(true);
          expect(typeof record.resolved).toBe('boolean');
        }
      }),
      { numRuns: 300 },
    );
  });

  it('never reports a comment as resolved on its own initiative', () => {
    // The REST endpoint does not carry thread resolution. Inferring it would
    // hide open feedback, so the field stays false rather than guessed.
    fc.assert(
      fc.property(fc.array(commentish, { maxLength: 10 }), comments => {
        for (const record of parseGhReviewComments(JSON.stringify(comments))) {
          expect(record.resolved).toBe(false);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('empties a traversing path rather than rewriting it, and keeps the comment', () => {
    const raw = JSON.stringify([{
      id: 1,
      body: 'This needs a guard.',
      path: '../../etc/passwd',
      line: 3,
      html_url: 'https://github.com/example/repo/pull/1#discussion_r1',
      user: { login: 'reviewer' },
      created_at: '2026-01-01T00:00:00.000Z',
    }]);

    const [record] = parseGhReviewComments(raw);
    expect(record, 'the comment was dropped — its text is still worth reading').toBeDefined();
    expect(record!.body).toBe('This needs a guard.');
    expect(record!.path, 'a traversing path must be emptied, never normalised into a real one').toBe('');
  });

  it('keeps a well-formed comment intact', () => {
    // The check that stops the others being vacuous: a parser returning nothing
    // at all would satisfy every "only well-formed records" assertion above.
    const raw = JSON.stringify([{
      id: 7,
      body: 'Consider caching this.',
      path: 'src/core/cache.ts',
      line: 42,
      html_url: 'https://github.com/example/repo/pull/7#discussion_r7',
      user: { login: 'reviewer' },
      created_at: '2026-01-01T00:00:00.000Z',
    }]);

    const [record] = parseGhReviewComments(raw);
    expect(record).toBeDefined();
    expect(record!.body).toBe('Consider caching this.');
    expect(record!.path).toBe('src/core/cache.ts');
    expect(record!.line).toBe(42);
    expect(record!.author).toBe('reviewer');
  });
});
