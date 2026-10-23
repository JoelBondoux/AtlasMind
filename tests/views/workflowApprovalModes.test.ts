import { describe, expect, it, vi } from 'vitest';
import { ProjectDashboardPanel, isProjectDashboardMessage } from '../../src/views/projectDashboardPanel.js';
import { ToolApprovalManager } from '../../src/core/toolApprovalManager.js';

function harness(stageLevel = 'auto') {
  const manager = new ToolApprovalManager();
  const stage = { id: 'planning', enabled: true, automationLevel: stageLevel, blockers: [] as string[] };
  const decision = { level: 'auto', limitedBy: 'none', detail: 'All settings permit auto.' };
  const reviewer = vi.fn().mockResolvedValue('{"decision":"approve","reason":"Requested issue."}');
  const panel = Object.assign(Object.create(ProjectDashboardPanel.prototype) as {
    reviewWorkflowApproval(...args: unknown[]): Promise<boolean | undefined>;
  }, {
    atlas: { toolApprovalManager: manager, orchestrator: { reviewApproval: reviewer } },
    automationFor: () => decision,
  });
  Object.defineProperty(panel, 'workflowConfig', { value: { getConfig: () => ({ stages: [stage] }) } });
  return { manager, stage, decision, reviewer, run: (action = 'createIssue') => panel.reviewWorkflowApproval(action, 'planning', 'issueWrites', decision, 'Create a tracking issue.', ['issue', 'create']) };
}

describe('workflow session approvals', () => {
  it('accepts only the declared mode values from the webview', () => {
    for (const mode of ['ask', 'auto', 'bypass']) {
      expect(isProjectDashboardMessage({ type: 'setSessionApprovalMode', payload: { mode } })).toBe(true);
    }
    for (const mode of ['always', {}, null, true]) {
      expect(isProjectDashboardMessage({ type: 'setSessionApprovalMode', payload: { mode } })).toBe(false);
    }
  });

  it('Ask does not call a reviewer; Bypass still cannot waive an observe stage', async () => {
    const h = harness('observe');
    expect(await h.run()).toBe(false);
    h.manager.setApprovalMode('bypass');
    expect(await h.run()).toBe(false);
    expect(h.reviewer).not.toHaveBeenCalled();
  });

  it('reviews eligible auto-stage writes and records the grant in the audit detail', async () => {
    const h = harness();
    h.manager.setApprovalMode('auto');
    expect(await h.run()).toBe(true);
    expect(h.decision.detail).toContain('auto/reviewer-approved');
    expect(await h.run('closeIssue')).toBe(false);
  });

  it('refuses a stage revoked while the reviewer was running', async () => {
    const h = harness();
    h.manager.setApprovalMode('auto');
    h.reviewer.mockImplementation(async () => {
      h.stage.enabled = false;
      return '{"decision":"approve","reason":"Approved."}';
    });
    expect(await h.run()).toBeUndefined();
  });

  it('never automatically authorizes a stage with a declared blocker', async () => {
    const h = harness();
    h.manager.setApprovalMode('bypass');
    h.stage.blockers.push('Needs assessment');
    expect(await h.run()).toBe(false);
    expect(h.reviewer).not.toHaveBeenCalled();
  });

  it('does not apply a review after the session mode changes', async () => {
    const h = harness();
    h.manager.setApprovalMode('auto');
    h.reviewer.mockImplementation(async () => {
      h.manager.setApprovalMode('ask');
      return '{"decision":"approve","reason":"Approved."}';
    });
    expect(await h.run()).toBe(false);
  });
});
