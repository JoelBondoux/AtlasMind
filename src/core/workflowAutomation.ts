/**
 * The automation ladder: how much AtlasMind may do on your behalf, and why.
 *
 * The specification (`docs/guided-github-workflow.md` §5) makes a claim that has
 * to be true *by construction* rather than by policy — **full automation is
 * possible, never default**. This module is where that claim is kept.
 *
 * The mechanism is a minimum over four independent gates, all of which default
 * closed:
 *
 *     effective = min(master, userCeiling, capability, stage)
 *
 * A project's committed workflow file may request `auto`; if any one of the
 * four disagrees, `auto` does not happen. A user's personal settings can only
 * ever *lower* the result, never raise it — so a repository cannot force
 * unattended action onto somebody's machine, and a developer cannot grant
 * themselves more than the repository allows.
 *
 * Two design decisions worth stating:
 *
 * 1. **A capability switch caps at `draft`, it does not zero the stage.**
 *    Turning off "may write pull requests" should stop the writing, not stop
 *    AtlasMind explaining and preparing. The rung where writing begins is
 *    `propose`, so that is exactly where the cap lands.
 *
 * 2. **Every refusal names the gate that caused it.** "You cannot do that" with
 *    no reason sends somebody to toggle four settings at random. `explain`
 *    returns the binding gate, so a surface can say which one to change — or
 *    that it is a hard ceiling nothing will change.
 *
 * Pure, `vscode`-free, and unit-tested.
 */

/** The five rungs, in ascending order of what they permit. */
export const AUTOMATION_LEVELS = ['off', 'observe', 'draft', 'propose', 'auto'] as const;

export type AutomationLevel = typeof AUTOMATION_LEVELS[number];

/** The rung at which AtlasMind begins changing something outside the editor. */
export const FIRST_WRITING_LEVEL: AutomationLevel = 'propose';

/** Which capability switch governs a given action. */
export type WorkflowCapability =
  | 'issueWrites'
  | 'pullRequestWrites'
  | 'releaseWrites';

/** The gate that bound the effective level, for an explanation a user can act on. */
export type BindingGate = 'master' | 'ceiling' | 'capability' | 'stage' | 'none';

export interface AutomationInputs {
  /** `atlasmind.workflow.enabled` — the master off switch. */
  masterEnabled: boolean;
  /** `atlasmind.workflow.maxAutomationLevel` — the user's personal ceiling. */
  userCeiling: AutomationLevel;
  /** The matching `allow*Writes` switch, or `true` where the action writes nothing. */
  capabilityEnabled: boolean;
  /** The level declared for this stage in the workflow configuration. */
  stageLevel: AutomationLevel;
}

export interface AutomationDecision {
  level: AutomationLevel;
  /** Which gate held it here. `none` when nothing is binding — the level is the stage's own. */
  limitedBy: BindingGate;
  /** One sentence naming what to change, or why nothing will. */
  detail: string;
}

function rank(level: AutomationLevel): number {
  const index = AUTOMATION_LEVELS.indexOf(level);
  // An unrecognised value is treated as `off`, not as the caller's intent.
  // A settings file with a typo must not be read as permission.
  return index === -1 ? 0 : index;
}

/** Coerce untrusted input to a level, defaulting closed. */
export function normalizeAutomationLevel(value: unknown): AutomationLevel {
  return typeof value === 'string' && (AUTOMATION_LEVELS as readonly string[]).includes(value)
    ? value as AutomationLevel
    : 'off';
}

/**
 * The effective level, and the gate that decided it.
 *
 * Gates are examined in the order a user would want to hear about them: the
 * master switch first, because flipping it explains every other refusal at
 * once; then the ceiling they set themselves; then the capability; then the
 * stage. Ties resolve to the earlier gate, so the simplest fix is the one named.
 */
export function explainAutomationLevel(inputs: AutomationInputs): AutomationDecision {
  if (!inputs.masterEnabled) {
    return {
      level: 'off',
      limitedBy: 'master',
      detail: 'The workflow master switch is off, so AtlasMind takes no action at all. Turn on `atlasmind.workflow.enabled` to use the levels below it.',
    };
  }

  const ceiling = rank(normalizeAutomationLevel(inputs.userCeiling));
  const stage = rank(normalizeAutomationLevel(inputs.stageLevel));
  // A disabled capability caps at `draft`: preparing an artifact is not writing,
  // and stopping the explanation as well as the action would make the switch
  // more punishing than it needs to be.
  const capability = inputs.capabilityEnabled ? rank('auto') : rank('draft');

  const lowest = Math.min(ceiling, capability, stage);
  const level = AUTOMATION_LEVELS[lowest]!;

  if (lowest === ceiling && ceiling < stage && ceiling <= capability) {
    return {
      level,
      limitedBy: 'ceiling',
      detail: `Your personal ceiling is \`${level}\`. The project allows \`${AUTOMATION_LEVELS[stage]}\`; raise \`atlasmind.workflow.maxAutomationLevel\` to reach it.`,
    };
  }
  if (lowest === capability && capability < stage) {
    return {
      level,
      limitedBy: 'capability',
      detail: 'The capability switch for this action is off, so AtlasMind can prepare a draft but not act on it. Enable the matching `atlasmind.workflow.allow*Writes` setting.',
    };
  }
  return {
    level,
    limitedBy: 'none',
    detail: `This stage is set to \`${level}\` in the project's workflow configuration.`,
  };
}

/** The effective level alone, where the explanation is not needed. */
export function effectiveAutomationLevel(inputs: AutomationInputs): AutomationLevel {
  return explainAutomationLevel(inputs).level;
}

/** Whether an effective level permits an action needing at least `required`. */
export function permits(level: AutomationLevel, required: AutomationLevel): boolean {
  return rank(level) >= rank(required);
}

/**
 * A hard ceiling: an action no level may perform.
 *
 * Separate from the ladder because these are not a matter of degree. They are
 * excluded at every rung, and a surface should say so rather than implying a
 * setting exists that would permit them.
 */
export type HardCeiling =
  | 'force-push'
  | 'delete-tag'
  | 'delete-release'
  | 'rerun-ci'
  | 'edit-ci-workflow'
  | 'merge-dependency-update'
  | 'edit-workflow-config';

export const HARD_CEILING_REASONS: Readonly<Record<HardCeiling, string>> = {
  'force-push': 'AtlasMind never force-pushes. It can destroy a colleague\'s commits without warning, and no setting enables it.',
  'delete-tag': 'A tag is the record of what was shipped. AtlasMind never deletes one.',
  'delete-release': 'A published release is a durable public artifact. AtlasMind never deletes one.',
  'rerun-ci': 'Re-running a job until it passes turns a flaky test into policy. AtlasMind never re-runs automatically — read the failure instead.',
  'edit-ci-workflow': 'The CI workflow file enforces the gates. Anything that could edit it could remove them, so AtlasMind never edits one automatically.',
  'merge-dependency-update': 'A dependency bump is a supply-chain event, and a green build cannot detect a malicious package that behaves. A human merges it.',
  'edit-workflow-config': 'The workflow configuration defines the gates. No agent may edit it — that is the one file a person has to change themselves.',
};

/**
 * Whether an action targeting a protected reference may proceed.
 *
 * Deliberately not folded into the ladder: this is a veto on a *target*, not a
 * cap on a level. With it off, `auto` is unreachable for any stage whose base is
 * protected — not discouraged, unreachable — and the message says so rather
 * than pointing at a level the user could raise in vain.
 */
export function permitsProtectedRefWrite(options: {
  targetIsProtected: boolean;
  allowProtectedRefWrites: boolean;
}): { allowed: boolean; detail?: string } {
  if (!options.targetIsProtected) {
    return { allowed: true };
  }
  if (options.allowProtectedRefWrites) {
    return { allowed: true };
  }
  return {
    allowed: false,
    detail: 'That target is a protected branch, and `atlasmind.workflow.allowProtectedRefWrites` is off. A protected branch exists so changes reach it only through a reviewed pull request.',
  };
}
