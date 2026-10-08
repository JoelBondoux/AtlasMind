/**
 * What a routine may do when nobody is watching it run.
 *
 * `routineExecutionPolicy` decides what a routine *would* run and makes it fit
 * to show somebody. A routine started from `/ship` or the Run Center is then
 * shown to a person who says yes. A **scheduled** run has that person once, at
 * approval time, and never again — so this module answers the question that
 * remains: of the steps somebody approved last Tuesday, which may still run at
 * 02:00 with nobody at the keyboard?
 *
 * Five rules.
 *
 * **The ceiling is `propose`.** The workflow's operator ceiling is `propose`,
 * and an unattended run cannot exceed what an attended one may do. A scheduled
 * run prepares work for review — on its own branch, in its own worktree — and
 * reports back. It never pushes, publishes, deploys, merges, opens a pull
 * request or touches the developer's working tree. Steps that would are
 * refused by declaration, whatever the routine file says.
 *
 * **What needs a person is refused, never auto-approved.** An install is the
 * clearest case: the command somebody approved was `npm update`, but what it
 * executes is decided by the registry on the night — new versions, new
 * lifecycle scripts — and nobody saw those. Reading the command was the
 * approval; it cannot have been an approval of code that did not exist yet.
 * So the run stops there and says "would need a person", rather than doing it.
 *
 * **The run stops at the first step it may not take.** Steps before it run;
 * that step and everything after it are listed as not run, with the rule. Not
 * "skip the refused step and carry on": a routine's later steps assume its
 * earlier ones happened, and running the tests on dependencies that were never
 * updated reports a result for a state nobody asked about.
 *
 * **A step that would have asked stops instead.** `on_fail: prompt` asks the
 * person present whether to retry, skip or abort. Nobody is present, so the
 * answer is abort — and the report says it would have asked.
 *
 * **Spend is zero by construction, not by a cap.** The scheduled executor holds
 * no model: steps are shell commands, their output goes into the run record and
 * nowhere else, and nothing a step prints is read by an agent. So there is no
 * model spend to cap and no untrusted text in any model's context to taint
 * (`contextProvenance` has nothing to see). A spend-cap setting here would be a
 * switch that gates nothing — offering one would suggest the run can spend.
 *
 * **Installed dependencies are prepared by a person, never on the night.** A
 * fresh worktree has no `node_modules`. Under the execution sandbox's
 * `require`, a step that loads installed packages (`classifyDependencyNeed`,
 * the vocabulary `sandboxPlan` shares) runs against a dependency volume
 * somebody prepared for that lockfile; with none, the sandbox refuses the step
 * and the run is reported as needing a person. Preparing one is an install, and
 * stays refused here by `installs-packages`.
 *
 * Pure. Nothing here runs a command or touches git.
 */

import type { RoutineDefinition } from '../types.js';
import { classifyDeliveryCommandReach } from './deliveryRunPlan.js';
import type { RoutineExecutionPlan, RoutinePlannedStep } from './routineExecutionPolicy.js';
import { deriveBranchName, slugifyBranchTitle } from './branchNaming.js';

export type UnattendedStepRuleId = 'leaves-the-machine' | 'changes-history' | 'installs-packages';

export interface UnattendedStepRule {
  id: UnattendedStepRuleId;
  /** Said in the report and the approval dialog, so the rule that stopped a run is the rule shown. */
  description: string;
}

/**
 * Words after `git` that change history, refs or the shared configuration.
 * Matched as words anywhere in the command, so `git -C dir commit` and
 * `git log --grep=merge` are both caught — the second is a false positive, and
 * refusing a read is the cheap direction to be wrong in here.
 */
const GIT_WRITE_VERBS = [
  'commit', 'push', 'merge', 'rebase', 'reset', 'tag', 'checkout', 'switch', 'branch', 'stash',
  'cherry-pick', 'revert', 'pull', 'fetch', 'worktree', 'clean', 'am', 'filter-branch', 'update-ref',
  'remote', 'config', 'submodule', 'notes', 'gc', 'prune',
];

const HISTORY_PATTERNS: readonly RegExp[] = [
  new RegExp(`\\bgit\\b[^&|;\\n]*?(?<![\\w-])(?:${GIT_WRITE_VERBS.join('|')})(?![\\w-])`, 'i'),
  /\bgh\s+\w+\s+(?:create|merge|close|edit|delete|comment|reopen|ready|review|upload|set|run|lock|transfer|archive)\b/i,
  // `npm version` commits and tags in a git repository unless told not to.
  /\b(?:npm|pnpm|yarn)\s+version\b/i,
];

const INSTALL_PATTERNS: readonly RegExp[] = [
  /\b(?:npm|pnpm|yarn|bun)\s+(?:install|i|ci|add|update|up|upgrade|dedupe|rebuild)\b/i,
  /\b(?:npm|pnpm|yarn|bun)\s+audit\s+fix\b/i,
  // `npx` downloads a package and runs it. Bare `yarn` installs.
  /(?:^|[\s;&|(])npx\s/i,
  /(?:^|[;&|]\s*)yarn\s*(?:$|[;&|])/i,
  /\bpip3?\s+install\b/i,
  /\b(?:poetry|pipenv|uv)\s+(?:install|add|update|sync|lock)\b/i,
  /\bcargo\s+(?:install|update)\b/i,
  /\bgo\s+(?:get|install)\b/i,
  /\bgem\s+install\b/i,
  /\bbundle\s+(?:install|update)\b/i,
  /\bcomposer\s+(?:install|update|require)\b/i,
  /\bdotnet\s+(?:restore|add\s+package)\b/i,
  /\b(?:brew|apt|apt-get|choco|winget|scoop)\s+install\b/i,
];

/** Evaluated in order; the first that matches is the one reported. */
export const UNATTENDED_STEP_RULES: readonly UnattendedStepRule[] = [
  {
    id: 'leaves-the-machine',
    description: 'Pushes, publishes or deploys. A scheduled run stops at propose: it prepares work for review and never sends it anywhere.',
  },
  {
    id: 'changes-history',
    description: 'Commits, merges, rebases, tags, switches or deletes in git, or acts on a pull request. A scheduled run reports back on its own branch; changing history is somebody\'s decision.',
  },
  {
    id: 'installs-packages',
    description: 'Installs or updates packages. What an install runs is decided by the registry on the night, not by the command somebody approved, so it needs a person present.',
  },
];

function ruleFor(id: UnattendedStepRuleId): UnattendedStepRule {
  return UNATTENDED_STEP_RULES.find(rule => rule.id === id)!;
}

/** The rule that refuses this command unattended, or `undefined` when it may run. */
export function classifyUnattendedStep(command: string): UnattendedStepRule | undefined {
  const text = String(command ?? '');
  if (classifyDeliveryCommandReach(text) === 'outward') {
    return ruleFor('leaves-the-machine');
  }
  if (HISTORY_PATTERNS.some(pattern => pattern.test(text))) {
    return ruleFor('changes-history');
  }
  if (INSTALL_PATTERNS.some(pattern => pattern.test(text))) {
    return ruleFor('installs-packages');
  }
  return undefined;
}

// ── Installed dependencies ───────────────────────────────────────

/**
 * Executables that load a project's installed JavaScript dependencies. A
 * declared list, deliberately literal: it decides whether a command needs a
 * `node_modules`, and a command it misses runs exactly as it did before the
 * dependency volume existed — so a miss costs a confusing failure, never a
 * weaker boundary. Shared with `sandboxPlan` so the sandbox and the unattended
 * approval cannot disagree about which steps need dependencies.
 */
export const NODE_DEPENDENCY_TOOLS: ReadonlySet<string> = new Set([
  'node', 'npm', 'pnpm', 'yarn', 'corepack',
  'tsc', 'tsx', 'ts-node', 'vitest', 'jest', 'mocha', 'ava', 'c8', 'nyc',
  'eslint', 'prettier', 'biome', 'playwright', 'cypress',
  'vite', 'webpack', 'rollup', 'esbuild', 'swc', 'next', 'nuxt', 'astro', 'ng', 'nx', 'turbo', 'lerna',
  'cross-env', 'node-gyp', 'electron', 'vsce',
]);

const SHELLS: ReadonlySet<string> = new Set(['sh', 'bash', 'dash', 'zsh', 'ash']);

const NODE_TOOL_IN_TEXT = new RegExp(
  `(?<![\\w./-])(?:${[...NODE_DEPENDENCY_TOOLS].map(tool => tool.replace(/[-]/g, '\\-')).join('|')})(?![\\w-])|node_modules`,
);

export type DependencyNeedRuleId = 'node-tooling' | 'node-modules-path' | 'shell-runs-node-tooling' | 'no-node-tooling';

/** Evaluated in order; the first that matches is the one reported. */
export const DEPENDENCY_NEED_RULES: ReadonlyArray<{ id: DependencyNeedRuleId; needed: boolean; description: string }> = [
  { id: 'node-tooling', needed: true, description: 'The executable is a JavaScript runtime, package manager or tool that loads installed packages.' },
  { id: 'node-modules-path', needed: true, description: 'The executable lives under ./node_modules — it is an installed package.' },
  {
    id: 'shell-runs-node-tooling',
    needed: true,
    description: 'A shell runs a script (`-c`) that names one of those tools or node_modules — a routine step is exactly this shape.',
  },
  {
    id: 'no-node-tooling',
    needed: false,
    description: 'Nothing in the command names a tool that loads installed packages. It runs as before; if it needed them after all, it fails the way it did before.',
  },
];

function toolBaseName(executable: string): string {
  const base = String(executable ?? '').trim().split(/[\\/]/).pop() ?? '';
  return base.toLowerCase().replace(/\.(?:exe|cmd|bat|ps1)$/, '');
}

/** Whether a command loads the project's installed dependencies, and the rule that says so. */
export function classifyDependencyNeed(
  executable: string,
  args: readonly string[],
): { needed: boolean; rule: DependencyNeedRuleId } {
  const raw = String(executable ?? '').trim();
  const name = toolBaseName(raw);
  if (NODE_DEPENDENCY_TOOLS.has(name)) {
    return { needed: true, rule: 'node-tooling' };
  }
  if (/^(?:\.\/)?node_modules\//.test(raw.replace(/\\/g, '/'))) {
    return { needed: true, rule: 'node-modules-path' };
  }
  if (SHELLS.has(name)) {
    const list = (args ?? []).map(arg => String(arg ?? ''));
    const script = list.findIndex(arg => /^-[a-z]*c[a-z]*$/i.test(arg));
    if (script !== -1 && NODE_TOOL_IN_TEXT.test(list.slice(script + 1).join(' '))) {
      return { needed: true, rule: 'shell-runs-node-tooling' };
    }
  }
  return { needed: false, rule: 'no-node-tooling' };
}

/**
 * Said in the unattended approval when a step needs installed dependencies,
 * so what somebody agrees to is what the scheduled run will do with them.
 */
export const UNATTENDED_DEPENDENCY_NOTE = 'Steps that need installed dependencies run, under atlasmind.sandbox.mode require, in the execution '
  + 'sandbox against the dependency volume you prepared for this lockfile with AtlasMind: Prepare Sandbox Dependencies. If none is '
  + 'prepared for the lockfile the run checks out, the run stops at that step and reports that dependencies are not prepared. '
  + 'Nothing is installed unattended. Under mode off they run in the fresh worktree, which has no installed dependencies.';

export interface UnattendedRunPlan {
  /** The prefix of the plan that may run. Possibly empty. */
  runnable: RoutinePlannedStep[];
  /** The first step it may not take, and why. Absent when everything may run. */
  stoppedAt?: { step: RoutinePlannedStep; rule: UnattendedStepRule };
  /** `stoppedAt.step` and everything after it, in order. */
  notRun: RoutinePlannedStep[];
  /** Runnable steps whose failure would have asked a person; they abort instead. */
  wouldHaveAsked: RoutinePlannedStep[];
}

/** Split a ready plan at the first step an unattended run may not take. */
export function planUnattendedRun(plan: Extract<RoutineExecutionPlan, { status: 'ready' }>): UnattendedRunPlan {
  const runnable: RoutinePlannedStep[] = [];
  for (let index = 0; index < plan.steps.length; index += 1) {
    const step = plan.steps[index]!;
    const rule = classifyUnattendedStep(step.command);
    if (rule) {
      return {
        runnable,
        stoppedAt: { step, rule },
        notRun: plan.steps.slice(index),
        wouldHaveAsked: runnable.filter(entry => entry.onFail === 'prompt'),
      };
    }
    runnable.push(step);
  }
  return { runnable, notRun: [], wouldHaveAsked: runnable.filter(entry => entry.onFail === 'prompt') };
}

/**
 * The plan the runner executes: the runnable prefix and nothing else.
 *
 * `outward` is empty by construction — every outward step was refused above —
 * and is rebuilt here rather than filtered, so a change to that rule cannot leave
 * a push in the plan's outward list while removing it from its steps.
 */
export function toUnattendedExecutionPlan(
  plan: Extract<RoutineExecutionPlan, { status: 'ready' }>,
  unattended: UnattendedRunPlan,
): Extract<RoutineExecutionPlan, { status: 'ready' }> {
  return {
    routineId: plan.routineId,
    routineName: plan.routineName,
    status: 'ready',
    steps: [...unattended.runnable],
    outward: [],
  };
}

/**
 * The branch a scheduled run reports back on: `chore/scheduled-<routine>-<date>`.
 *
 * Derived through `deriveBranchName`, so it cannot produce a protected name or
 * an invalid ref, and a second run on the same day gets the ordinal `-2` rather
 * than a timestamp. The routine id is slugged on its own first, with a budget,
 * because a long id would otherwise push the date off the end — and the date is
 * the part somebody reading a list of these branches needs.
 */
export function scheduledRunBranchName(
  routineId: string,
  now: Date,
  existing: readonly string[],
): { ok: true; name: string } | { ok: false; reason: string } {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const routineSlug = slugifyBranchTitle(routineId, 30);
  if (!routineSlug) {
    return { ok: false, reason: `The routine id \`${routineId}\` has nothing usable in a branch name.` };
  }
  const derived = deriveBranchName({ type: 'chore', title: `scheduled ${routineSlug} ${date}`, existing: [...existing] });
  return derived.ok ? { ok: true, name: derived.name } : { ok: false, reason: derived.reason };
}

/**
 * What somebody agrees to when they approve a routine to run unattended.
 *
 * Composed here so the dialog shows the same split the runner will act on — a
 * person cannot agree to what is decided after they agree.
 */
export function describeUnattendedApproval(
  routine: Pick<RoutineDefinition, 'name'>,
  scheduleDescription: string,
  plan: RoutineExecutionPlan,
): string {
  if (plan.status === 'refused') {
    return `"${routine.name}" cannot run unattended: ${plan.refusals.map(refusal => refusal.detail).join(' ')} `
      + 'A scheduled run has nobody present to supply a value.';
  }
  const unattended = planUnattendedRun(plan);
  const lines: string[] = [
    `${scheduleDescription}, only while the editor is open. A missed run is caught up once, never repeated.`,
    '',
    'Each run happens in a new git worktree on its own chore/scheduled-… branch. It never touches your working tree, '
      + 'and it never pushes, merges or opens a pull request: it reports back and leaves the branch for you.',
    '',
  ];
  if (unattended.runnable.length > 0) {
    lines.push('Will run unattended:');
    unattended.runnable.forEach((step, index) => lines.push(`  ${index + 1}. ${step.command}`));
  } else {
    lines.push('Nothing in this routine can run unattended.');
  }
  if (unattended.stoppedAt) {
    lines.push('', `Will stop before \`${unattended.stoppedAt.step.command}\` and report that it needs you: `
      + unattended.stoppedAt.rule.description);
    if (unattended.notRun.length > 1) {
      lines.push(`Not run unattended: ${unattended.notRun.map(step => step.command).join(', ')}.`);
    }
  }
  if (unattended.wouldHaveAsked.length > 0) {
    lines.push('', `If ${unattended.wouldHaveAsked.map(step => step.label).join(', ')} fails, the run stops instead of asking.`);
  }
  if (unattended.runnable.some(step => classifyDependencyNeed('sh', ['-c', step.command]).needed)) {
    lines.push('', UNATTENDED_DEPENDENCY_NOTE);
  }
  lines.push('', 'Editing any step afterwards withdraws this approval until you give it again.');
  return lines.join('\n');
}

export interface ScheduledRunReportInput {
  routineName: string;
  outcome: 'completed' | 'needs-a-person' | 'failed' | 'refused';
  /** The failing step's label, when a step failed. */
  failedStep?: string;
  stoppedAt?: { command: string; rule: UnattendedStepRule };
  branch?: string;
  /** Present only when the worktree was kept. */
  worktreePath?: string;
  refusedReason?: string;
  /**
   * The step the execution sandbox refused because no dependency volume is
   * prepared for this lockfile. Reported as needing a person: preparing one is
   * a network-on install, which never happens unattended.
   */
  dependenciesNotPrepared?: { step: string };
}

/** The report a scheduled run leaves behind, in one or two sentences. */
export function describeScheduledRunReport(input: ScheduledRunReportInput): string {
  const where = input.worktreePath && input.branch
    ? ` Its changes are on \`${input.branch}\` in ${input.worktreePath}; merging them is your decision.`
    : '';
  if (input.dependenciesNotPrepared) {
    return `Scheduled run of "${input.routineName}" stopped at "${input.dependenciesNotPrepared.step}": dependencies are not prepared `
      + 'in the execution sandbox for the lockfile this run checked out. Run AtlasMind: Prepare Sandbox Dependencies yourself — '
      + `a scheduled run never installs anything.${where}`;
  }
  switch (input.outcome) {
    case 'refused':
      return `Scheduled run of "${input.routineName}" did not start: ${input.refusedReason ?? 'it was refused before any step ran.'}`;
    case 'failed':
      return `Scheduled run of "${input.routineName}" failed${input.failedStep ? ` at "${input.failedStep}"` : ''}.${where}`;
    case 'needs-a-person':
      return `Scheduled run of "${input.routineName}" stopped before \`${input.stoppedAt?.command ?? 'a step'}\`, `
        + `which needs you: ${input.stoppedAt?.rule.description ?? ''}${where}`;
    case 'completed':
      return `Scheduled run of "${input.routineName}" completed.${where || ' It changed nothing, so its worktree was removed.'}`;
  }
}

// ── Built-in template ────────────────────────────────────────────

/** Where the dependency-check template is written. Create-only. */
export const DEPENDENCY_CHECK_ROUTINE_FILE = 'dependency-check.md';

/**
 * The nightly dependency check, as a routine file a person adds and approves.
 *
 * Every command is a constant here. Honest about its own limit: run
 * unattended, it lists what is outdated and then stops at `npm update`, because
 * an install needs a person present (see `installs-packages`). That is the
 * template working as designed, not failing — the report says what is out of
 * date and that the update is waiting for you. Run attended from `/ship`, it
 * does all three steps.
 *
 * A fresh worktree has no `node_modules`, so `npm outdated` reports installed
 * versions as missing and still lists wanted and latest — which is the part
 * this check is for.
 */
export const DEPENDENCY_CHECK_ROUTINE_TEMPLATE = `---
id: dependency-check
name: Nightly dependency check
description: Lists outdated dependencies. Updating them and running the tests needs a person, so a scheduled run stops there and reports.
schedule: daily at 02:00
steps:
  - id: outdated
    label: List outdated dependencies
    run: npm outdated
    on_fail: continue
  - id: update
    label: Update dependencies within their declared ranges
    run: npm update
    on_fail: abort
  - id: test
    label: Run the tests
    run: npm test
    on_fail: abort
---

Added from AtlasMind's built-in template. The \`schedule\` line asks for a nightly
run; nothing runs until scheduled routines are switched on
(\`atlasmind.routines.scheduling.enabled\`) and you approve this routine with
**AtlasMind: Manage Scheduled Routines**.

Unattended, it runs \`npm outdated\` in a fresh worktree and stops before
\`npm update\`: an install executes whatever the registry serves that night, which
nobody approved, so it waits for you. \`npm outdated\` exits non-zero when anything
is out of date, which is why that step continues on failure.

Run it yourself with \`/ship dependency-check\` to update and test in your own
working tree.
`;
