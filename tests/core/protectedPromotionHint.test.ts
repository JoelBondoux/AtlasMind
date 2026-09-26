import { describe, expect, it } from 'vitest';
import { PROTECTED_PROMOTION_HINT, isProtectedBranchPromotionRequest } from '../../src/core/orchestrator.ts';

describe('a chat turn promoting into a protected branch is told to use a pull request', () => {
  // One chat turn is not a planned run, so the planner's rule against local
  // merges into protected branches never reached "promote staging to main and
  // publish" — which merged locally, reset, merged again, and gave up at the tag.

  it('recognises the request that failed, and its ordinary variants', () => {
    for (const message of [
      'promote staging to main and publish',
      'merge develop into master',
      'ship it to production',
      'release develop to main',
    ]) {
      expect(isProtectedBranchPromotionRequest(message), message).toBe(true);
    }
  });

  it('stays out of requests that promote nothing into a protected branch', () => {
    for (const message of [
      'promote develop to staging',
      'what is the main entry point?',
      'publish the docs',
      'release notes for 1.2 please',
      'push my branch',
    ]) {
      expect(isProtectedBranchPromotionRequest(message), message).toBe(false);
    }
  });

  it('names the pull request, the order of tag and merge, and the one-tag tool', () => {
    expect(PROTECTED_PROMOTION_HINT).toMatch(/gh pr create/);
    expect(PROTECTED_PROMOTION_HINT).toMatch(/only after that pull request has merged/);
    expect(PROTECTED_PROMOTION_HINT).toMatch(/"tag" parameter/);
    expect(PROTECTED_PROMOTION_HINT).toMatch(/do not stash, reset, or switch branches/);
  });
});
