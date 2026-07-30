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
 * behaviour is to **inform, not to gate**:
 *
 * - Informing teaches the rule at the one moment it is relevant, and costs an
 *   expert a line of text they can ignore.
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
 * question that merely mentions committing. Both are survivable **because it
 * only ever adds a sentence** at the default level. That asymmetry is what makes
 * a heuristic acceptable here and would not make it acceptable in a gate — which
 * is the deeper reason `gate` is not the default.
 *
 * Pure and `vscode`-free, so every rule is unit-tested.
 */

import type { WorkflowConfig } from './workflowConfig.js';

/** What AtlasMind does when a chat turn touches a workflow-governed action. */
export type WorkflowChatGuidanceMode = 'off' | 'inform' | 'gate';

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
    pattern: /\b(?:cut|make|do|ship|publish|tag)\s+(?:a\s+|the\s+|this\s+)?(?:new\s+)?(?:release|version)\b|\brelease\s+(?:it|this|now)\b|\bpublish\s+(?:it|this|to\s+(?:the\s+)?marketplace|to\s+npm)\b|\bbump\s+the\s+version\b/i,
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
  const lines: string[] = [];
  const integration = input.config.branches.integration;
  const protectedBranches = input.config.branches.protected;
  const onProtected = Boolean(input.currentBranch && protectedBranches.includes(input.currentBranch));

  lines.push(blocking
    ? '**This project has a declared workflow, and it covers what you just asked for.**'
    : '**Before I do that** — this project has a declared workflow that covers it.');
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
    : 'Say "follow the workflow" and I will do it that way, or just tell me to carry on as asked.');
  lines.push('');
  lines.push('_Declared in `project_memory/operations/workflow.json`. Set `atlasmind.workflow.chatGuidance` to `off` to stop these notices._');

  return { action, stageId, markdown: lines.join('\n'), blocking };
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

/** Read the setting, tolerating anything that is not one of the three values. */
export function parseWorkflowChatGuidanceMode(raw: unknown): WorkflowChatGuidanceMode {
  return raw === 'off' || raw === 'gate' ? raw : 'inform';
}
