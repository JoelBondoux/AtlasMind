/**
 * SetupWalkthrough — the shape every AtlasMind setup guide shares.
 *
 * The Buzz walkthrough worked because of a handful of decisions, none of which
 * are specific to Buzz: derive the state rather than asking the user to
 * self-report it, show one step at a time with the command written out, count
 * only the steps that actually gate the outcome, and never flip a switch on the
 * user's behalf. Every other integration deserves the same treatment, and
 * re-deriving those decisions per feature is how they get lost — the second
 * guide is always the one that quietly starts installing things.
 *
 * So the *mechanics* live here and the *content* lives per guide:
 *
 *   - `buzzSetupPlan.ts` and `acpSetupPlan.ts` decide what the steps are.
 *   - This module orders them, picks the next one, renders it, and counts
 *     progress — identically for every guide.
 *
 * Two properties are enforced rather than documented:
 *
 * 1. **A plan is never an installer.** Every action a step offers must be an
 *    *opening* action — a settings page, a panel, a docs URL, a command
 *    pre-loaded into a terminal that the user presses Enter on themselves, or
 *    the one explicitly allowlisted choice dialog whose selection is the
 *    setting value.
 *    {@link isOpeningAction} is the allowlist, and it is pinned by test, because
 *    a setup assistant that enabled the deny-by-default switches to be helpful
 *    would remove the property those switches exist to provide.
 * 2. **A step blocked only by an optional prerequisite is never nominated.**
 *    Sending someone to install a binary they do not need is how a guide
 *    teaches people to stop trusting it.
 *
 * Pure, `vscode`-free, and unit-tested.
 */

/** How far along one setup step is. */
export type SetupStatus =
  /** Satisfied. */
  | 'done'
  /** Not satisfied, and actionable right now. */
  | 'todo'
  /** Not satisfied, and cannot be until an earlier step is. */
  | 'blocked'
  /** A deliberate choice rather than a requirement — never nagged about. */
  | 'optional';

/**
 * One instruction. A `command` is spelled out in full so it can be copied or
 * typed for the user; `authored` distinguishes commands AtlasMind wrote from
 * commands quoted out of somebody else's documentation, which are never offered
 * as a one-click action.
 */
export interface SetupGuidanceLine {
  text: string;
  command?: string;
  authored?: boolean;
  url?: string;
}

export interface SetupStep {
  id: string;
  title: string;
  status: SetupStatus;
  /** One line explaining the current state, or what to do about it. */
  detail: string;
  /** The actual how-to, ordered, so nobody has to work out what to type. */
  guidance?: SetupGuidanceLine[];
  /** Where to read more. Never a substitute for the guidance itself. */
  docs?: { url: string; title: string };
  /** A surface to open. Never a mutation — see {@link isOpeningAction}. */
  action?: { command: string; title: string; args?: unknown[] };
}

/** A setup guide AtlasMind can walk someone through. */
export interface SetupGuideSummary {
  id: string;
  /** Display name, e.g. "Buzz" or "ACP agents". */
  label: string;
  /** One line on what this sets up, for the index. */
  blurb: string;
  /** The chat command that starts it, e.g. `/buzz`. */
  command: string;
  /** Steps counted by the walkthrough, in order. */
  stepIds: readonly string[];
}

/**
 * Commands a setup step is allowed to offer.
 *
 * An allowlist by *prefix and shape* rather than an enumeration, so a new
 * settings page does not have to be added here — but every entry is something
 * that opens a surface. Nothing that writes a setting, stores a secret, or
 * enables a gate belongs in a plan: those are the user's decisions, made on the
 * screen the guide opens for them. The ACP console-mode picker is named
 * explicitly because it is itself that screen: dismissing stores nothing and
 * neither option expands capability.
 */
export function isOpeningAction(command: string): boolean {
  if (typeof command !== 'string' || command.length === 0) {
    return false;
  }
  // Opening a panel, a settings page, a view, a walkthrough, or an external URL.
  if (/^atlasmind\.open[A-Z]/.test(command) || /^atlasmind\.(show|reveal)[A-Z]/.test(command)) {
    return true;
  }
  // Loading a command into a terminal without running it — the user presses Enter.
  if (command === 'atlasmind.buzz.prepareCommand' || command === 'atlasmind.setup.prepareCommand') {
    return true;
  }
  // Prompting for a value the user then types. This *is* an opening action: it
  // opens an input box and cannot produce a value on its own — dismissing it
  // stores nothing. Named explicitly rather than matched by an `atlasmind.set*`
  // prefix, because a prefix would also admit the switch-flipping commands this
  // list exists to keep out (`setBuzzEnabled` and friends).
  if (command === 'atlasmind.setBuzzAgentKey') {
    return true;
  }
  // A two-choice disclosure shown before any ACP process starts. It writes
  // exactly the option the user selected; neither answer enables the provider
  // or grants a permission. Explicit, because a broad `choose*` prefix would
  // admit future commands whose consequences this module has not reviewed.
  if (command === 'atlasmind.acp.chooseConsoleMode') {
    return true;
  }
  // VS Code's own settings UI and external-link opener.
  return command === 'workbench.action.openSettings' || command === 'vscode.open';
}

/**
 * Every action in a plan, checked against the allowlist.
 *
 * Returns the offending commands rather than throwing, so a guide with one bad
 * action reports it instead of taking the walkthrough down with it.
 */
export function findNonOpeningActions(steps: SetupStep[]): string[] {
  const offenders: string[] = [];
  for (const step of steps) {
    if (step.action && !isOpeningAction(step.action.command)) {
      offenders.push(step.action.command);
    }
  }
  return offenders;
}

/**
 * The first step of the walkthrough that still needs doing, or undefined when
 * there is nothing left.
 *
 * Scoped to `stepIds` on purpose: a step outside the walkthrough may be
 * `blocked` by something optional, and nominating it would send someone off to
 * do work they never needed to do. `todo` before `blocked`, because a step you
 * can act on now beats one waiting on another.
 */
export function nextSetupStep(steps: SetupStep[], stepIds: readonly string[]): SetupStep | undefined {
  const walkthrough = steps.filter(step => stepIds.includes(step.id));
  return walkthrough.find(step => step.status === 'todo') ?? walkthrough.find(step => step.status === 'blocked');
}

/**
 * Whether the *required* steps are satisfied.
 *
 * Deliberately ignores optional steps: reporting "incomplete" for a choice
 * somebody made is nagging, not help.
 */
export function isSetupComplete(steps: SetupStep[], requiredIds: readonly string[]): boolean {
  return requiredIds.every(id => steps.find(step => step.id === id)?.status === 'done');
}

export interface SetupProgress {
  done: number;
  total: number;
  /** True when every walkthrough step is done. */
  finished: boolean;
}

export function summarizeSetupProgress(steps: SetupStep[], stepIds: readonly string[]): SetupProgress {
  const walkthrough = steps.filter(step => stepIds.includes(step.id));
  const done = walkthrough.filter(step => step.status === 'done').length;
  return { done, total: walkthrough.length, finished: walkthrough.length > 0 && done === walkthrough.length };
}

export interface SetupStepPosition {
  index: number;
  total: number;
  /** A one-line map of the walkthrough with the current step marked. */
  trail?: string;
}

/**
 * Position of a step within the walkthrough, for "step 2 of 6".
 * Steps outside `stepIds` are excluded — counting them would move the finish line.
 */
export function setupStepPosition(
  steps: SetupStep[],
  stepIds: readonly string[],
  stepId: string,
): SetupStepPosition {
  const walkthrough = steps.filter(step => stepIds.includes(step.id));
  const at = walkthrough.findIndex(step => step.id === stepId);
  const index = at >= 0 ? at + 1 : walkthrough.length + 1;
  const trail = walkthrough
    .map((step, position) => {
      const mark = step.id === stepId ? '▶' : step.status === 'done' ? '✅' : '⬜';
      return `${mark} ${position + 1}. ${step.title}`;
    })
    .join('  ·  ');
  return { index, total: walkthrough.length, ...(trail ? { trail } : {}) };
}

/**
 * Render one step as markdown: what to do now, in order, commands written out.
 *
 * Shared so the chat participant and the AtlasMind chat panel show the same
 * words — two hand-maintained copies of a setup guide drift, and the one that
 * drifts is always the one somebody is following.
 */
export function renderSetupStepMarkdown(
  guideLabel: string,
  step: SetupStep,
  position: SetupStepPosition,
  docsLabel?: string,
): string {
  // "Step 2 of 4" as an opening line reads as though the guide lost its place.
  // Leading with what is already done says why you are starting here.
  const done = position.index - 1;
  const heading = done > 0
    ? `### ${guideLabel} setup — ${done} of ${position.total} done. Next: ${step.title}`
    : `### ${guideLabel} setup — step 1 of ${position.total}: ${step.title}`;
  const lines = [heading, '', step.detail];
  if (position.trail) {
    lines.push('', position.trail);
  }

  if (step.guidance?.length) {
    lines.push('');
    for (const line of step.guidance) {
      lines.push(`- ${line.text}`);
      if (line.url) {
        lines.push(`  ${line.url}`);
      }
      if (line.command) {
        lines.push('', '```bash', line.command, '```');
      }
    }
  }

  if (step.docs) {
    lines.push('', `${docsLabel ?? `${guideLabel}'s own documentation`}: ${step.docs.url}`);
  }
  return lines.join('\n');
}

/**
 * The whole guide at once — every step, with what is done and what is not.
 *
 * The step-at-a-time renderer above is the better experience *when a chat
 * surface can run the walkthrough*. This one exists because that is not always
 * true, and the failure was silent: slash commands are dispatched only by the
 * VS Code chat participant, so `/acp` sent to the AtlasMind chat panel was
 * treated as an ordinary prompt and answered by whatever model routing picked —
 * on a machine with nothing configured, the built-in echo model, which replied
 * "Answered from context." and taught the user that setup guides do not work.
 *
 * Setup guides are **derived, not model-generated**, so there is no reason for a
 * model to be involved at all. Rendering the full plan makes the guide reachable
 * from any surface that can display markdown, including on a fresh install with
 * no provider configured — which is exactly when someone needs it most and is
 * least able to get an answer out of a model.
 *
 * Commands are shown as copyable text. `authored: false` marks a command quoted
 * from somebody else's documentation, and those are labelled as such rather
 * than presented as something AtlasMind is telling you to run.
 */
export function renderSetupGuideMarkdown(
  guide: SetupGuideSummary,
  steps: SetupStep[],
  progress: SetupProgress,
): string {
  const lines = [
    `## ${guide.label} setup`,
    '',
    guide.blurb,
    '',
    progress.finished
      ? `**All ${progress.total} steps are done.**`
      : `**${progress.done} of ${progress.total} done.** Work down the list; each step says how to tell whether it already applies.`,
    '',
  ];

  for (const step of steps) {
    lines.push(`### ${SETUP_STATUS_MARKS[step.status]} ${step.title}`, '', step.detail);

    for (const line of step.guidance ?? []) {
      lines.push('', `- ${line.text}`);
      if (line.url) {
        lines.push(`  ${line.url}`);
      }
      if (line.command) {
        lines.push(
          '',
          line.authored === false
            ? '  Quoted from that project\'s own documentation — check it before running it:'
            : '',
          '```bash',
          line.command,
          '```',
        );
      }
    }

    if (step.docs) {
      lines.push('', `Read more: ${step.docs.url}`);
    }
    lines.push('');
  }

  return lines.filter(line => line !== undefined).join('\n');
}

const SETUP_STATUS_MARKS: Record<SetupStatus, string> = {
  done: '✅',
  todo: '⬜',
  blocked: '⛔',
  optional: '🔹',
};

/**
 * The index shown by `/setup`: every guide with how far along it is.
 *
 * Progress is computed from the same plans the individual walkthroughs use, so
 * the index cannot claim a guide is finished while the guide itself disagrees.
 */
export function renderSetupIndexMarkdown(
  entries: Array<{ guide: SetupGuideSummary; progress: SetupProgress; nextTitle?: string }>,
): string {
  const lines = ['### Setup guides', ''];
  if (entries.length === 0) {
    lines.push('No setup guides are available.');
    return lines.join('\n');
  }
  lines.push('AtlasMind walks you through each of these one step at a time, deriving what is already done from your actual configuration. None of them changes a setting for you — each opens the screen where you decide.', '');
  for (const entry of entries) {
    const mark = entry.progress.finished ? '✅' : entry.progress.done > 0 ? '🔸' : '⬜';
    const count = `${entry.progress.done}/${entry.progress.total}`;
    const next = entry.progress.finished ? 'done' : entry.nextTitle ? `next: ${entry.nextTitle}` : 'not started';
    lines.push(`- ${mark} **${entry.guide.label}** (${count} — ${next}) — ${entry.guide.blurb}  \n  Start with \`${entry.guide.command}\``);
  }
  return lines.join('\n');
}
