/**
 * Telling somebody the workflow exists, at the moment it applies.
 *
 * The workflow feature had a reach problem that neither the dashboard nor the
 * instruction-file blocks solve. Only two things ever read the declared
 * workflow: the Workflow dashboard page, and the managed blocks written into
 * *other* tools' instruction files. **AtlasMind's own chat path never consulted
 * it at all.** So somebody typing "commit this and push it" into Atlas got no
 * workflow awareness whatsoever — the rules lived on a page they had not opened
 * and in a file written for a different tool.
 *
 * That is the case this module is for, and the user it is for is a **novice**.
 * Their failure mode is not violating a rule; it is not knowing a rule existed,
 * and nothing saying so while it still mattered. Which is why the default
 * behaviour is to **follow, not to gate**:
 *
 * - Following turns the declared workflow into a standing policy for the same
 *   turn. The user asks for the outcome once; AtlasMind chooses the compliant
 *   route without making them repeat a magic phrase.
 * - Gating stops the beginner, but a prompt that appears on every commit becomes
 *   a prompt people learn to click through — and then it protects nobody while
 *   still being in the way. `gate` exists because it was asked for, and it is
 *   opt-in for exactly that reason.
 *
 * **Detection is a published keyword table, not a model.** Three reasons, in
 * order of weight: a model call here would put a model in front of every chat
 * turn; the same prompt must always produce the same notice, or the advice is
 * not something you can learn from; and the table can be read, argued with, and
 * tested. It follows the precedent of `prioritizeDashboardRoadmapItems` and the
 * debt-register rule table rather than inventing a fourth approach.
 *
 * The cost of a keyword table is honest and stated: it matches on wording, so it
 * will miss a phrasing nobody anticipated and will occasionally fire on a
 * question that merely mentions committing. Both are survivable **because the
 * default can only narrow execution onto a workflow the project already
 * enabled**. It grants no tool, protected-ref, or external-write permission.
 * That asymmetry is what makes a heuristic acceptable here and would not make
 * it acceptable in a gate — which is the deeper reason `gate` is not the
 * default.
 *
 * Pure and `vscode`-free, so every rule is unit-tested.
 */

import type { WorkflowConfig } from './workflowConfig.js';

/** What AtlasMind does when a chat turn touches a workflow-governed action. */
export type WorkflowChatGuidanceMode = 'off' | 'follow' | 'inform' | 'gate';

/**
 * The workflow-governed actions a chat prompt can imply.
 *
 * Deliberately coarse. The point is to name the *stage* whose rules apply, not
 * to parse the user's intent precisely — a wrong-but-adjacent stage still tells
 * a novice something true, while a fine-grained taxonomy would multiply the ways
 * to be confidently wrong.
 */
export type WorkflowGovernedAction = 'commit' | 'push' | 'branch' | 'pull-request' | 'release';

/**
 * A determiner before the word makes it a **noun**, not a request.
 *
 * "was this commit signed?" and "the push failed" are questions *about* a commit
 * and a push; "commit this" and "push it" ask for one. English does not separate
 * the two cleanly, but a preceding determiner is a reliable signal for the noun
 * reading, and it is the case that actually came up.
 */
const DETERMINER_LOOKBEHIND =
  '(?<!\\b(?:this|that|the|a|an|each|every|which|whose|last|first|latest|previous|next|my|our|your|their|its|one|same)\\s)';

/** Words that follow the noun reading rather than the imperative one. */
const NOUN_FOLLOWERS = 'is|was|were|has|had|been|failed|succeeded|will';

interface ActionRule {
  action: WorkflowGovernedAction;
  /**
   * Wording that implies the action.
   *
   * Ordered most-specific-first, and matched in that order, because "push" is a
   * substring of intent for both `push` and `release` — a release is a push, and
   * calling it a push would give the less useful answer.
   */
  pattern: RegExp;
}

/**
 * The rule table. Published, ordered, and the whole of the detection.
 *
 * Anchored on verbs rather than nouns: "the commit message is wrong" is a
 * question *about* a commit, while "commit this" asks for one. The distinction
 * is not perfectly separable in English and the table does not pretend to
 * separate it — see the module note on why that is tolerable at `inform`.
 */
const ACTION_RULES: readonly ActionRule[] = [
  // Release first: it is the most specific and it subsumes tagging and publishing.
  {
    action: 'release',
    pattern: /\b(?:cut|make|do|ship|publish|tag)\s+(?:a\s+|the\s+|this\s+)?(?:new\s+)?(?:release|version)\b|\brelease\s+(?:it|this|now)\b|\bpublish\s+(?:it|this|to\s+(?:the\s+)?marketplace|to\s+npm)\b|\bpromote\s+(?:(?:it|this|develop|the\s+(?:build|release|version))\s+)?to\s+(?:main|production|prod|release)\b|\bbump\s+the\s+version\b/i,
  },
  {
    action: 'pull-request',
    pattern: /\b(?:open|create|raise|submit|make)\s+(?:a\s+|the\s+)?(?:pr|pull\s?request)\b|\bpull\s?request\s+for\b|\bmerge\s+(?:the\s+)?(?:pr|pull\s?request)\b/i,
  },
  {
    action: 'branch',
    pattern: /\b(?:create|make|start|cut|open)\s+(?:a\s+|the\s+)?(?:new\s+)?branch\b|\bbranch\s+(?:off|from)\b|\bcheckout\s+-b\b/i,
  },
  {
    action: 'push',
    pattern: new RegExp(`\\bgit\\s+push\\b|${DETERMINER_LOOKBEHIND}\\bpush\\b(?!\\s*(?:back|through|${NOUN_FOLLOWERS}))`, 'i'),
  },
  {
    action: 'commit',
    pattern: new RegExp(
      // Imperative with an object: unambiguously a request.
      '\\bcommit\\s+(?:this|it|these|those|everything|all\\b|the\\s)'
      + '|\\bgit\\s+commit\\b'
      // A bare verb, but only where it is not being used as a noun.
      + `|${DETERMINER_LOOKBEHIND}\\bcommit\\b(?!\\s*(?:message|history|log|hash|sha|range|id|author|${NOUN_FOLLOWERS}))`,
      'i',
    ),
  },
];

/** Which workflow stage owns each action, for naming the rule that applies. */
const ACTION_STAGE: Record<WorkflowGovernedAction, string> = {
  commit: 'development',
  push: 'development',
  branch: 'branching',
  'pull-request': 'pull-request',
  release: 'release',
};

export interface WorkflowChatNotice {
  action: WorkflowGovernedAction;
  /** The stage whose declared rules apply. */
  stageId: string;
  /** One or two sentences, written for somebody who has never read the workflow. */
  markdown: string;
  /**
   * True when the mode is `gate`, meaning the caller must not proceed without an
   * explicit go-ahead. Carried on the notice rather than re-derived, so a caller
   * cannot read the text and forget the mode.
   */
  blocking: boolean;
  /**
   * A host-interpreted, turn-scoped policy. The model never receives this object
   * verbatim: {@link buildWorkflowExecutionSystemGuidance} validates the shape
   * and renders fixed system text, so a hand-edited workflow file cannot inject
   * arbitrary instructions at system priority.
   */
  executionPolicy?: WorkflowChatExecutionPolicy;
}

/**
 * The small set of validated facts AtlasMind needs to follow the workflow.
 *
 * Deliberately excludes free-form check names, blockers and commands from the
 * committed file. Those remain evidence to inspect and display, not text that a
 * repository can smuggle into a model's system prompt.
 */
export interface WorkflowChatExecutionPolicy {
  kind: 'follow-declared-workflow';
  action: WorkflowGovernedAction;
  integrationBranch: string;
  releaseBranch: string;
  onProtectedBranch: boolean;
}

export interface WorkflowChatGuardInput {
  prompt: string;
  mode: WorkflowChatGuidanceMode;
  config: WorkflowConfig | undefined;
  /** Branch the user is on, when known. Lets the notice be specific. */
  currentBranch?: string;
}

/**
 * The action a prompt implies, or `undefined`.
 *
 * Exported separately from the notice so the detection can be tested without
 * asserting against prose, and so a caller that only wants to know "is this
 * workflow-relevant" does not have to render a message to find out.
 */
export function detectGovernedAction(prompt: string): WorkflowGovernedAction | undefined {
  const text = prompt.trim();
  if (!text) {
    return undefined;
  }
  for (const rule of ACTION_RULES) {
    if (rule.pattern.test(text)) {
      return rule.action;
    }
  }
  return undefined;
}

/**
 * What to tell the user before a workflow-governed action, if anything.
 *
 * Returns `undefined` — say nothing — in every case where there is nothing
 * *true* to say, and those cases matter as much as the ones that speak:
 *
 * - The mode is `off`.
 * - No workflow is declared, so there are no rules to be outside of. Warning
 *   here would invent a process the project never adopted.
 * - The prompt implies nothing governed.
 * - The stage that owns the action is disabled. A stage nobody enabled has no
 *   expectations, and asserting some would be worse than silence.
 */
export function buildWorkflowChatNotice(input: WorkflowChatGuardInput): WorkflowChatNotice | undefined {
  if (input.mode === 'off' || !input.config) {
    return undefined;
  }
  const action = detectGovernedAction(input.prompt);
  if (!action) {
    return undefined;
  }
  const stageId = ACTION_STAGE[action];
  const stage = input.config.stages.find(entry => entry.id === stageId);
  if (!stage || !stage.enabled) {
    return undefined;
  }

  const blocking = input.mode === 'gate';
  const following = input.mode === 'follow';
  const lines: string[] = [];
  const integration = input.config.branches.integration;
  const protectedBranches = input.config.branches.protected;
  const onProtected = Boolean(input.currentBranch && protectedBranches.includes(input.currentBranch));

  lines.push(blocking
    ? '**This project has a declared workflow, and it covers what you just asked for.**'
    : following
      ? '**Following the project’s declared workflow for this request.**'
      : '**Workflow note** — this project has a declared route for what you asked.');
  lines.push('');

  // The one fact most likely to matter, and the only one that is an emergency.
  if (onProtected && (action === 'commit' || action === 'push')) {
    lines.push(
      `You are on \`${input.currentBranch}\`, which this project marks **protected** — changes are `
      + 'meant to reach it through a reviewed pull request, not directly.',
    );
  } else {
    lines.push(describeExpectation(action, integration));
  }

  if (stage.requiredChecks.length > 0) {
    lines.push('', `This stage also expects: ${stage.requiredChecks.map(check => `_${check}_`).join(', ')}.`);
  }

  lines.push('');
  lines.push(blocking
    // A gate must say how to get through it, or it is a wall.
    ? 'Tell me to go ahead anyway if you want it done directly, or ask me to follow the workflow instead.'
    : following
      ? 'I’ll keep this as one continuous turn and pause only at an approval or irreversible-action boundary that already exists.'
      : 'I’ll continue as asked. Set `atlasmind.workflow.chatGuidance` to `follow` to make the declared route the standing policy for future turns.');
  lines.push('');
  lines.push('_Declared in `project_memory/operations/workflow.json`. Set `atlasmind.workflow.chatGuidance` to `off` to stop these notices._');

  return {
    action,
    stageId,
    markdown: lines.join('\n'),
    blocking,
    ...(following
      ? {
        executionPolicy: {
          kind: 'follow-declared-workflow',
          action,
          integrationBranch: integration,
          releaseBranch: input.config.branches.release,
          onProtectedBranch: onProtected,
        } satisfies WorkflowChatExecutionPolicy,
      }
      : {}),
  };
}

/** The expectation for an action, in plain words. */
function describeExpectation(action: WorkflowGovernedAction, integration: string): string {
  switch (action) {
    case 'commit':
      return `Work here is expected to land on \`${integration}\`, with a version bump and a changelog entry `
        + 'in the same commit where the project asks for one.';
    case 'push':
      return `\`${integration}\` is the normal push target. Anything else the project marks protected is `
        + 'reached through a pull request instead.';
    case 'branch':
      return 'New branches follow the project\'s declared naming convention, and start from '
        + `\`${integration}\`.`;
    case 'pull-request':
      return `Pull requests target \`${integration}\`, and the project may expect an issue linked from `
        + 'the body.';
    case 'release':
      return 'A release is the one step here that cannot be undone. The project declares gates for it — '
        + 'changelog, version, tag and a clean tree — and tagging stays a human action.';
    default:
      return '';
  }
}

/**
 * Render a validated execution policy as fixed, system-priority guidance.
 *
 * This is intentionally total and returns an empty string for any malformed
 * shape. Callers may put the result in a system prompt because no free-form
 * repository text survives this function.
 */
export function buildWorkflowExecutionSystemGuidance(raw: unknown): string {
  if (!isWorkflowChatExecutionPolicy(raw)) {
    return '';
  }

  const actionLine = raw.action === 'release'
    ? `- Follow the enabled release route through integration branch \`${raw.integrationBranch}\` to protected release branch \`${raw.releaseBranch}\`; never reinterpret the request as permission to push directly to the protected target.`
    : `- Follow the enabled \`${ACTION_STAGE[raw.action]}\` stage and keep \`${raw.integrationBranch}\` as the normal integration target.`;
  const protectedLine = raw.onProtectedBranch
    ? '- The active branch is declared protected. Do not commit or push to it directly; move the work through the declared reviewed route.'
    : '';

  return [
    'Workflow execution policy (host-derived for this turn):',
    '- The operator selected `follow`: pursue the requested outcome through the project’s declared workflow in this same turn.',
    '- Do not ask the operator to repeat “follow the workflow” or restate the request.',
    actionLine,
    protectedLine,
    '- This policy grants no new authority. Existing tool approvals, automation ceilings, protected-ref checks, release gates, and outward-write confirmations remain in force.',
    '- An explicit release request authorizes starting the declared release route; it is not blanket approval for every protected or outward-facing write on that route.',
    '- Pre-existing unrelated working-tree edits are out of scope: do not stash, discard, overwrite, stage, or commit them merely to make the tree clean.',
    '- If branch-changing delivery work would disturb the active checkout, prefer an isolated temporary Git worktree. Apply cleanliness checks to the ref/worktree being delivered, not to unrelated edits left in the operator’s checkout.',
    '- Continue through safe in-scope steps and pause only when a real approval, irreversible-action, missing-authority, or external-state boundary requires the operator.',
  ].filter(Boolean).join('\n');
}

function isWorkflowChatExecutionPolicy(value: unknown): value is WorkflowChatExecutionPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return candidate['kind'] === 'follow-declared-workflow'
    && typeof candidate['action'] === 'string'
    && Object.prototype.hasOwnProperty.call(ACTION_STAGE, candidate['action'])
    && isSafeBranchName(candidate['integrationBranch'])
    && isSafeBranchName(candidate['releaseBranch'])
    && typeof candidate['onProtectedBranch'] === 'boolean';
}

function isSafeBranchName(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 120
    && !/[\s~^:?*[\]\\]/.test(value)
    && !value.includes('..');
}

/** Read the setting, tolerating anything that is not one of the four values. */
export function parseWorkflowChatGuidanceMode(raw: unknown): WorkflowChatGuidanceMode {
  return raw === 'off' || raw === 'inform' || raw === 'gate' ? raw : 'follow';
}
