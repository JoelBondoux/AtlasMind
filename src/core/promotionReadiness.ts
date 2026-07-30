/**
 * Whether a promotion path is ready to be opened, judged from what the sidebar
 * can actually know.
 *
 * The Project State tree is built **synchronously** — `compute()` reads
 * in-memory registries and configuration and shells out to nothing. That is a
 * deliberate property of the view (it recomputes on ten different events), and
 * it decides what this module is allowed to claim.
 *
 * So the honest signal here is *"is this path set up and unblocked"*, not
 * *"is it safe to ship"*. The working tree, the version delta and live CI are
 * all evaluated when the promotion plan is built, which needs git and `gh`. A
 * green row that had silently skipped those would be the most dangerous thing
 * this feature could produce: a shipping light that never looked at the code.
 *
 * Hence the vocabulary below deliberately avoids "ready" and "safe". `clear`
 * means nothing *declared* is in the way — and every tooltip says where the
 * real gates are checked.
 *
 * The blocker rules mirror the Delivery dashboard's exactly, because two
 * definitions of "blocked" would eventually disagree, and the one in the
 * sidebar would be the one nobody tested.
 *
 * Pure and `vscode`-free.
 */

import type { DeploymentStage, PromotionPath } from '../types.js';

export type PromotionReadinessVerdict =
  /** A declared blocker. Opening the plan will refuse until it is fixed. */
  | 'blocked'
  /** Unblocked, but the target declares gates that are evaluated on open. */
  | 'gated'
  /** Unblocked and the target declares no gates of its own. */
  | 'clear';

export interface PromotionReadiness {
  pathId: string;
  fromName: string;
  toName: string;
  verdict: PromotionReadinessVerdict;
  /** Short, for the row's dimmed description. */
  summary: string;
  /** The full explanation, including what is *not* checked here. */
  tooltip: string;
  /** A VS Code ThemeIcon id. */
  icon: string;
  /** True only for a blocker — something a person must go and fix. */
  needsAttention: boolean;
  /** Whether the target stage is protected, so the row can say so. */
  isProtected: boolean;
}

/**
 * The one sentence every tooltip carries.
 *
 * Without it a green row reads as "everything checks out, ship it", which this
 * module cannot possibly have established. Naming the gap is what makes the
 * signal safe to show at all.
 */
const NOT_CHECKED_HERE =
  'The working tree, the version delta and live CI are checked when the promotion plan opens — not here.';

/**
 * Why a promotion cannot run, using the same two rules as the dashboard.
 *
 * Exported so the dashboard can adopt it rather than keeping its own copy; two
 * definitions of "blocked" would drift, and the sidebar's would be the untested
 * one.
 */
export function promotionBlockReason(path: PromotionPath, to: DeploymentStage): string {
  const backupConfigured = Boolean(to.backupPolicy.command && to.backupPolicy.command.trim().length > 0);
  if (to.backupPolicy.required && !backupConfigured) {
    return `${to.name} requires a backup, and no backup command is configured.`;
  }
  if (to.promotionPolicy.viaPullRequest === true && !path.routineId) {
    return `${to.name} is reached through a pull request, and no promotion routine is bound to open one.`;
  }
  return '';
}

/** The gates the target declares, in words. Empty when it declares none. */
function describeGates(to: DeploymentStage): string[] {
  const gates: string[] = [];
  if (to.promotionPolicy.requiresApproval) {
    gates.push('explicit approval');
  }
  if (to.promotionPolicy.requireVersionBump) {
    gates.push('a version bump');
  }
  if (to.promotionPolicy.requireChangelog) {
    gates.push('a changelog entry');
  }
  const checks = to.promotionPolicy.requiredChecks.length;
  if (checks > 0) {
    gates.push(`${checks} manual check${checks === 1 ? '' : 's'}`);
  }
  const status = to.promotionPolicy.requiredStatusChecks?.length ?? 0;
  if (status > 0) {
    gates.push(`${status} CI check${status === 1 ? '' : 's'}`);
  }
  return gates;
}

/** Assess one promotion path. */
export function assessPromotionReadiness(
  path: PromotionPath,
  from: DeploymentStage,
  to: DeploymentStage,
): PromotionReadiness {
  const blockReason = promotionBlockReason(path, to);
  const base = {
    pathId: path.id,
    fromName: from.name,
    toName: to.name,
    isProtected: to.isProtected,
  };

  if (blockReason) {
    return {
      ...base,
      verdict: 'blocked',
      summary: 'blocked',
      // A blocker is the one verdict that is a fact rather than a forecast, so
      // it states the fix rather than deferring to the plan.
      tooltip: `${from.name} → ${to.name}\n\nBlocked: ${blockReason}\n\nOpening the plan will refuse until that is fixed.`,
      icon: 'error',
      needsAttention: true,
    };
  }

  const gates = describeGates(to);
  const protectedNote = to.isProtected
    ? `\n\n${to.name} is protected: promoting to it always confirms, and never force-pushes.`
    : '';

  if (gates.length > 0) {
    return {
      ...base,
      verdict: 'gated',
      summary: `${gates.length} gate${gates.length === 1 ? '' : 's'}`,
      tooltip: `${from.name} → ${to.name}\n\nNothing declared is blocking this. It requires ${formatList(gates)}, `
        + `which the promotion plan evaluates when you open it.\n\n${NOT_CHECKED_HERE}${protectedNote}`,
      icon: 'shield',
      needsAttention: false,
    };
  }

  return {
    ...base,
    verdict: 'clear',
    summary: 'nothing declared blocking',
    tooltip: `${from.name} → ${to.name}\n\nNothing declared is blocking this promotion, and ${to.name} declares no `
      + `gates of its own.\n\n${NOT_CHECKED_HERE}${protectedNote}`,
    icon: 'rocket',
    needsAttention: false,
  };
}

/**
 * Assess every path in a pipeline, skipping any whose stages are missing.
 *
 * A path naming a stage that no longer exists is dropped rather than rendered
 * with a placeholder: a row offering to promote from nowhere is worse than a
 * row that is not there.
 */
export function assessPipelinePromotions(
  paths: readonly PromotionPath[],
  stages: readonly DeploymentStage[],
): PromotionReadiness[] {
  const byId = new Map(stages.map(stage => [stage.id, stage]));
  return paths.flatMap(path => {
    const from = byId.get(path.fromStageId);
    const to = byId.get(path.toStageId);
    return from && to ? [assessPromotionReadiness(path, from, to)] : [];
  });
}

function formatList(items: readonly string[]): string {
  if (items.length <= 1) {
    return items[0] ?? '';
  }
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
