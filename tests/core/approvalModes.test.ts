import { describe, expect, it, vi } from 'vitest';
import { reviewApprovalRequest } from '../../src/core/approvalModes.js';

const input = {
  kind: 'tool' as const,
  name: 'file-edit',
  intent: 'Fix the Workflow controls',
  args: { path: 'src/example.ts', oldText: 'before', newText: 'after' },
  policy: { category: 'workspace-write' as const, risk: 'high' as const, summary: 'edit a workspace file' },
};

describe('session approval modes', () => {
  it('Auto actually reviews a proposed local edit', async () => {
    const reviewer = vi.fn().mockResolvedValue('{"decision":"approve","reason":"Requested local edit."}');
    expect(await reviewApprovalRequest('auto', input, reviewer)).toMatchObject({ decision: 'allow', rule: 'auto/reviewer-approved' });
    expect(reviewer).toHaveBeenCalledOnce();
    expect(reviewer.mock.calls[0]?.[1]).toContain('Fix the Workflow controls');
  });

  it.each(['', 'yes', '{"decision":"approve"}', '{"decision":"ask","reason":"Unclear scope."}', '{"decision":"approve","reason":"ok","command":"run this"}'])('asks on an uncertain or malformed review: %s', async reply => {
    expect(await reviewApprovalRequest('auto', input, async () => reply)).toMatchObject({ decision: 'ask' });
  });

  it('asks when the model is unavailable', async () => {
    expect(await reviewApprovalRequest('auto', input, async () => { throw new Error('offline'); })).toMatchObject({ decision: 'ask' });
  });

  it('times out without a late approval taking effect', async () => {
    vi.useFakeTimers();
    try {
      let finish: (value: string) => void = () => undefined;
      const model = new Promise<string>(resolve => { finish = resolve; });
      const review = reviewApprovalRequest('auto', input, () => model, 50);
      await vi.advanceTimersByTimeAsync(50);
      expect(await review).toMatchObject({ decision: 'ask' });
      finish('{"decision":"approve","reason":"Too late."}');
      expect(await review).toMatchObject({ decision: 'ask' });
    } finally { vi.useRealTimers(); }
  });

  it('does not review incomplete oversized evidence', async () => {
    const reviewer = vi.fn();
    expect(await reviewApprovalRequest('auto', { ...input, intent: 'x'.repeat(16_001) }, reviewer)).toMatchObject({ decision: 'ask', rule: 'auto/review-too-large' });
    expect(reviewer).not.toHaveBeenCalled();
  });

  it('Bypass does not invoke a reviewer', async () => {
    const reviewer = vi.fn();
    expect(await reviewApprovalRequest('bypass', input, reviewer)).toMatchObject({ decision: 'allow', rule: 'bypass/session-grant' });
    expect(reviewer).not.toHaveBeenCalled();
  });

  it.each(['ask', 'auto', 'bypass'] as const)('%s cannot answer a fresh approval or a non-waivable action', async mode => {
    const reviewer = vi.fn();
    expect(await reviewApprovalRequest(mode, { ...input, freshApproval: true }, reviewer)).toMatchObject({ decision: 'ask' });
    expect(await reviewApprovalRequest(mode, { ...input, policy: { category: 'network', risk: 'high', summary: 'unknown external write' } }, reviewer)).toMatchObject({ decision: 'ask' });
    expect(reviewer).not.toHaveBeenCalled();
  });

  it('Auto cannot authorize an unknown tool or deletion', async () => {
    const reviewer = vi.fn().mockResolvedValue('{"decision":"approve","reason":"ok"}');
    for (const name of ['file-delete', 'unknown-tool', 'atlasmind-settings']) {
      expect(await reviewApprovalRequest('auto', { ...input, name }, reviewer)).toMatchObject({ decision: 'ask' });
    }
    expect(reviewer).not.toHaveBeenCalled();
  });

  it('asks before a broad commit but can review an exact-path commit', async () => {
    const reviewer = vi.fn().mockResolvedValue('{"decision":"approve","reason":"Requested commit."}');
    expect(await reviewApprovalRequest('auto', { ...input, name: 'git-commit', args: { stage_tracked: true } }, reviewer)).toMatchObject({ decision: 'ask', rule: 'auto/commit-needs-exact-paths' });
    expect(reviewer).not.toHaveBeenCalled();
    expect(await reviewApprovalRequest('auto', { ...input, name: 'git-commit', args: { paths: ['src/example.ts'] } }, reviewer)).toMatchObject({ decision: 'allow' });
  });

  it('workflow grants never raise a stage above its effective level', async () => {
    const reviewer = vi.fn().mockResolvedValue('{"decision":"approve","reason":"Requested issue."}');
    const workflow = { ...input, kind: 'workflow' as const, name: 'createIssue', workflowLevel: 'propose' };
    expect(await reviewApprovalRequest('bypass', workflow, reviewer)).toMatchObject({ decision: 'ask' });
    expect(await reviewApprovalRequest('auto', { ...workflow, workflowLevel: 'auto' }, reviewer)).toMatchObject({ decision: 'allow' });
    expect(reviewer).toHaveBeenCalledOnce();
  });

  it.each(['mergePullRequest', 'deleteLabel', 'closeIssue', 'publishRelease'])('keeps %s explicitly confirmed even in Bypass', async name => {
    expect(await reviewApprovalRequest('bypass', { ...input, kind: 'workflow', name, workflowLevel: 'auto' }, vi.fn())).toMatchObject({ decision: 'ask' });
  });
});
