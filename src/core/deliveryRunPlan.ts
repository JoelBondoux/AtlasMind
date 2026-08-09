/**
 * What a terminal will be asked to do — decided before anything is sent.
 *
 * The detected runbook on the Delivery page reads commands out of manifests,
 * scripts, routines and workflows. Rendering them was safe because rendering is
 * not running. Offering to run them is a different question, and this module is
 * where it is answered, as a value a test can walk rather than a convention a
 * refactor can lose.
 *
 * Three rules carry the semantics:
 *
 * **A column is planned, never improvised.** The webview names a phase; the host
 * rebuilds the guide and this module turns *that* phase into an ordered command
 * list. No message from the page can contribute command text, so the surface
 * that displays a command cannot widen into one that composes it. Steps in the
 * column that carry no command are reported in `skipped` rather than dropped,
 * because a plan that silently omits the manual gates reads as the whole column.
 *
 * **Fail-fast is a property of the shell, and it is reported rather than
 * assumed.** A delivery column that keeps going after `npm test` fails will
 * happily package and publish a broken build, so the plan states whether the
 * chain it produced can stop. Where the shell cannot express it — Windows
 * PowerShell 5.1 has no `&&`, and an unrecognised shell has made no promise —
 * the plan says so instead of emitting a line that might be a parse error, and
 * the confirmation repeats it in the sentence the user actually reads.
 *
 * **Reach is classified so the confirmation can differ.** "Run the tests" and
 * "publish to a registry" cannot be the same dialog. Reach comes from a declared
 * token list, matched on word boundaries; an unrecognised command is `local`,
 * which is safe here precisely because the classification only ever *adds* a
 * warning — every command in the plan is listed in the confirmation either way,
 * so a miss loses emphasis, never a gate.
 *
 * Nothing here touches `vscode`, a terminal, or the filesystem: it is pure, so
 * the properties above are unit-testable.
 */

import type { DeliveryGuidePhase } from './deliveryManager.js';

/** The one terminal delivery commands are sent to, so its cwd is the repo root. */
export const DELIVERY_RUN_TERMINAL_NAME = 'AtlasMind Delivery';

export type DeliveryShellFamily = 'posix' | 'pwsh' | 'powershell' | 'cmd' | 'unknown';

/** Whether a command's effect stops at this machine. */
export type DeliveryCommandReach = 'local' | 'outward';

export interface DeliveryRunCommand {
  stepId: string;
  label: string;
  command: string;
  reach: DeliveryCommandReach;
}

export interface DeliveryRunPlan {
  phaseId: string;
  phaseLabel: string;
  /** Every runnable command in the column, in the order the guide lists them. */
  commands: DeliveryRunCommand[];
  /** Steps in the column with nothing to run — named so the plan is not read as the column. */
  skipped: Array<{ stepId: string; label: string }>;
  /** Exactly what will be written to the terminal, in order. */
  lines: string[];
  /** True when a failing command stops the ones after it. */
  failFast: boolean;
  shellFamily: DeliveryShellFamily;
  /** Commands whose effect leaves this machine. Always a subset of `commands`. */
  outward: DeliveryRunCommand[];
}

const POSIX_SHELL_NAMES = new Set(['bash', 'zsh', 'sh', 'dash', 'ksh', 'ash', 'fish']);

/**
 * Identify the shell from its path. Only families whose chaining operator is
 * known are named; everything else stays `unknown`, because guessing that an
 * unfamiliar shell understands `&&` risks a parse error in place of a release.
 */
export function classifyDeliveryShell(shellPath: string | undefined): DeliveryShellFamily {
  const name = String(shellPath ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    ?.toLowerCase()
    .replace(/\.exe$/, '') ?? '';
  if (!name) { return 'unknown'; }
  if (name === 'pwsh' || name === 'pwsh-preview') { return 'pwsh'; }
  if (name === 'powershell') { return 'powershell'; }
  if (name === 'cmd') { return 'cmd'; }
  if (POSIX_SHELL_NAMES.has(name)) { return 'posix'; }
  return 'unknown';
}

/**
 * Windows PowerShell 5.1 predates `&&` and errors on it; every other family
 * here accepts it. `unknown` is treated as unable rather than assumed able.
 */
export function shellStopsOnFailure(family: DeliveryShellFamily): boolean {
  return family === 'posix' || family === 'pwsh' || family === 'cmd';
}

/**
 * Commands whose effect leaves this machine. A declared table, published in the
 * confirmation dialog's wording, because "this deploys" must be a stated rule
 * rather than a model's impression of a command string.
 */
const OUTWARD_COMMAND_PATTERNS: readonly RegExp[] = [
  // Source and release history
  /\bgit\s+push\b/i,
  /\bgh\s+(?:workflow\s+run|release\s+create|pr\s+(?:create|merge)|api)\b/i,
  // Package and extension registries
  /\b(?:npm|pnpm|yarn|bun)\s+publish\b/i,
  /\b(?:vsce|ovsx)\s+publish\b/i,
  /\bcargo\s+publish\b/i,
  /\btwine\s+upload\b/i,
  /\bdotnet\s+nuget\s+push\b/i,
  // `\b` cannot anchor before `./mvnw` — a leading dot is not a word character —
  // so these match on the whitespace/start boundary instead.
  /(?:^|\s)(?:\.\/)?(?:mvn|mvnw|gradle|gradlew)\b[^\n]*\b(?:deploy|publish)\b/i,
  // Images and infrastructure
  /\bdocker\s+push\b/i,
  /\bkubectl\s+(?:apply|rollout|delete)\b/i,
  /\bterraform\s+apply\b/i,
  /\b(?:wrangler|vercel|netlify|firebase|flyctl|fly|heroku|serverless|sls|eb)\b[^\n]*\bdeploy\b/i,
  /\b(?:az|aws|gcloud)\b[^\n]*\b(?:deploy|push|publish|up)\b/i,
  // A script named for the act is treated as the act; a project that calls a
  // script `publish` has told us what it does, and opening the file to be sure
  // would mean guessing at shell semantics.
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:publish|release|ship|deploy|tag)(?::[\w:.-]+)?\b/i,
];

export function classifyDeliveryCommandReach(command: string): DeliveryCommandReach {
  const text = String(command ?? '');
  return OUTWARD_COMMAND_PATTERNS.some(pattern => pattern.test(text)) ? 'outward' : 'local';
}

/**
 * Turn an ordered command list into the lines a terminal will receive. One
 * chained line where the shell can stop on failure, one line per command where
 * it cannot — and `failFast` says which happened, so the caller never has to
 * re-derive it. A single command is always fail-fast: there is nothing after it.
 */
export function chainDeliveryCommands(
  commands: readonly string[],
  family: DeliveryShellFamily,
): { lines: string[]; failFast: boolean } {
  const cleaned = commands.map(command => String(command ?? '').trim()).filter(Boolean);
  if (cleaned.length <= 1) {
    return { lines: cleaned, failFast: true };
  }
  return shellStopsOnFailure(family)
    ? { lines: [cleaned.join(' && ')], failFast: true }
    : { lines: cleaned, failFast: false };
}

/**
 * Plan one column of the detected runbook. `phase` must be a phase the host
 * just rebuilt from the workspace — never a shape assembled from a webview
 * message — because everything downstream trusts these command strings.
 */
export function buildDeliveryRunPlan(
  phase: DeliveryGuidePhase,
  shellPath: string | undefined,
): DeliveryRunPlan {
  const shellFamily = classifyDeliveryShell(shellPath);
  const commands: DeliveryRunCommand[] = [];
  const skipped: Array<{ stepId: string; label: string }> = [];
  for (const step of phase.steps) {
    const command = String(step.command ?? '').trim();
    if (command) {
      commands.push({ stepId: step.id, label: step.label, command, reach: classifyDeliveryCommandReach(command) });
    } else {
      skipped.push({ stepId: step.id, label: step.label });
    }
  }
  const { lines, failFast } = chainDeliveryCommands(commands.map(entry => entry.command), shellFamily);
  return {
    phaseId: phase.id,
    phaseLabel: phase.label,
    commands,
    skipped,
    lines,
    failFast,
    shellFamily,
    outward: commands.filter(entry => entry.reach === 'outward'),
  };
}

export interface DeliveryRunConfirmation {
  title: string;
  /** Every command, in order, plus what the run cannot promise. */
  detail: string;
  confirmLabel: string;
}

/**
 * The sentence the user actually reads before a column runs. Kept here and
 * tested, because the three things it must never omit — the exact commands, the
 * ones that reach outside this machine, and whether a failure stops the rest —
 * are the whole reason the confirmation exists.
 */
export function buildDeliveryRunConfirmation(plan: DeliveryRunPlan): DeliveryRunConfirmation {
  const count = plan.commands.length;
  const lines: string[] = [];
  lines.push(`AtlasMind will run ${count} command${count === 1 ? '' : 's'} in the ${DELIVERY_RUN_TERMINAL_NAME} terminal, in this order:`);
  lines.push('');
  plan.commands.forEach((entry, index) => {
    lines.push(`${index + 1}. ${entry.command}${entry.reach === 'outward' ? '   ⟵ leaves this machine' : ''}`);
  });
  if (plan.skipped.length > 0) {
    lines.push('');
    lines.push(`Not run (no command detected): ${plan.skipped.map(entry => entry.label).join(', ')}.`);
  }
  lines.push('');
  if (plan.outward.length > 0) {
    lines.push(
      `${plan.outward.length} of these reach${plan.outward.length === 1 ? 'es' : ''} beyond this machine — a push, deployment or publication cannot be undone by closing the terminal.`,
    );
  }
  lines.push(
    plan.failFast
      ? 'A failing command stops the ones after it.'
      : `This shell has no fail-fast chaining, so each command is sent separately: a failure will NOT stop the rest. Run them one at a time instead if that matters.`,
  );
  lines.push('AtlasMind does not read the terminal output; check the result yourself.');
  return {
    title: `Run the ${plan.phaseLabel} column?`,
    detail: lines.join('\n'),
    confirmLabel: plan.outward.length > 0 ? `Run ${count}, including ${plan.outward.length} outward` : `Run ${count} command${count === 1 ? '' : 's'}`,
  };
}
