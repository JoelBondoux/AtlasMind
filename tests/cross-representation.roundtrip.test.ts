import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { canonicalJson } from '../src/core/workflowAuditRecord.js';
import { sanitizeWorkflowConfig, seedWorkflowConfig } from '../src/core/workflowConfig.js';

/**
 * Cross-representation: the same fact, written one way and read back another.
 *
 * Serialization asymmetry is the classic silent corruption — it writes fine,
 * reads back subtly different, and nothing fails until much later. AtlasMind
 * has two round trips where that would be expensive, and they fail differently.
 *
 * **`canonicalJson`** is the one every determinism claim rests on. The audit
 * ledger stores fingerprints rather than payloads, and `findDeterminismBreaches`
 * groups runs by `(stageId, action, inputsFingerprint)`. If two descriptions of
 * the same input hash differently, the check cries wolf on every run until
 * somebody turns it off — so key order must not matter, and *only* key order
 * must not matter.
 *
 * **The workflow config** round trip is a compatibility promise: the file is
 * committed and edited by more than one build, so an older AtlasMind saving it
 * must not silently drop a newer one's settings. A dropped unknown field is
 * invisible in the diff of the build that dropped it and shows up as a lost
 * setting for whoever wrote it.
 */

describe('canonicalJson: the same value has one representation', () => {
  it('is insensitive to key order at every depth', () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ minLength: 1 }), fc.oneof(fc.string(), fc.integer(), fc.boolean())),
        record => {
          // `Object.fromEntries`, not `reversed[key] = …`. Assignment treats
          // `__proto__` as a setter for the prototype rather than as a key, so
          // the reversed copy would silently lose it and the two would differ
          // for a reason that has nothing to do with `canonicalJson`. fast-check
          // found that within a few hundred runs, which is the whole argument
          // for generating the input rather than choosing it.
          const reversed = Object.fromEntries(Object.entries(record).reverse());
          expect(canonicalJson(reversed)).toBe(canonicalJson(record));
        },
      ),
      { numRuns: 400 },
    );
  });

  it('sorts nested objects too, not only the top level', () => {
    const a = { outer: { b: 1, a: 2 }, list: [{ y: 1, x: 2 }] };
    const b = { list: [{ x: 2, y: 1 }], outer: { a: 2, b: 1 } };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('keeps array order, which is data rather than presentation', () => {
    // The one ordering that must survive. Sorting arrays would make two
    // genuinely different sequences fingerprint identically, and the
    // determinism check would then miss the breach it exists to find.
    expect(canonicalJson([1, 2, 3])).not.toBe(canonicalJson([3, 2, 1]));
  });

  it('distinguishes values that merely look alike', () => {
    const distinct = [
      canonicalJson(null),
      canonicalJson(0),
      canonicalJson(''),
      canonicalJson(false),
      canonicalJson([]),
      canonicalJson({}),
      canonicalJson('0'),
      canonicalJson('null'),
    ];
    expect(new Set(distinct).size).toBe(distinct.length);
  });

  it('is stable across repeated calls on the same value', () => {
    fc.assert(
      fc.property(fc.object(), value => {
        expect(canonicalJson(value)).toBe(canonicalJson(value));
      }),
      { numRuns: 200 },
    );
  });

  it('produces parseable JSON, so a fingerprint can be explained', () => {
    fc.assert(
      fc.property(fc.object(), value => {
        expect(() => JSON.parse(canonicalJson(value))).not.toThrow();
      }),
      { numRuns: 200 },
    );
  });
});

describe('workflow config: an older build saving cannot drop a newer one’s settings', () => {
  it('round-trips a seeded config unchanged', () => {
    const seeded = seedWorkflowConfig({ profile: 'solo' });
    const back = sanitizeWorkflowConfig(JSON.parse(JSON.stringify(seeded)));
    expect(back).toBeDefined();
    expect(canonicalJson(back)).toBe(canonicalJson(seeded));
  });

  it('is idempotent — sanitizing twice changes nothing further', () => {
    // A sanitizer that keeps rewriting its own output turns every save into a
    // spurious diff on a committed file.
    const once = sanitizeWorkflowConfig(JSON.parse(JSON.stringify(seedWorkflowConfig({ profile: 'studio' }))));
    const twice = sanitizeWorkflowConfig(JSON.parse(JSON.stringify(once)));
    expect(canonicalJson(twice)).toBe(canonicalJson(once));
  });

  it('carries an unknown top-level field through the round trip', () => {
    // Preserved under `extra` rather than at the top level — the sanitizer
    // returns a known shape and parks what it does not recognise. What matters
    // is that the value is still there afterwards, and that a second save does
    // not lose it (asserted below).
    const seeded = seedWorkflowConfig({ profile: 'solo' }) as unknown as Record<string, unknown>;
    const fromNewerBuild = {
      ...JSON.parse(JSON.stringify(seeded)),
      somethingAddedLater: { enabled: true, note: 'written by a newer AtlasMind' },
    };

    const back = sanitizeWorkflowConfig(fromNewerBuild);
    expect(back?.extra?.['somethingAddedLater'])
      .toEqual({ enabled: true, note: 'written by a newer AtlasMind' });
  });

  it('still holds the unknown field after a second save', () => {
    // The round trip that actually happens: a newer build writes the file, an
    // older build opens and saves it, then the newer build reads it again. The
    // value has to survive *both* passes, which is where a sanitizer that
    // preserves on read but not on re-read would fail.
    const seeded = JSON.parse(JSON.stringify(seedWorkflowConfig({ profile: 'solo' })));
    const once = sanitizeWorkflowConfig({ ...seeded, somethingAddedLater: 'keep me' });
    const twice = sanitizeWorkflowConfig(JSON.parse(JSON.stringify(once)));

    expect(twice?.extra?.['somethingAddedLater']).toBe('keep me');
  });

  it('restores a managed stage the file has lost, rather than accepting the deletion', () => {
    // Disabling is a record; deletion is an erasure. Deleting a managed stage
    // by hand is not an error — it simply does not work.
    const seeded = JSON.parse(JSON.stringify(seedWorkflowConfig({ profile: 'solo' })));
    const removed = seeded.stages.shift();
    const back = sanitizeWorkflowConfig(seeded);

    expect(back?.stages.some(stage => stage.id === removed.id)).toBe(true);
  });
});

describe('a key that looks like a language feature is still a key', () => {
  it('canonicalises an own __proto__ property like any other', () => {
    // Not hypothetical: these documents are JSON read off disk, and `JSON.parse`
    // creates `__proto__` as an ordinary own property. Anything that copies keys
    // with `target[key] = value` instead loses it, which is how a round trip
    // drops a field while every ordinary key survives.
    const a = Object.fromEntries([['__proto__', 'x'], ['b', 1]]);
    const b = Object.fromEntries([['b', 1], ['__proto__', 'x']]);
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toContain('__proto__');
  });

  it('reads such a key back out of parsed JSON', () => {
    const parsed = JSON.parse('{"__proto__": {"polluted": true}, "ok": 1}') as Record<string, unknown>;
    expect(Object.keys(parsed)).toContain('__proto__');
    // And it stays an own property rather than becoming the prototype.
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(canonicalJson(parsed)).toContain('__proto__');
  });
});
