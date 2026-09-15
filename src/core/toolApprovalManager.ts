/**
 * Manages runtime tool approval state for "Bypass Approvals" and "Autopilot"
 * modes. State is not persisted—clears on extension restart.
 */

import type {
  PendingToolApprovalRequest,
  ToolApprovalDecision,
  ToolApprovalState,
  ToolInvocationPolicy,
  ToolRiskCategory,
} from '../types.js';
import { isToolBypassable } from './toolPolicy.js';

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
    this.settleMatchingPending(
      request => this.canResolveFromScope(request, 'autopilot'),
      'autopilot',
    );
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

    return new Promise(resolve => {
      // Register the resolver before publishing the request. A listener is
      // allowed to answer synchronously (the chat webview normally answers on
      // a later event-loop turn, but tests and future hosts need not), and a
      // visible card whose resolver does not exist yet turns the first click
      // into a no-op.
      this.pendingApprovalResolvers.set(pendingRequest.id, resolve);
      this.pendingApprovals = [...this.pendingApprovals, pendingRequest];
      this.notifyPendingApprovalChange();
    });
  }

  resolvePendingRequest(requestId: string, decision: ToolApprovalDecision): boolean {
    const request = this.pendingApprovals.find(candidate => candidate.id === requestId);
    const resolver = this.pendingApprovalResolvers.get(requestId);
    if (!request || !resolver || !this.isDecisionAllowed(request, decision)) {
      return false;
    }

    // The click and the scope it grants are one state transition. Previously
    // the UI resolved this one promise and the caller enabled Bypass/Autopilot
    // only after its `await` resumed. Tool calls run concurrently, so the other
    // gates remained visible (and could add more cards) during that gap.
    if (decision === 'autopilot') {
      this.state.autopilot = true;
      this.settleMatchingPending(
        candidate => candidate.id === requestId || this.canResolveFromScope(candidate, decision),
        decision,
      );
      this.notifyAutopilotChange(true);
      return true;
    }

    if (decision === 'bypass-task') {
      this.state.bypassTaskId = request.taskId;
      this.settleMatchingPending(
        candidate => candidate.id === requestId
          || (candidate.taskId === request.taskId && this.canResolveFromScope(candidate, decision)),
        decision,
      );
      return true;
    }

    this.settleMatchingPending(candidate => candidate.id === requestId, decision);
    return true;
  }

  /**
   * Bypass approvals for a specific task. All tools in that task will
   * proceed without prompting until the task ends.
   */
  bypassTask(taskId: string): void {
    this.state.bypassTaskId = taskId;
    this.settleMatchingPending(
      request => request.taskId === taskId && this.canResolveFromScope(request, 'bypass-task'),
      'bypass-task',
    );
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
   *
   * Returns true if the invocation is bypassable at all **and** one of:
   *   - Autopilot is enabled, OR
   *   - The current task has full bypass, OR
   *   - The current task has bypassed this specific category.
   *
   * Takes the whole policy rather than the category alone because the ceiling
   * is a (category, risk) pair: an MCP read and an unidentified MCP write are
   * both outward, and only one of them is unrecoverable. The ceiling is checked
   * **first**, so no bypass state can reach past it — including a bypass that
   * was granted before the ceiling existed in this session.
   */
  shouldBypass(taskId: string | undefined, policy: ToolInvocationPolicy): boolean {
    if (!isToolBypassable(policy)) {
      return false;
    }

    const category = policy.category;

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
    this.settleMatchingPending(request => request.taskId === taskId, 'deny');
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
    this.settleMatchingPending(() => true, decision);
  }

  private settleMatchingPending(
    predicate: (request: PendingToolApprovalRequest) => boolean,
    decision: ToolApprovalDecision,
  ): void {
    const matching = this.pendingApprovals.filter(predicate);
    if (matching.length === 0) {
      return;
    }

    const matchingIds = new Set(matching.map(request => request.id));
    const resolvers = matching
      .map(request => this.pendingApprovalResolvers.get(request.id))
      .filter((resolver): resolver is (decision: ToolApprovalDecision) => void => Boolean(resolver));

    for (const requestId of matchingIds) {
      this.pendingApprovalResolvers.delete(requestId);
    }
    this.pendingApprovals = this.pendingApprovals.filter(request => !matchingIds.has(request.id));
    this.notifyPendingApprovalChange();

    for (const resolver of resolvers) {
      resolver(decision);
    }
  }

  /**
   * A scope grant can settle only ordinary approval cards that accept that
   * decision and whose policy is below the non-waivable ceiling. The request
   * the operator actually clicked is handled separately: that click is still
   * explicit one-time authorization for the displayed action.
   */
  private canResolveFromScope(
    request: PendingToolApprovalRequest,
    decision: Extract<ToolApprovalDecision, 'bypass-task' | 'autopilot'>,
  ): boolean {
    return this.isDecisionAllowed(request, decision) && isToolBypassable({
      category: request.category,
      risk: request.risk,
      summary: request.summary,
    });
  }

  private isDecisionAllowed(request: PendingToolApprovalRequest, decision: ToolApprovalDecision): boolean {
    return request.allowedDecisions === undefined || request.allowedDecisions.includes(decision);
  }

  private createRequestId(taskId: string, toolName: string): string {
    const slug = toolName.replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '').toLowerCase() || 'tool';
    return `${taskId}:${slug}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  }
}
