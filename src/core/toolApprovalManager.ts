/**
 * Manages runtime tool approval state for "Bypass Approvals" and "Autopilot"
 * modes. State is not persisted—clears on extension restart.
 */

import type {
  PendingToolApprovalRequest,
  ToolApprovalDecision,
  ToolApprovalState,
  ToolRiskCategory,
} from '../types.js';

export class ToolApprovalManager {
  private state: ToolApprovalState = { autopilot: false };
  /**
   * Categories bypassed for the current task. Cleared when task ends.
   * Keyed by task ID → set of risk categories.
   */
  private bypassedCategories = new Map<string, Set<ToolRiskCategory>>();

  /** Fired whenever autopilot mode changes so UI can update. */
  private autopilotChangeListeners: Array<(enabled: boolean) => void> = [];
  /** Fired whenever pending approval requests change so UI can update. */
  private pendingApprovalChangeListeners: Array<(requests: PendingToolApprovalRequest[]) => void> = [];
  private pendingApprovals: PendingToolApprovalRequest[] = [];
  private pendingApprovalResolvers = new Map<string, (decision: ToolApprovalDecision) => void>();

  // ── Public API ─────────────────────────────────────────────────

  isAutopilot(): boolean {
    return this.state.autopilot;
  }

  listPendingRequests(): PendingToolApprovalRequest[] {
    return [...this.pendingApprovals];
  }

  enableAutopilot(): void {
    this.state.autopilot = true;
    this.resolveAllPending('autopilot');
    this.notifyAutopilotChange(true);
  }

  disableAutopilot(): void {
    this.state.autopilot = false;
    this.notifyAutopilotChange(false);
  }

  toggleAutopilot(): boolean {
    if (this.state.autopilot) {
      this.disableAutopilot();
      return false;
    }

    this.enableAutopilot();
    return true;
  }

  requestApproval(
    request: Omit<PendingToolApprovalRequest, 'id' | 'createdAt'>,
  ): Promise<ToolApprovalDecision> {
    const pendingRequest: PendingToolApprovalRequest = {
      ...request,
      id: this.createRequestId(request.taskId, request.toolName),
      createdAt: new Date().toISOString(),
    };

    this.pendingApprovals = [...this.pendingApprovals, pendingRequest];
    this.notifyPendingApprovalChange();

    return new Promise(resolve => {
      this.pendingApprovalResolvers.set(pendingRequest.id, resolve);
    });
  }

  resolvePendingRequest(requestId: string, decision: ToolApprovalDecision): boolean {
    const resolver = this.pendingApprovalResolvers.get(requestId);
    if (!resolver) {
      return false;
    }

    this.pendingApprovalResolvers.delete(requestId);
    this.pendingApprovals = this.pendingApprovals.filter(request => request.id !== requestId);
    this.notifyPendingApprovalChange();
    resolver(decision);
    return true;
  }

  /**
   * Bypass approvals for a specific task. All tools in that task will
   * proceed without prompting until the task ends.
   */
  bypassTask(taskId: string): void {
    this.state.bypassTaskId = taskId;
    this.resolveMatchingPending(request => request.taskId === taskId, 'bypass-task');
  }

  /**
   * Bypass approvals for a specific category within the current task.
   * E.g., "workspace-write" → all file writes for this task pass.
   */
  bypassCategory(taskId: string, category: ToolRiskCategory): void {
    if (!this.bypassedCategories.has(taskId)) {
      this.bypassedCategories.set(taskId, new Set());
    }
    this.bypassedCategories.get(taskId)!.add(category);
  }

  /**
   * Check if approval should be bypassed for a given tool invocation.
   * Returns true if:
   *   - Autopilot is enabled, OR
   *   - The current task has full bypass, OR
   *   - The current task has bypassed this specific category.
   */
  shouldBypass(taskId: string | undefined, category: ToolRiskCategory): boolean {
    if (this.state.autopilot) {
      return true;
    }

    if (taskId && this.state.bypassTaskId === taskId) {
      return true;
    }

    if (taskId && this.bypassedCategories.get(taskId)?.has(category)) {
      return true;
    }

    return false;
  }

  /**
   * Called when a task completes to clear task-scoped bypass state.
   */
  clearTask(taskId: string): void {
    if (this.state.bypassTaskId === taskId) {
      this.state.bypassTaskId = undefined;
    }
    this.bypassedCategories.delete(taskId);
    this.resolveMatchingPending(request => request.taskId === taskId, 'deny');
  }

  /**
   * Reset all approval state (clears autopilot and all task bypasses).
   */
  reset(): void {
    this.state = { autopilot: false };
    this.bypassedCategories.clear();
    this.resolveAllPending('deny');
    this.notifyAutopilotChange(false);
  }

  // ── Listener management ────────────────────────────────────────

  onAutopilotChange(listener: (enabled: boolean) => void): () => void {
    this.autopilotChangeListeners.push(listener);
    return () => {
      const idx = this.autopilotChangeListeners.indexOf(listener);
      if (idx !== -1) {
        this.autopilotChangeListeners.splice(idx, 1);
      }
    };
  }

  onPendingApprovalsChange(listener: (requests: PendingToolApprovalRequest[]) => void): () => void {
    this.pendingApprovalChangeListeners.push(listener);
    return () => {
      const idx = this.pendingApprovalChangeListeners.indexOf(listener);
      if (idx !== -1) {
        this.pendingApprovalChangeListeners.splice(idx, 1);
      }
    };
  }

  private notifyAutopilotChange(enabled: boolean): void {
    const listeners = [...this.autopilotChangeListeners];
    for (const listener of listeners) {
      try {
        listener(enabled);
      } catch (error) {
        console.error('ToolApprovalManager: autopilot change listener failed', error);
      }
    }
  }

  private notifyPendingApprovalChange(): void {
    const listeners = [...this.pendingApprovalChangeListeners];
    const snapshot = this.listPendingRequests();
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        console.error('ToolApprovalManager: pending approval listener failed', error);
      }
    }
  }

  private resolveAllPending(decision: ToolApprovalDecision): void {
    this.resolveMatchingPending(() => true, decision);
  }

  private resolveMatchingPending(
    predicate: (request: PendingToolApprovalRequest) => boolean,
    decision: ToolApprovalDecision,
  ): void {
    const matchingIds = this.pendingApprovals
      .filter(predicate)
      .map(request => request.id);
    for (const requestId of matchingIds) {
      this.resolvePendingRequest(requestId, decision);
    }
  }

  private createRequestId(taskId: string, toolName: string): string {
    const slug = toolName.replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '').toLowerCase() || 'tool';
    return `${taskId}:${slug}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  }
}
