/**
 * FollowUpScheduler — the in-process reminder engine for Project Director
 * follow-ups (Phase 4).
 *
 * Safety note: this scheduler is **notification-only and deny-by-default**. It
 * never sends anything outbound on a timer — outbound messaging always needs an
 * explicit per-send confirmation (see {@link ./directorCommsRunner}). All it
 * does is surface a throttled in-editor nudge that opens the Director tab, so a
 * developer never loses track of an overdue check-in without being nagged.
 *
 * The pure evaluation helpers are `vscode`-free and unit-tested; the class holds
 * the timer and throttle, with the notification + key store injected so it stays
 * testable.
 */

import type { ProjectDirectorConfig } from '../types.js';
import { deriveFollowUpUrgency } from './projectDirectorManager.js';

export interface FollowUpDueSummary {
  overdue: number;
  dueSoon: number;
  /** Active (open/snoozed) follow-up count. */
  total: number;
}

/** Count active follow-ups by urgency for a reminder nudge (pure). */
export function summarizeDueFollowUps(
  config: ProjectDirectorConfig | undefined,
  now: Date = new Date(),
): FollowUpDueSummary {
  const summary: FollowUpDueSummary = { overdue: 0, dueSoon: 0, total: 0 };
  if (!config) {
    return summary;
  }
  for (const followUp of config.followUps) {
    if (followUp.status === 'done' || followUp.status === 'cancelled') {
      continue;
    }
    summary.total += 1;
    const urgency = deriveFollowUpUrgency(followUp, now);
    if (urgency === 'overdue') {
      summary.overdue += 1;
    } else if (urgency === 'due-soon') {
      summary.dueSoon += 1;
    }
  }
  return summary;
}

/** One-line reminder text, or undefined when nothing is due/overdue (pure). */
export function buildReminderMessage(summary: FollowUpDueSummary): string | undefined {
  if (summary.overdue === 0 && summary.dueSoon === 0) {
    return undefined;
  }
  const parts: string[] = [];
  if (summary.overdue > 0) { parts.push(`${summary.overdue} overdue`); }
  if (summary.dueSoon > 0) { parts.push(`${summary.dueSoon} due soon`); }
  const count = summary.overdue + summary.dueSoon;
  return `Project Director: ${parts.join(', ')} follow-up${count === 1 ? '' : 's'}.`;
}

/** Local calendar date key (yyyy-mm-dd). */
function dateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export interface FollowUpSchedulerDeps {
  getConfig: () => ProjectDirectorConfig | undefined;
  /** Last reminder date-key ('yyyy-mm-dd'), or undefined. Persisted by the caller. */
  getLastReminderKey: () => string | undefined;
  setLastReminderKey: (key: string) => void;
  /** Surface the reminder to the user (non-modal). */
  notify: (message: string, summary: FollowUpDueSummary) => void;
  now?: () => Date;
}

export class FollowUpScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly deps: FollowUpSchedulerDeps) {}

  /**
   * Evaluate now and nudge **once per calendar day** when follow-ups are due or
   * overdue. Returns true if it nudged. The once-per-day throttle survives
   * restarts because the key store is persisted by the caller.
   */
  runOnce(): boolean {
    const now = (this.deps.now ?? (() => new Date()))();
    const todayKey = dateKey(now);
    if (this.deps.getLastReminderKey() === todayKey) {
      return false;
    }
    const summary = summarizeDueFollowUps(this.deps.getConfig(), now);
    const message = buildReminderMessage(summary);
    if (!message) {
      return false;
    }
    this.deps.setLastReminderKey(todayKey);
    this.deps.notify(message, summary);
    return true;
  }

  /** Start the recurring evaluation timer (idempotent). */
  start(intervalMs: number): void {
    this.stop();
    this.timer = setInterval(() => {
      try {
        this.runOnce();
      } catch {
        // Best-effort; a bad tick must never crash the extension host.
      }
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  dispose(): void {
    this.stop();
  }
}
