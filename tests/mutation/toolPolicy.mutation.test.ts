import { describe, it, expect } from 'vitest';
import { classifyToolInvocation, getToolApprovalMode, requiresToolApproval } from '../../src/core/toolPolicy.js';
import type { ToolApprovalMode, ToolInvocationCategory } from '../../src/types.js';

/**
 * The second of the three modules Stryker mutates, and the one where a
 * surviving mutant is a security hole rather than a wrong number.
 *
 * `requiresToolApproval` is four `case` arms of boolean expressions over a
 * category. Every mutation Stryker applies to those — a dropped `!==`, an `&&`
 * become `||`, an arm returning a constant — changes *which tool calls run
 * without asking*, and the existing suite asserts a handful of representative
 * pairs. A handful is what a conditional-boundary mutant survives on.
 *
 * The fix is not more examples but the whole matrix: every mode against every
 * category, from a table stating what each mode is *for*. That table is also
 * the readable form of the policy, which is the thing a reviewer needs and
 * cannot get from four boolean expressions.
 *
 * Deny-by-default is asserted separately and structurally: an unrecognised mode
 * must fall back to a gating one, and an unrecognised *tool* must classify as
 * something that gets asked about.
 */

const CATEGORIES: readonly ToolInvocationCategory[] = [
  'read',
  'git-read',
  'terminal-read',
  'workspace-write',
  'git-write',
  'terminal-write',
  'network',
  'audio-input',
  'audio-output',
];

/**
 * What each mode is for, as a set of categories it lets through unasked.
 *
 * Stated as data rather than derived from the implementation — a table
 * computed from the code under test asserts nothing.
 */
const ALLOWED_WITHOUT_ASKING: Record<ToolApprovalMode, readonly ToolInvocationCategory[]> = {
  // Asks about everything, including reads.
  'always-ask': [],
  // In-process reads are free. Note a *shell* read is not: `terminal-read` is
  // asked about here and allowed under `allow-safe-readonly`, which is the only
  // thing separating those two modes.
  'ask-on-write': ['read', 'git-read'],
  // Only things that leave the machine, touch a shell, or use a device.
  'ask-on-external': ['read', 'git-read', 'workspace-write', 'git-write'],
  // As `ask-on-write`, plus read-only shell commands.
  'allow-safe-readonly': ['read', 'git-read', 'terminal-read'],
};

describe('tool approval: the whole mode × category matrix', () => {
  for (const mode of Object.keys(ALLOWED_WITHOUT_ASKING) as ToolApprovalMode[]) {
    for (const category of CATEGORIES) {
      const allowed = ALLOWED_WITHOUT_ASKING[mode].includes(category);
      it(`${mode} ${allowed ? 'allows' : 'asks about'} ${category}`, () => {
        expect(requiresToolApproval(mode, { category, risk: 'low', summary: 'x' })).toBe(!allowed);
      });
    }
  }

  it('asks about something in every mode except the most permissive intent', () => {
    // A mutant that makes an arm return a constant is caught by one direction
    // or the other; this states the invariant so neither can pass unnoticed.
    for (const mode of Object.keys(ALLOWED_WITHOUT_ASKING) as ToolApprovalMode[]) {
      const decisions = CATEGORIES.map(category =>
        requiresToolApproval(mode, { category, risk: 'low', summary: 'x' }));
      if (mode === 'always-ask') {
        expect(decisions.every(Boolean)).toBe(true);
      } else {
        expect(decisions.some(Boolean), `${mode} asks about nothing`).toBe(true);
        expect(decisions.some(decision => !decision), `${mode} asks about everything`).toBe(true);
      }
    }
  });
});

describe('tool approval: an unreadable mode is a gating mode', () => {
  it('accepts each declared mode unchanged', () => {
    for (const mode of Object.keys(ALLOWED_WITHOUT_ASKING) as ToolApprovalMode[]) {
      expect(getToolApprovalMode(mode)).toBe(mode);
    }
  });

  const UNRECOGNISED = [undefined, '', 'never-ask', 'allow-all', 'ASK-ON-WRITE', 'true'];

  for (const value of UNRECOGNISED) {
    it(`falls back to a gating mode for ${JSON.stringify(value)}`, () => {
      const mode = getToolApprovalMode(value);
      expect(mode).toBe('ask-on-write');
      // The fallback matters because it is what a corrupt settings value gets.
      // Asserting the *property* as well as the value means a future change of
      // default still has to be a gating one.
      expect(requiresToolApproval(mode, { category: 'workspace-write', risk: 'high', summary: 'x' })).toBe(true);
    });
  }
});

describe('tool classification: unrecognised is never quietly safe', () => {
  it('grades a write-like verb as a gated category even behind a read-like prefix', () => {
    // `WRITE_LIKE_SUBSTRINGS` wins over `READ_LIKE_PREFIXES` on purpose. A
    // mutant reversing that precedence is invisible to any tool name carrying
    // only one of the two.
    for (const name of ['get-delete-branch', 'list_and_remove', 'search-and-publish', 'find-exec']) {
      const policy = classifyToolInvocation(name, {});
      expect(policy.category, name).toBe('network');
      expect(policy.risk, name).toBe('high');
    }
  });

  it('grades a purely read-like name as a read', () => {
    for (const name of ['get-user', 'list-repos', 'describe-thing', 'lookup-record']) {
      expect(classifyToolInvocation(name, {}).category, name).toBe('read');
    }
  });

  it('grades a name matching neither list as gated, not as a read', () => {
    // The default arm. Unknown is the case where guessing "probably a read" is
    // the expensive mistake.
    for (const name of ['frobnicate', 'zz', 'do-the-thing']) {
      expect(classifyToolInvocation(name, {}).category, name).toBe('network');
    }
  });

  it('does not let a hyphen or underscore change the grading', () => {
    expect(classifyToolInvocation('remote_delete', {}).category)
      .toBe(classifyToolInvocation('remote-delete', {}).category);
  });
});

describe('tool classification: the declared tools keep their category', () => {
  const DECLARED: ReadonlyArray<[string, ToolInvocationCategory]> = [
    ['file-read', 'read'],
    ['file-search', 'read'],
    ['text-search', 'read'],
    ['directory-list', 'read'],
    ['memory-query', 'read'],
    ['specialist-guidance', 'read'],
    ['git-status', 'git-read'],
    ['git-diff', 'git-read'],
    ['file-write', 'workspace-write'],
    ['file-edit', 'workspace-write'],
    ['file-move', 'workspace-write'],
    ['file-delete', 'workspace-write'],
    ['memory-write', 'workspace-write'],
    ['git-apply-patch', 'workspace-write'],
    ['rollback-checkpoint', 'workspace-write'],
    ['git-commit', 'git-write'],
    // Explicitly `read`, not `network`: a handoff reaches no network, and the
    // delegate's own tool use is gated separately. Left to the unknown-name
    // fallback it would be graded `network`, telling a user their assistant was
    // about to reach the internet when it is not.
    ['agent-handoff', 'read'],
  ];

  for (const [name, category] of DECLARED) {
    it(`classifies ${name} as ${category}`, () => {
      expect(classifyToolInvocation(name, {}).category).toBe(category);
    });
  }

  it('names the delegate and says the grant does not extend to its tools', () => {
    const policy = classifyToolInvocation('agent-handoff', { agent_id: 'refactorer' });
    expect(policy.summary).toContain('refactorer');
    expect(policy.summary).toContain('approved separately');
  });

  it('describes a handoff without an agent id rather than printing undefined', () => {
    expect(classifyToolInvocation('agent-handoff', {}).summary).toContain('another agent');
  });

  it('gives every classification a non-empty summary for the approval prompt', () => {
    // A prompt asking "allow this?" with a blank subject is unanswerable.
    for (const [name] of DECLARED) {
      expect(classifyToolInvocation(name, {}).summary.trim().length, name).toBeGreaterThan(0);
    }
  });
});
