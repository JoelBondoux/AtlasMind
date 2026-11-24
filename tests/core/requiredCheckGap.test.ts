import { describe, expect, it } from 'vitest';
import type { PullRequestRecord, PullRequestStatusCheck } from '../../src/core/pullRequestTracker.ts';
import {
  deriveRequiredCheckGap,
  deriveRequiredCheckGaps,
  parseRequiredCheckReading,
  requiredCheckBranchesToRead,
  type RequiredCheckReading,
} from '../../src/core/requiredCheckGap.ts';

const LOCAL_CI = 'AtlasMind/local-ci';

function check(name: string, conclusion = 'success', status = 'completed'): PullRequestStatusCheck {
  return { name, status, conclusion };
}

function pr(overrides: Partial<PullRequestRecord> = {}): PullRequestRecord {
  return {
    number: 73,
    title: 'Perk links on the self-hosted runner',
    state: 'open',
    author: 'someone',
    headRefName: 'codex/perk-links',
    baseRefName: 'dev',
    labels: [],
    body: '',
    url: 'https://github.com/JoelBondoux/JoelBondouxNet/pull/73',
    createdAt: '2026-11-23T00:00:00Z',
    updatedAt: '2026-11-23T00:00:00Z',
    additions: 1,
    deletions: 1,
    changedFiles: 1,
    reviews: [],
    linkedIssues: [],
    statusChecks: [check('CI'), check('CodeQL')],
    ...overrides,
  } as PullRequestRecord;
}

function required(contexts: string[], branch = 'dev'): Record<string, RequiredCheckReading> {
  return { [branch]: { branch, contexts, sources: ['rulesets'] } };
}

describe('required-check gap', () => {
  /**
   * The case that produced this module: two green checks on the row, a merge
   * refused by a required status nobody had posted.
   */
  it('reports a required check nobody posted as blocked, naming the AtlasMind action when it is that one', () => {
    const gap = deriveRequiredCheckGap(pr(), required(['CI', LOCAL_CI]), LOCAL_CI);
    expect(gap).toMatchObject({ state: 'blocked-missing', missing: [LOCAL_CI], failing: [], pending: [], localCiMissing: true });
    expect(gap.summary).toContain('has not been posted');
    expect(gap.summary).toContain('reviewed-PR local CI run posts it');

    const other = deriveRequiredCheckGap(pr(), required(['CI', 'Lint']), LOCAL_CI);
    expect(other).toMatchObject({ state: 'blocked-missing', missing: ['Lint'], localCiMissing: false });
    expect(other.summary).toContain('required check Lint has not been posted');
  });

  /** Missing, failing and pending are three states, not one "mismatch". */
  it('keeps missing, failing and pending apart, worst state first', () => {
    const failing = deriveRequiredCheckGap(pr({ statusChecks: [check('CI', 'failure'), check(LOCAL_CI)] }), required(['CI', LOCAL_CI]), LOCAL_CI);
    expect(failing).toMatchObject({ state: 'blocked-failing', failing: ['CI'], missing: [] });

    const pending = deriveRequiredCheckGap(pr({ statusChecks: [check('CI', '', 'in_progress'), check(LOCAL_CI)] }), required(['CI', LOCAL_CI]), LOCAL_CI);
    expect(pending).toMatchObject({ state: 'waiting', pending: ['CI'] });

    // Missing outranks failing: producing the absent check is the step nothing else can replace.
    const both = deriveRequiredCheckGap(pr({ statusChecks: [check('CI', 'failure')] }), required(['CI', LOCAL_CI]), LOCAL_CI);
    expect(both.state).toBe('blocked-missing');
    expect(both.failing).toEqual(['CI']);

    // Two posts under one name: a failure beside a pass is not a pass.
    const twice = deriveRequiredCheckGap(pr({ statusChecks: [check('CI', 'failure'), check('CI')] }), required(['CI']), LOCAL_CI);
    expect(twice.state).toBe('blocked-failing');

    expect(deriveRequiredCheckGap(pr(), required(['CI', 'CodeQL']), LOCAL_CI)).toMatchObject({ state: 'satisfied' });
  });

  /** Unknown is not clear; none-required is a different fact from not-read. */
  it('reports an unread base branch or an unread rollup as unknown, and no requirement as such', () => {
    expect(deriveRequiredCheckGap(pr(), {}, LOCAL_CI)).toMatchObject({ state: 'unknown' });
    expect(deriveRequiredCheckGap(pr({ statusChecks: undefined }), required(['CI']), LOCAL_CI)).toMatchObject({ state: 'unknown' });
    expect(deriveRequiredCheckGap(pr(), required([]), LOCAL_CI)).toMatchObject({ state: 'no-required' });
    // Exact names, as GitHub matches them.
    expect(deriveRequiredCheckGap(pr({ statusChecks: [check('atlasmind/local-ci')] }), required([LOCAL_CI]), LOCAL_CI)).toMatchObject({ state: 'blocked-missing' });
  });

  it('judges only open and draft pull requests, and lists the base branches worth reading, capped', () => {
    const list = [pr(), pr({ number: 74, state: 'draft', baseRefName: 'dev' }), pr({ number: 70, state: 'merged' }), pr({ number: 75, baseRefName: 'main' })];
    expect(deriveRequiredCheckGaps(list, required(['CI']), LOCAL_CI).map(gap => gap.number)).toEqual([73, 74, 75]);
    expect(requiredCheckBranchesToRead(list)).toEqual(['dev', 'main']);
    expect(requiredCheckBranchesToRead(list, 1)).toEqual(['dev']);
  });

  /**
   * Both GitHub answers are read and unioned; a reading that could not be
   * taken is undefined, never "requires nothing".
   */
  it('reads branch protection and rulesets, and refuses to invent a reading from nothing', () => {
    const protection = JSON.stringify({
      required_status_checks: { contexts: ['CI'], checks: [{ context: 'CI' }, { context: 'CodeQL' }] },
      required_pull_request_reviews: {},
    });
    const rules = JSON.stringify([
      { type: 'deletion' },
      { type: 'required_status_checks', parameters: { required_status_checks: [{ context: LOCAL_CI }, { context: 'CI' }] } },
    ]);
    expect(parseRequiredCheckReading('dev', protection, rules)).toEqual({
      branch: 'dev', contexts: ['CI', 'CodeQL', LOCAL_CI], sources: ['branch-protection', 'rulesets'],
    });
    expect(parseRequiredCheckReading('dev', undefined, rules)).toEqual({ branch: 'dev', contexts: [LOCAL_CI, 'CI'], sources: ['rulesets'] });
    // Protected without required checks is a real "none".
    expect(parseRequiredCheckReading('dev', JSON.stringify({ required_pull_request_reviews: {} }), undefined)).toEqual({ branch: 'dev', contexts: [], sources: ['branch-protection'] });
    expect(parseRequiredCheckReading('dev', undefined, undefined)).toBeUndefined();
    expect(parseRequiredCheckReading('dev', 'not json', '{}')).toBeUndefined();
    // Control characters in a context name are stripped, since the name is rendered.
    expect(parseRequiredCheckReading('dev', undefined, JSON.stringify([{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'CI\u0007' }] } }]))?.contexts).toEqual(['CI']);
  });
});
