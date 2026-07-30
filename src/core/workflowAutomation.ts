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
 * One setting's value in each configuration scope.
 *
 * `undefined` means *not set in that scope* — which is different from set to a
 * restrictive value, and the difference is the whole point. A person who has
 * expressed no preference should inherit the team's, while a person who has
 * expressed one should keep it when it is the more cautious of the two.
 *
 * Field names match VS Code's `WorkspaceConfiguration.inspect()` result, so an
 * inspect result can be passed straight in without an adapter at every call
 * site — an adapter being one more place the mapping could be got wrong.
 */
export interface SettingScopes<T> {
  /** The person's own setting. */
  globalValue?: T | undefined;
  /** The team's, from committed workspace settings. */
  workspaceValue?: T | undefined;
  /** A folder override in a multi-root workspace. */
  workspaceFolderValue?: T | undefined;
}

/**
 * The most restrictive automation level defined in any scope.
 *
 * VS Code resolves configuration by precedence — workspace beats user — which
 * is right for a preference and **wrong for a safety ceiling**. Read that way, a
 * repository committing `auto` would raise the ceiling of everyone who opened
 * it, and a contributor who wanted to be more cautious than their team could
 * not be. The specification's promise is the opposite: a personal setting can
 * only ever *lower* the result.
 *
 * So this takes the minimum across scopes rather than the resolved value.
 * A scope that set nothing does not clamp anything; when no scope set a value,
 * the deny-by-default fallback applies.
 */
export function resolveRestrictiveLevel(
  scopes: SettingScopes<string>,
  fallback: AutomationLevel = 'observe',
): AutomationLevel {
  const defined = [scopes.globalValue, scopes.workspaceValue, scopes.workspaceFolderValue]
    .filter((value): value is string => typeof value === 'string')
    .map(normalizeAutomationLevel);

  if (defined.length === 0) {
    return fallback;
  }
  return defined.reduce((lowest, level) => (rank(level) < rank(lowest) ? level : lowest));
}

/**
 * The most restrictive boolean defined in any scope.
 *
 * Same reasoning, and the same direction: for a capability switch `false` is
 * the cautious value, so any scope that says `false` wins. A team can grant a
 * capability and an individual can still decline it.
 */
export function resolveRestrictiveFlag(
  scopes: SettingScopes<boolean>,
  fallback = false,
): boolean {
  const defined = [scopes.globalValue, scopes.workspaceValue, scopes.workspaceFolderValue]
    .filter((value): value is boolean => typeof value === 'boolean');

  if (defined.length === 0) {
    return fallback;
  }
  return defined.every(value => value);
}

/**
 * Which settings scope is holding a boolean gate closed.
 *
 * `resolveRestrictiveFlag` answers *what* the value is; this answers *where it
 * came from*, and the difference is the whole reason this exists. A dashboard
 * control that writes to the workspace scope while the user scope says `false`
 * would appear to do nothing — the switch flips, the value does not change, and
 * the user is left believing the feature is broken.
 *
 * That is the same silent-no-op class as the dead buttons, arriving through the
 * settings system instead of the command allowlist. Better to refuse and name
 * the scope.
 */
export type SettingScopeName = 'user' | 'workspace' | 'folder';

export function blockingFlagScopes(
  scopes: SettingScopes<boolean>,
): SettingScopeName[] {
  const entries: Array<[SettingScopeName, boolean | undefined]> = [
    ['user', scopes.globalValue],
    ['workspace', scopes.workspaceValue],
    ['folder', scopes.workspaceFolderValue],
  ];
  return entries
    .filter(([, value]) => value === false)
    .map(([name]) => name);
}

/** How a scope reads in a sentence a user can act on. */
export function describeSettingScope(scope: SettingScopeName): string {
  switch (scope) {
    case 'user':
      return 'your user settings';
    case 'workspace':
      return 'this workspace';
    case 'folder':
      return 'this folder';
  }
}

export interface GateRequirement {
  /** The setting to change. */
  key: string;
  label: string;
  /** What it is now, as a sentence. */
  current: string;
  /** What it needs to become. */
  needed: string;
}

/**
 * What would have to change for a stage to reach a target level.
 *
 * The single most useful thing this surface can say. "AtlasMind is not permitted
 * to do that" tells somebody they are blocked; this tells them which switches,
 * in what order, and stops at the first one that is a *hard* ceiling rather than
 * listing changes that would not help.
 *
 * Returns an empty list when the target is already reachable — which is a real
 * answer and not an absence, so the caller can say so.
 */
export function requirementsFor(
  target: AutomationLevel,
  state: {
    masterEnabled: boolean;
    userCeiling: AutomationLevel;
    capabilityEnabled: boolean;
    capabilityKey: string;
    capabilityLabel: string;
    stageLevel: AutomationLevel;
  },
): GateRequirement[] {
  const out: GateRequirement[] = [];

  if (!state.masterEnabled) {
    out.push({
      key: 'atlasmind.workflow.enabled',
      label: 'Master switch',
      current: 'off',
      needed: 'on',
    });
  }

  if (rank(state.userCeiling) < rank(target)) {
    out.push({
      key: 'atlasmind.workflow.maxAutomationLevel',
      label: 'Your ceiling',
      current: state.userCeiling,
      needed: target,
    });
  }

  // A capability caps at `draft`, so it only matters for a target above that.
  // Listing it for a `draft` target would send somebody to a switch that would
  // change nothing.
  if (!state.capabilityEnabled && rank(target) >= rank(FIRST_WRITING_LEVEL)) {
    out.push({
      key: state.capabilityKey,
      label: state.capabilityLabel,
      current: 'off',
      needed: 'allowed',
    });
  }

  if (rank(state.stageLevel) < rank(target)) {
    out.push({
      key: 'project_memory/operations/workflow.json',
      label: 'The stage\'s own declared level',
      current: state.stageLevel,
      needed: target,
    });
  }

  return out;
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
