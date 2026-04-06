/**
 * Manages runtime tool approval state for "Bypass Approvals" and "Autopilot"
 * modes. State is not persisted—clears on extension restart.
 */

import type { ToolApprovalState, ToolRiskCategory } from '../types.js';

export class ToolApprovalManager {
  private state: ToolApprovalState = { autopilot: false };
  /**
   * Categories bypassed for the current task. Cleared when task ends.
   * Keyed by task ID → set of risk categories.
   */
  private bypassedCategories = new Map<string, Set<ToolRiskCategory>>();

  /** Fired whenever autopilot mode changes so UI can update. */
  private autopilotChangeListeners: Array<(enabled: boolean) => void> = [];

  // ── Public API ─────────────────────────────────────────────────

  isAutopilot(): boolean {
    return this.state.autopilot;
  }

  enableAutopilot(): void {
    this.state.autopilot = true;
    this.notifyAutopilotChange(true);
  }

  disableAutopilot(): void {
    this.state.autopilot = false;
    this.notifyAutopilotChange(false);
  }

  toggleAutopilot(): boolean {
    this.state.autopilot = !this.state.autopilot;
    this.notifyAutopilotChange(this.state.autopilot);
    return this.state.autopilot;
  }

  /**
   * Bypass approvals for a specific task. All tools in that task will
   * proceed without prompting until the task ends.
   */
  bypassTask(taskId: string): void {
    this.state.bypassTaskId = taskId;
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
  }

  /**
   * Reset all approval state (clears autopilot and all task bypasses).
   */
  reset(): void {
    this.state = { autopilot: false };
    this.bypassedCategories.clear();
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
}
