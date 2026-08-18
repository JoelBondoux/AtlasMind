import { describe, expect, it } from 'vitest';

import {
  lowestMajorInRange,
  resolveWorkflowNodeVersion,
} from '../../src/core/nodeVersionDetection.ts';

/**
 * The bug this module closes was not a wrong constant, it was a constant.
 *
 * Three generators write GitHub Actions YAML into a user's repository and all
 * three took an optional `nodeVersion` that no caller ever passed, so the
 * default behind each `??` was the only value any of them emitted. Picking a
 * newer number would fail the same way on the same schedule, so what these
 * tests protect is the *ladder* — that an answer is always derived from
 * something, and that the something is named.
 */
describe('resolving the Node version a generated workflow pins', () => {
  const RUNTIME = '24.16.0';

  it('takes the project’s declaration over anything it could infer', () => {
    const resolved = resolveWorkflowNodeVersion({
      enginesNode: '>=22',
      nvmrc: '18',
      nodeVersionFile: '16',
      runtimeVersion: RUNTIME,
    });
    expect(resolved.version).toBe('22');
    expect(resolved.source).toBe('engines');
  });

  /**
   * The floor is what the project promised, and it is the half that breaks:
   * reaching for an API that only exists in the newer major is the ordinary
   * mistake, and only the floor catches it.
   */
  it('resolves a range to its lowest declared major', () => {
    expect(lowestMajorInRange('^22.22.2 || ^24.15.0 || >=26.0.0')).toBe('22');
    expect(lowestMajorInRange('>=18')).toBe('18');
    expect(lowestMajorInRange('20.x')).toBe('20');
    expect(lowestMajorInRange('~22.1')).toBe('22');
    expect(lowestMajorInRange('v22')).toBe('22');
  });

  /**
   * `>=22 <25` declares support for 22. Counting the 25 would pin CI to a major
   * the project never claimed, which is a red run in somebody else's
   * repository.
   */
  it('reads upper bounds as bounds, not as declarations', () => {
    expect(lowestMajorInRange('>=22 <25')).toBe('22');
    expect(lowestMajorInRange('>=20 <21 || >=22 <23')).toBe('20');
  });

  /** A wrong pin is worse than no opinion, so an unreadable range yields none. */
  it('refuses to guess at a range it cannot read', () => {
    expect(lowestMajorInRange('lts/hydrogen')).toBeUndefined();
    expect(lowestMajorInRange('*')).toBeUndefined();
    expect(lowestMajorInRange('x')).toBeUndefined();
    expect(lowestMajorInRange('')).toBeUndefined();
    expect(lowestMajorInRange(undefined)).toBeUndefined();
    // One unreadable alternative makes the whole range unreadable: the lowest
    // floor of the parts understood is not the lowest floor of the range.
    expect(lowestMajorInRange('>=22 || wat')).toBeUndefined();
  });

  it('falls through an unreadable declaration to the next rung', () => {
    const resolved = resolveWorkflowNodeVersion({
      enginesNode: 'lts/*',
      nvmrc: 'v20.11.1',
      runtimeVersion: RUNTIME,
    });
    expect(resolved.version).toBe('20');
    expect(resolved.source).toBe('nvmrc');
  });

  it('reads .node-version when there is no .nvmrc', () => {
    const resolved = resolveWorkflowNodeVersion({
      nodeVersionFile: '22.11.0',
      runtimeVersion: RUNTIME,
    });
    expect(resolved.version).toBe('22');
    expect(resolved.source).toBe('node-version-file');
  });

  /**
   * The rung that keeps this from becoming the thing it replaced. With nothing
   * declared, the answer is measured from the running process rather than
   * written down, so it cannot go stale.
   */
  it('measures the last resort instead of declaring it', () => {
    const resolved = resolveWorkflowNodeVersion({ runtimeVersion: RUNTIME });
    expect(resolved.version).toBe('24');
    expect(resolved.source).toBe('runtime');
  });

  it('follows the running Node rather than any constant in this file', () => {
    expect(resolveWorkflowNodeVersion({ runtimeVersion: '30.1.2' }).version).toBe('30');
    expect(resolveWorkflowNodeVersion({ runtimeVersion: '18.0.0' }).version).toBe('18');
  });

  /**
   * A project may declare a version that has reached end of life. That is still
   * the answer: overriding it would put a runtime in their CI that nothing in
   * their project claims to support, and their CI is where that is discovered.
   */
  it('honours a declared version even when it is end-of-life', () => {
    const resolved = resolveWorkflowNodeVersion({ enginesNode: '>=18', runtimeVersion: RUNTIME });
    expect(resolved.version).toBe('18');
  });

  /** Every answer explains itself where it is confirmed, not in this source. */
  it('names the rule that produced the answer', () => {
    for (const facts of [
      { enginesNode: '>=22', runtimeVersion: RUNTIME },
      { nvmrc: '22', runtimeVersion: RUNTIME },
      { nodeVersionFile: '22', runtimeVersion: RUNTIME },
      { runtimeVersion: RUNTIME },
    ]) {
      const resolved = resolveWorkflowNodeVersion(facts);
      expect(resolved.rule.length).toBeGreaterThan(20);
      expect(resolved.rule.endsWith('.')).toBe(true);
    }
  });

  /** Whatever comes back must satisfy the generators' own YAML shape check. */
  it('only ever produces a bare major', () => {
    for (const facts of [
      { enginesNode: '^22.22.2 || >=24', runtimeVersion: RUNTIME },
      { nvmrc: 'v20.11.1', runtimeVersion: RUNTIME },
      { nodeVersionFile: '18.20.4', runtimeVersion: RUNTIME },
      { runtimeVersion: '24.16.0' },
    ]) {
      expect(resolveWorkflowNodeVersion(facts).version).toMatch(/^\d{1,3}$/);
    }
  });

  /**
   * The value is interpolated into YAML by all three generators. Nothing that
   * arrives here can carry a newline out, whatever a package.json contains.
   */
  it('never carries a newline out of a hostile declaration', () => {
    for (const hostile of [
      '20\n      - run: curl bad',
      ">=20'\n      - run: curl bad",
      '20; rm -rf /',
    ]) {
      const resolved = resolveWorkflowNodeVersion({ enginesNode: hostile, runtimeVersion: RUNTIME });
      expect(resolved.version).toMatch(/^\d{1,3}$/);
      const viaNvmrc = resolveWorkflowNodeVersion({ nvmrc: hostile, runtimeVersion: RUNTIME });
      expect(viaNvmrc.version).toMatch(/^\d{1,3}$/);
    }
  });
});
