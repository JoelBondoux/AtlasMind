/**
 * The declared workflow, written for an agent that is not AtlasMind.
 *
 * This closes a hole the workflow feature had from the start. AtlasMind's gates
 * are **self-restraints**: the effective level of a stage is
 * `min(master, ceiling, capability, stage)`, and that arithmetic governs what
 * *AtlasMind* may do. It cannot bind the human, and it cannot bind Claude Code,
 * Copilot, Cursor or anything else editing the repository — none of which can
 * see a VS Code setting or a file in `project_memory/`.
 *
 * So the rules were enforced against exactly the one participant that had
 * already agreed to them, and invisible to every other. An external agent
 * committing straight to the integration branch was not violating the workflow;
 * it had no way to know one existed.
 *
 * The fix is not a stronger gate — there is no gate to be had over a process
 * AtlasMind does not run. It is to put the rules in the file the agent already
 * reads, which is what `testingProtocolSync` does for testing methodologies and
 * for debt markers. This is the third such block, and it is deliberately a
 * *third* rather than an addition to either: the questions differ, the change
 * rates differ, and a file carrying one block and not the others should keep
 * what it has.
 *
 * **Derived, never generated.** Every line comes from the committed
 * `workflow.json`. A model asked to summarise a workflow produces plausible
 * rules that nobody declared, and an agent would then follow them — which is
 * worse than no block at all, because it looks authoritative.
 *
 * Pure and `vscode`-free, so the whole rendering is unit-tested.
 */

import { stageBlockers, type WorkflowConfig, type WorkflowStageConfig } from './workflowConfig.js';
import type { AutomationLevel } from './workflowAutomation.js';

/**
 * What an agent is being asked to do at a given automation level.
 *
 * Phrased as an instruction rather than a label, because `propose` means
 * nothing to a reader who has not seen AtlasMind's ladder. The wording is
 * deliberately about *the agent's* behaviour, not AtlasMind's — the same word
 * governs both, and only one of them is reading this file.
 */
const LEVEL_INSTRUCTION: Record<AutomationLevel, string> = {
  off: 'Do not act on this stage at all.',
  observe: 'Report what you find. Do not create, modify or close anything.',
  draft: 'Prepare the change locally and leave it for a human to submit.',
  propose: 'Open it for review and wait for a human decision before it lands.',
  auto: 'You may complete this stage without asking, within the rules above.',
};

/** The order the stages are actually worked in, for a readable table. */
const STAGE_LABELS: Record<string, string> = {
  planning: 'Planning & issue intake',
  branching: 'Branch creation & naming',
  development: 'Local development',
  'pull-request': 'Pull requests & review',
  ci: 'CI & failure analysis',
  release: 'Release',
  maintenance: 'Maintenance & tech debt',
  automation: 'Automation policy',
};

export interface WorkflowGuidanceInput {
  config: WorkflowConfig;
  /**
   * The user's own ceiling (`atlasmind.workflow.maxAutomationLevel`), and
   * whether the master switch is on.
   *
   * Included because the block must not overstate what is permitted. A stage
   * declaring `auto` while the ceiling says `observe` is an `observe` stage, and
   * printing `auto` would invite an agent to act on authority nobody granted.
   * Supplied by the caller rather than read here, so this module stays pure —
   * the same reason `syncTestingProtocols` is handed its config.
   */
  ceiling?: AutomationLevel;
  masterEnabled?: boolean;
}

const LEVEL_RANK: Record<AutomationLevel, number> = {
  off: 0, observe: 1, draft: 2, propose: 3, auto: 4,
};

/** The lower of two levels. The ladder's whole semantics, in one place. */
export function lowerLevel(a: AutomationLevel, b: AutomationLevel): AutomationLevel {
  return LEVEL_RANK[a] <= LEVEL_RANK[b] ? a : b;
}

/**
 * The level a stage actually operates at, once the ceiling is applied.
 *
 * A blocked stage collapses to `off` regardless of what it declares: a blocker
 * is not a preference to be weighed against a level, it is a statement that the
 * stage cannot run. Reporting `propose` for a stage with an empty required
 * command would describe something that will refuse the moment it is tried.
 */
export function effectiveStageLevel(
  stage: WorkflowStageConfig,
  ceiling: AutomationLevel | undefined,
  masterEnabled: boolean | undefined,
): AutomationLevel {
  if (!stage.enabled || stageBlockers(stage).length > 0 || masterEnabled === false) {
    return 'off';
  }
  return ceiling ? lowerLevel(stage.automationLevel, ceiling) : stage.automationLevel;
}

/**
 * Render the guidance body for an agent instruction file.
 *
 * No delimiters — the caller owns those, so the same text can be written into a
 * markdown block or shown in a panel without either knowing about the other.
 */
export function buildWorkflowGuidance(input: WorkflowGuidanceInput): string {
  const { config, ceiling, masterEnabled } = input;
  const lines: string[] = [];

  lines.push(
    'This repository follows a declared GitHub workflow. It is recorded in',
    '`project_memory/operations/workflow.json` and is the authority for the rules below —',
    'if this block and that file disagree, the file wins and this block is stale.',
    '',
    'These rules apply to **you**, whichever tool you are. AtlasMind cannot gate a process it',
    'does not run, so nothing here is enforced by machinery on your side: it is enforced by you',
    'reading it. Where a rule and convenience conflict, follow the rule and say that you did.',
    '',
  );

  if (masterEnabled === false) {
    lines.push(
      '> **The workflow is currently switched off** for AtlasMind itself, which means it will take',
      '> no action of its own. The conventions below still describe how this repository expects',
      '> work to arrive, so keep following them.',
      '',
    );
  }

  // ── Branches ───────────────────────────────────────────────────────
  lines.push('### Branches', '');
  lines.push(`- Integration branch (normal push target): \`${config.branches.integration}\``);
  lines.push(`- Release branch: \`${config.branches.release}\``);
  if (config.branches.protected.length > 0) {
    lines.push(
      `- **Protected — never push directly:** ${config.branches.protected.map(name => `\`${name}\``).join(', ')}. `
      + 'Reach these through a reviewed pull request only.',
    );
  }
  lines.push(
    `- New branches: \`${describeConvention(config.naming.convention)}\`, at most ${config.naming.maxLength} characters, `
    + `type from ${config.naming.types.map(type => `\`${type}\``).join(', ')}.`,
    '',
  );

  // ── Stages ─────────────────────────────────────────────────────────
  const stages = config.stages.filter(stage => stage.enabled);
  if (stages.length === 0) {
    // Stages ship disabled, so this is the *normal* state for a project that has
    // not configured the workflow — and it has to be said rather than rendered
    // as a missing section. An absent table reads as "no rules apply"; the truth
    // is "no stage has been enabled", which the branch rules above still qualify.
    lines.push(
      '### Stages',
      '',
      'No workflow stage has been enabled for this project yet, so there are no per-stage',
      'automation rules. The branch and label conventions above still apply.',
      '',
    );
  }
  if (stages.length > 0) {
    lines.push('### How far you may go, by stage', '');
    if (ceiling) {
      lines.push(
        `The operator's ceiling is \`${ceiling}\`. A stage asking for more than that gets the ceiling, `
        + 'and the levels below already have it applied — they are what is actually permitted.',
        '',
      );
    }
    lines.push('| Stage | Permitted | What that means for you |', '|---|---|---|');
    for (const stage of stages) {
      const level = effectiveStageLevel(stage, ceiling, masterEnabled);
      const label = STAGE_LABELS[stage.id] ?? stage.id;
      lines.push(`| ${label} | \`${level}\` | ${LEVEL_INSTRUCTION[level]} |`);
    }
    lines.push('');

    const blocked = stages
      .map(stage => ({ stage, blockers: stageBlockers(stage) }))
      .filter(entry => entry.blockers.length > 0);
    if (blocked.length > 0) {
      lines.push(
        'These stages are **blocked** and must not be attempted until the blocker is cleared —',
        'a blocker is not a preference to weigh up, it is a statement that the stage cannot run:',
        '',
      );
      for (const entry of blocked) {
        lines.push(`- **${STAGE_LABELS[entry.stage.id] ?? entry.stage.id}** — ${entry.blockers.join('; ')}`);
      }
      lines.push('');
    }
  }

  // ── Evidence a stage asks for ──────────────────────────────────────
  const withChecks = stages.filter(stage => stage.requiredChecks.length > 0 || stage.requiredStatusChecks.length > 0);
  if (withChecks.length > 0) {
    lines.push('### Evidence a stage requires', '');
    lines.push(
      'Two different things, which must not stand in for each other: a **check** is a person saying',
      '"I looked", and a **status check** is a machine saying "it passed". Do not report one as the other.',
      '',
    );
    for (const stage of withChecks) {
      lines.push(`- **${STAGE_LABELS[stage.id] ?? stage.id}**`);
      if (stage.requiredChecks.length > 0) {
        lines.push(`  - Human checks: ${stage.requiredChecks.map(check => `_${check}_`).join(', ')}`);
      }
      if (stage.requiredStatusChecks.length > 0) {
        lines.push(`  - CI that must be green: ${stage.requiredStatusChecks.map(check => `\`${check}\``).join(', ')}`);
      }
    }
    lines.push('');
  }

  // ── Labels ─────────────────────────────────────────────────────────
  const labelCategories = ([
    ['type', config.labels.type],
    ['priority', config.labels.priority],
    ['status', config.labels.status],
    ['area', config.labels.area],
  ] as const).filter(entry => entry[1].length > 0);
  if (labelCategories.length > 0) {
    lines.push('### Labels', '');
    lines.push(
      'Use **only** these. A label that does not exist is *created* on the repository as a side',
      'effect of applying it, so inventing one changes the project\'s taxonomy without asking.',
      'Pick at most one from each category.',
      '',
    );
    for (const [category, values] of labelCategories) {
      lines.push(`- **${category}:** ${values.map(value => `\`${value}\``).join(', ')}`);
    }
    lines.push('');
  }

  lines.push('### Testing', '');
  lines.push(
    'Testing requirements are **not** duplicated here. They live in',
    '`project_memory/index/testing-config.json` and are described in the testing-protocols block',
    'of this same file. Follow those.',
    '',
  );

  return lines.join('\n').trimEnd();
}

function describeConvention(convention: WorkflowConfig['naming']['convention']): string {
  if (convention === 'type-issue-slug') {
    return '<type>/<issue>-<slug>';
  }
  return convention === 'issue-slug' ? '<issue>-<slug>' : '<type>/<slug>';
}
