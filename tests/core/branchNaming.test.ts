import { describe, expect, it } from 'vitest';
import {
  BRANCH_TYPES,
  DEFAULT_BRANCH_MAX_LENGTH,
  PROTECTED_BRANCH_NAMES,
  deriveBranchName,
  inferBranchType,
  matchesBranchConvention,
  slugifyBranchTitle,
} from '../../src/core/branchNaming.ts';

const ok = (result: ReturnType<typeof deriveBranchName>): string => {
  expect(result.ok, result.ok ? '' : `refused: ${result.reason}`).toBe(true);
  return result.ok ? result.name : '';
};

describe('deriveBranchName — the shape', () => {
  it('produces <type>/<issue>-<slug>', () => {
    expect(ok(deriveBranchName({
      type: 'feat', issueNumber: 142, title: 'Derive branch names from the linked issue',
    }))).toBe('feat/142-derive-branch-names-from-the-linked-issue');
  });

  it('matches the example in the specification', () => {
    expect(ok(deriveBranchName({ type: 'feat', issueNumber: 142, title: 'Guided GitHub workflow' })))
      .toBe('feat/142-guided-github-workflow');
  });

  it('omits the issue segment when there is no issue', () => {
    expect(ok(deriveBranchName({ type: 'chore', title: 'Bump dependencies' })))
      .toBe('chore/bump-dependencies');
  });

  it('accepts every declared branch type', () => {
    for (const type of BRANCH_TYPES) {
      expect(ok(deriveBranchName({ type, issueNumber: 1, title: 'a thing' }))).toBe(`${type}/1-a-thing`);
    }
  });

  it('rejects a type outside the vocabulary', () => {
    // @ts-expect-error — deliberately passing an invalid type.
    const result = deriveBranchName({ type: 'feature', issueNumber: 1, title: 'x' });
    expect(result.ok).toBe(false);
  });
});

describe('deriveBranchName — predictability', () => {
  it('is pure: same inputs, same name', () => {
    const request = { type: 'fix' as const, issueNumber: 9, title: 'Something breaks' };
    expect(deriveBranchName(request)).toEqual(deriveBranchName(request));
  });

  it('resolves collisions with an ordinal, never a hash or timestamp', () => {
    // A developer who runs the same command twice must get a name they could
    // have predicted, not one they have to go and read.
    const base = { type: 'feat' as const, issueNumber: 7, title: 'Add a thing' };
    expect(ok(deriveBranchName({ ...base, existing: ['feat/7-add-a-thing'] })))
      .toBe('feat/7-add-a-thing-2');
    expect(ok(deriveBranchName({ ...base, existing: ['feat/7-add-a-thing', 'feat/7-add-a-thing-2'] })))
      .toBe('feat/7-add-a-thing-3');
  });

  it('does not suffix when the base is free', () => {
    expect(ok(deriveBranchName({
      type: 'feat', issueNumber: 7, title: 'Add a thing', existing: ['feat/8-other'],
    }))).toBe('feat/7-add-a-thing');
  });
});

describe('deriveBranchName — it can never produce a protected name', () => {
  it('always carries a type prefix, so no protected name is reachable', () => {
    for (const protectedName of PROTECTED_BRANCH_NAMES) {
      const result = deriveBranchName({ type: 'feat', title: protectedName });
      expect(ok(result)).toBe(`feat/${protectedName}`);
      expect(PROTECTED_BRANCH_NAMES.has(ok(result))).toBe(false);
    }
  });

  it('cannot produce a release/ or hotfix/ ref', () => {
    expect(ok(deriveBranchName({ type: 'chore', title: 'release 1.0' }))).toBe('chore/release-1-0');
    expect(ok(deriveBranchName({ type: 'fix', title: 'hotfix for prod' }))).toBe('fix/hotfix-for-prod');
  });
});

describe('deriveBranchName — refuses rather than inventing', () => {
  it('refuses a title with no usable characters, and says why', () => {
    // Inventing `feat/142-branch` here would be worse than asking: an
    // unreadable branch name is worse than a question.
    const result = deriveBranchName({ type: 'feat', issueNumber: 142, title: '!!! ???' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('Supply a name yourself');
    }
  });

  it('refuses a non-Latin title rather than emitting an empty slug', () => {
    expect(deriveBranchName({ type: 'feat', title: '日本語のみ' }).ok).toBe(false);
  });

  it('refuses when the length budget leaves no room for a description', () => {
    const result = deriveBranchName({ type: 'refactor', issueNumber: 12345, title: 'x', maxLength: 12 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('no room');
    }
  });

  it('never emits a ref git would reject', () => {
    const hostile = ['a..b', 'a~b', 'a^b', 'a:b', 'a?b', 'a*b', 'a[b]', 'a\\b', 'a@{b}', '  '];
    for (const title of hostile) {
      const result = deriveBranchName({ type: 'fix', issueNumber: 1, title });
      if (result.ok) {
        expect(/[~^:\s\\?*[\]]|\.\.|@\{/.test(result.name), `${title} → ${result.name}`).toBe(false);
      }
    }
  });
});

describe('slugifyBranchTitle', () => {
  it('folds accents to their base letter rather than dropping them', () => {
    // Dropping produces "caf", which reads as a typo — and a branch name is read
    // far more often than it is typed.
    expect(slugifyBranchTitle('Café update', 40)).toBe('cafe-update');
    expect(slugifyBranchTitle('Añadir función', 40)).toBe('anadir-funcion');
  });

  it('truncates at a word boundary, never mid-word', () => {
    expect(slugifyBranchTitle('one two three four five', 13)).toBe('one two three'.replace(/ /g, '-'));
    expect(slugifyBranchTitle('one two three four five', 12)).toBe('one-two');
  });

  it('hard-truncates a single word longer than the budget', () => {
    // Otherwise a perfectly usable one-word title would be reported as a refusal.
    expect(slugifyBranchTitle('supercalifragilistic', 8)).toBe('supercal');
  });

  it('collapses punctuation and whitespace runs into single separators', () => {
    expect(slugifyBranchTitle('Fix   the:  thing!!  (again)', 60)).toBe('fix-the-thing-again');
  });

  it('returns empty for input with nothing usable', () => {
    expect(slugifyBranchTitle('', 40)).toBe('');
    expect(slugifyBranchTitle('!!!', 40)).toBe('');
    // @ts-expect-error — defensive: callers pass untrusted issue titles.
    expect(slugifyBranchTitle(undefined, 40)).toBe('');
  });
});

describe('length budgeting', () => {
  it('caps the whole name, not just the slug', () => {
    const name = ok(deriveBranchName({
      type: 'refactor',
      issueNumber: 1234,
      title: 'a very long description that will certainly exceed the configured budget',
      maxLength: 40,
    }));
    expect(name.length).toBeLessThanOrEqual(40);
    expect(name.startsWith('refactor/1234-')).toBe(true);
  });

  it('defaults to a sensible cap', () => {
    const name = ok(deriveBranchName({
      type: 'feat', issueNumber: 1,
      title: 'an extremely long issue title that keeps going well past any reasonable terminal width',
    }));
    expect(name.length).toBeLessThanOrEqual(DEFAULT_BRANCH_MAX_LENGTH);
  });
});

describe('matchesBranchConvention', () => {
  it('accepts conventional names with and without an issue', () => {
    for (const name of ['feat/142-a-thing', 'fix/1-x', 'chore/bump-deps', 'perf/9-faster']) {
      expect(matchesBranchConvention(name), name).toBe(true);
    }
  });

  it('rejects names that carry no meaning', () => {
    for (const name of ['fix2', 'wip', 'joel/thing', 'feature/1-x', 'feat/1-Bad-Case', 'feat/', 'main']) {
      expect(matchesBranchConvention(name), name).toBe(false);
    }
  });

  it('agrees with what deriveBranchName produces', () => {
    // The two would otherwise be able to disagree, reporting a branch AtlasMind
    // itself derived as non-conforming.
    for (const type of BRANCH_TYPES) {
      const name = ok(deriveBranchName({ type, issueNumber: 42, title: 'Some reasonable title' }));
      expect(matchesBranchConvention(name), name).toBe(true);
    }
    expect(matchesBranchConvention(ok(deriveBranchName({ type: 'chore', title: 'no issue here' })))).toBe(true);
  });
});

describe('inferBranchType', () => {
  it('maps common labels and commit types', () => {
    expect(inferBranchType('bug')).toBe('fix');
    expect(inferBranchType('type:feature')).toBe('feat');
    expect(inferBranchType('Documentation')).toBe('docs');
    expect(inferBranchType('enhancement')).toBe('feat');
    expect(inferBranchType('feat')).toBe('feat');
  });

  it('returns undefined rather than defaulting to feat', () => {
    // A branch typed `feat` for a bug fix distorts every filter built on the
    // convention, so an unrecognised hint is the caller's decision to make.
    expect(inferBranchType('something-else')).toBeUndefined();
    expect(inferBranchType(undefined)).toBeUndefined();
    expect(inferBranchType('')).toBeUndefined();
  });
});
