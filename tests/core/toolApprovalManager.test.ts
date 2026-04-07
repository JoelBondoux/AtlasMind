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
});