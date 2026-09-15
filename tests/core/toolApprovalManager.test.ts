import { describe, expect, it } from 'vitest';
import { ToolApprovalManager } from '../../src/core/toolApprovalManager.ts';

describe('ToolApprovalManager', () => {
  it('queues pending approval requests until the chat UI resolves them', async () => {
    const manager = new ToolApprovalManager();

    const pendingDecision = manager.requestApproval({
      taskId: 'task-1',
      toolName: 'terminal-run',
      category: 'terminal-write',
      risk: 'high',
      summary: 'run npm install in the workspace',
    });

    const [request] = manager.listPendingRequests();
    expect(request).toMatchObject({
      taskId: 'task-1',
      toolName: 'terminal-run',
      category: 'terminal-write',
      risk: 'high',
    });

    expect(manager.resolvePendingRequest(request.id, 'bypass-task')).toBe(true);
    await expect(pendingDecision).resolves.toBe('bypass-task');
    expect(manager.listPendingRequests()).toHaveLength(0);
  });

  it('denies pending requests automatically when a task is cleared', async () => {
    const manager = new ToolApprovalManager();

    const pendingDecision = manager.requestApproval({
      taskId: 'task-2',
      toolName: 'file-write',
      category: 'workspace-write',
      risk: 'medium',
      summary: 'edit a workspace file',
    });

    manager.clearTask('task-2');

    await expect(pendingDecision).resolves.toBe('deny');
    expect(manager.listPendingRequests()).toHaveLength(0);
  });

  it('resolves already-pending requests when task-wide bypass is enabled', async () => {
    const manager = new ToolApprovalManager();

    const firstDecision = manager.requestApproval({
      taskId: 'task-4',
      toolName: 'file-write',
      category: 'workspace-write',
      risk: 'medium',
      summary: 'edit a workspace file',
    });
    const secondDecision = manager.requestApproval({
      taskId: 'task-4',
      toolName: 'terminal-run',
      category: 'terminal-write',
      risk: 'high',
      summary: 'run a workspace command',
    });

    manager.bypassTask('task-4');

    await expect(firstDecision).resolves.toBe('bypass-task');
    await expect(secondDecision).resolves.toBe('bypass-task');
    expect(manager.listPendingRequests()).toHaveLength(0);
  });

  it('preserves optional in-chat review metadata on pending requests', async () => {
    const manager = new ToolApprovalManager();

    void manager.requestApproval({
      taskId: 'task-5',
      toolName: 'generated-skill/demo',
      category: 'workspace-write',
      risk: 'medium',
      summary: 'Review this generated skill draft before one-time execution.',
      title: 'Generated skill review required',
      detail: 'Warning summary here',
      allowedDecisions: ['allow-once', 'deny'],
      decisionLabels: {
        'allow-once': 'Allow Once',
        deny: 'Keep Blocked',
      },
    });

    const [request] = manager.listPendingRequests();
    expect(request?.title).toBe('Generated skill review required');
    expect(request?.detail).toContain('Warning summary');
    expect(request?.allowedDecisions).toEqual(['allow-once', 'deny']);
    expect(request?.decisionLabels?.deny).toBe('Keep Blocked');
  });

  it('resolves pending requests when autopilot is enabled mid-approval', async () => {
    const manager = new ToolApprovalManager();

    const pendingDecision = manager.requestApproval({
      taskId: 'task-3',
      toolName: 'git-commit',
      category: 'git-write',
      risk: 'high',
      summary: 'create a git commit',
    });

    manager.enableAutopilot();

    await expect(pendingDecision).resolves.toBe('autopilot');
    expect(manager.isAutopilot()).toBe(true);
    expect(manager.listPendingRequests()).toHaveLength(0);
  });

  it('applies an in-card Autopilot choice before concurrent tool gates can ask again', async () => {
    const manager = new ToolApprovalManager();
    const firstDecision = manager.requestApproval({
      taskId: 'task-6',
      toolName: 'file-write',
      category: 'workspace-write',
      risk: 'medium',
      summary: 'edit one workspace file',
    });
    const secondDecision = manager.requestApproval({
      taskId: 'task-6',
      toolName: 'git-commit',
      category: 'git-write',
      risk: 'high',
      summary: 'commit the edit',
    });

    const [firstRequest] = manager.listPendingRequests();
    expect(manager.resolvePendingRequest(firstRequest!.id, 'autopilot')).toBe(true);

    expect(manager.isAutopilot()).toBe(true);
    expect(manager.listPendingRequests()).toHaveLength(0);
    await expect(firstDecision).resolves.toBe('autopilot');
    await expect(secondDecision).resolves.toBe('autopilot');
  });

  it('applies an in-card task bypass to every concurrent request for that task', async () => {
    const manager = new ToolApprovalManager();
    const firstDecision = manager.requestApproval({
      taskId: 'task-7',
      toolName: 'file-write',
      category: 'workspace-write',
      risk: 'medium',
      summary: 'edit one workspace file',
    });
    const secondDecision = manager.requestApproval({
      taskId: 'task-7',
      toolName: 'terminal-run',
      category: 'terminal-write',
      risk: 'high',
      summary: 'run the matching test',
    });

    const [firstRequest] = manager.listPendingRequests();
    expect(manager.resolvePendingRequest(firstRequest!.id, 'bypass-task')).toBe(true);

    expect(manager.shouldBypass('task-7', {
      category: 'workspace-write',
      risk: 'medium',
      summary: 'edit another workspace file',
    })).toBe(true);
    expect(manager.listPendingRequests()).toHaveLength(0);
    await expect(firstDecision).resolves.toBe('bypass-task');
    await expect(secondDecision).resolves.toBe('bypass-task');
  });

  it('registers the resolver before advertising a pending request', async () => {
    const manager = new ToolApprovalManager();
    let listenerResolvedRequest = false;
    manager.onPendingApprovalsChange(requests => {
      if (requests[0]) {
        listenerResolvedRequest = manager.resolvePendingRequest(requests[0].id, 'allow-once');
      }
    });

    const decision = manager.requestApproval({
      taskId: 'task-8',
      toolName: 'file-read',
      category: 'read',
      risk: 'low',
      summary: 'read one workspace file',
    });

    expect(listenerResolvedRequest).toBe(true);
    await expect(decision).resolves.toBe('allow-once');
  });

  it('rejects a forged decision that the pending card did not offer', async () => {
    const manager = new ToolApprovalManager();
    const decision = manager.requestApproval({
      taskId: 'task-9',
      toolName: 'generated-skill/demo',
      category: 'workspace-write',
      risk: 'medium',
      summary: 'review a generated skill',
      allowedDecisions: ['allow-once', 'deny'],
    });
    const [request] = manager.listPendingRequests();

    expect(manager.resolvePendingRequest(request!.id, 'autopilot')).toBe(false);
    expect(manager.isAutopilot()).toBe(false);
    expect(manager.listPendingRequests()).toHaveLength(1);

    expect(manager.resolvePendingRequest(request!.id, 'deny')).toBe(true);
    await expect(decision).resolves.toBe('deny');
  });
});
