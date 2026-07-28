/**
 * Getting the user's attention when something is waiting on them.
 *
 * A tool approval blocks a run until it is answered. Until now the only
 * reaction to a new one was repainting the chat webview — which does nothing at
 * all if you are looking somewhere else, and you can be: the approval bar lives
 * in the AtlasMind panel while you may be in VS Code's own chat, in an editor,
 * or in another window. The run then sits there, silently, looking like it has
 * hung. A prompt nobody can see is worse than an interruption.
 *
 * Interrupting has its own cost, though, so this is not "always steal focus":
 *
 *  - **Already on screen ⇒ say nothing.** Yanking focus toward a bar the user
 *    is already looking at is pure noise, and noise is what teaches people to
 *    dismiss prompts without reading them.
 *  - **Only newly-arrived requests announce.** The pending list also changes
 *    when a request is *answered*; re-announcing on every change would fire a
 *    notification every time you approved something.
 *  - **Notify even when revealing.** Revealing a panel can be missed — the
 *    window may not be focused, or the reveal may lose a race with whatever the
 *    user is doing. A notification persists until it is dismissed, so it is the
 *    signal that actually survives.
 *
 * Pure, `vscode`-free, and unit-tested.
 */

/** The minimum a caller needs to know about a waiting request. */
export interface PendingApprovalLike {
  id: string;
  summary?: string;
  risk?: string;
  toolName?: string;
}

export interface ApprovalAttentionInput {
  /** Request ids known at the previous notification. */
  previousIds: readonly string[];
  /** Requests waiting right now. */
  pending: readonly PendingApprovalLike[];
  /** True when the approval surface is on screen. */
  surfaceVisible: boolean;
  /** `atlasmind.chat.revealOnApprovalRequest`. */
  revealEnabled: boolean;
}

export interface ApprovalAttention {
  /** Bring the approval surface forward. */
  reveal: boolean;
  /** Show a dismissible notification naming what is waiting. */
  notify: boolean;
  /** One line describing what needs an answer. */
  summary: string;
  /** Ids that have now been announced, to carry into the next comparison. */
  announcedIds: string[];
}

/** Longest summary shown in a notification, which is a line and not a paragraph. */
export const MAX_ATTENTION_SUMMARY = 120;

/**
 * Decide whether anything should interrupt the user, and how loudly.
 *
 * Returns undefined when nothing new is waiting — the common case, since this
 * runs on every change to the pending list including resolutions.
 */
export function decideApprovalAttention(input: ApprovalAttentionInput): ApprovalAttention | undefined {
  const known = new Set(input.previousIds);
  const arrived = input.pending.filter(request => typeof request.id === 'string' && request.id && !known.has(request.id));
  if (arrived.length === 0) {
    return undefined;
  }

  const announcedIds = input.pending.map(request => request.id);

  // Already looking at it: record that these are known, but stay quiet.
  if (input.surfaceVisible) {
    return { reveal: false, notify: false, summary: '', announcedIds };
  }

  return {
    reveal: input.revealEnabled,
    // Always, even when revealing — a reveal can be missed, a notification waits.
    notify: true,
    summary: describePendingApprovals(arrived),
    announcedIds,
  };
}

/**
 * One line naming what is waiting.
 *
 * Names the actual action rather than saying "approval required", because a
 * message that does not say what it is about gives no reason to switch to it.
 */
export function describePendingApprovals(requests: readonly PendingApprovalLike[]): string {
  if (requests.length === 0) {
    return '';
  }
  const first = requests[0]!;
  const detail = (first.summary ?? first.toolName ?? 'a tool call').trim();
  const clamped = detail.length > MAX_ATTENTION_SUMMARY
    ? `${detail.slice(0, MAX_ATTENTION_SUMMARY).trimEnd()}…`
    : detail;
  const more = requests.length > 1 ? ` (+${requests.length - 1} more waiting)` : '';
  return `${clamped}${more}`;
}
