/**
 * The project state worth a glance without opening a panel.
 *
 * AtlasMind's sidebar carried ten views before this one and they were almost
 * entirely *inventory* — lists of agents, skills, models, servers, sessions.
 * Nothing said where you are in the workflow, and nothing said what AtlasMind is
 * currently permitted to do on your behalf. That second one is the sharper gap:
 * it is safety-critical, it is genuinely computed, and the only way to see it
 * was to open the dashboard or read four settings across two scopes.
 *
 * Scope is deliberately narrow. Nothing here duplicates what Source Control or a
 * GitHub extension already shows — no commits, no branches, no diffs, no issue
 * lists. Only facts that exist because AtlasMind exists.
 *
 * Three rules carry over from the dashboard, and they matter more here because a
 * tree row is read in a glance rather than studied:
 *
 * 1. **A section with nothing to say says so.** It never shows a zero for
 *    something it did not measure — "0 overdue" and "we did not look" are
 *    different facts, and a sidebar is exactly where they get conflated.
 * 2. **The badge counts only what needs a person.** A badge that counted
 *    everything would be permanently non-zero and therefore ignored.
 * 3. **Unbuilt capability is absent, not empty.** The tech-debt register does
 *    not exist yet, so its row is omitted rather than shown reading zero.
 *
 * Pure, `vscode`-free, and unit-tested.
 */

import type { AutomationLevel, BindingGate } from './workflowAutomation.js';

export type ProjectStateSectionId = 'permissions' | 'position' | 'attention' | 'deferred' | 'promote';

export interface ProjectStateNode {
  id: string;
  label: string;
  /** Shown dimmed beside the label. */
  description?: string;
  /** The full explanation, on hover. */
  tooltip?: string;
  /** A VS Code ThemeIcon id. */
  icon?: string;
  /** True when this row is something a person has to act on. Drives the badge. */
  needsAttention?: boolean;
  /** A command to run on click, with arguments. Opening a surface only. */
  command?: { command: string; title: string; args?: unknown[] };
}

export interface ProjectStateSection {
  id: ProjectStateSectionId;
  label: string;
  /** One line on what this section is for, on hover. */
  tooltip: string;
  icon: string;
  nodes: ProjectStateNode[];
  /** Collapsed by default unless something in it needs a person. */
  expanded: boolean;
}

/** Everything the tree needs, gathered by the caller. */
export interface ProjectStateInput {
  /** Absent when the workflow could not be assessed at all. */
  automation?: {
    masterEnabled: boolean;
    effective: AutomationLevel;
    limitedBy: BindingGate;
    detail: string;
    capabilities: { label: string; enabled: boolean }[];
  };
  workflow?: {
    /** Steps done and total, excluding optional ones. */
    done: number;
    total: number;
    nextStageName?: string;
    nextStepTitle?: string;
    /** True when the next step is blocked rather than actionable. */
    nextIsBlocked?: boolean;
  };
  attention?: {
    /** Mission runs paused at a checkpoint. */
    awaitingCheckpoint?: number;
    /** Follow-ups past their due date. */
    overdueFollowUps?: number;
    /** A CI failure whose cause could not be classified. */
    unresolvedCiFailure?: { jobName: string; classification: string };
    /** Stages held by a manual check nobody has attested. */
    blockedStages?: string[];
  };
  /**
   * Promotion paths, already assessed.
   *
   * Assessed by the caller rather than here because the verdict rules live in
   * `promotionReadiness.ts` beside the dashboard's, and a second copy of "what
   * counts as blocked" would drift — with the sidebar holding the untested one.
   */
  promote?: {
    paths: Array<{
      pathId: string;
      fromName: string;
      toName: string;
      verdict: 'blocked' | 'gated' | 'clear';
      summary: string;
      tooltip: string;
      icon: string;
      needsAttention: boolean;
      isProtected: boolean;
    }>;
  };
  deferred?: {
    /** Documents whose source changed after their last review. */
    staleDocuments?: number;
    /** Enabled testing protocols with no evidence at all. */
    uncoveredProtocols?: string[];
    /** Roadmap gate progress, e.g. MVP. */
    gates?: { label: string; done: number; total: number }[];
    /** Absent until the tech-debt register exists — see the module note. */
    debtItems?: number;
  };
}

/**
 * Build the sections.
 *
 * A section whose input is absent is **omitted entirely** rather than rendered
 * empty, so the tree never implies AtlasMind looked at something it did not.
 */
export function buildProjectState(input: ProjectStateInput): ProjectStateSection[] {
  const sections: ProjectStateSection[] = [];

  const permissions = buildPermissions(input.automation);
  if (permissions) {
    sections.push(permissions);
  }
  const position = buildPosition(input.workflow);
  if (position) {
    sections.push(position);
  }
  const promote = buildPromote(input.promote);
  if (promote) {
    sections.push(promote);
  }
  const attention = buildAttention(input.attention);
  if (attention) {
    sections.push(attention);
  }
  const deferred = buildDeferred(input.deferred);
  if (deferred) {
    sections.push(deferred);
  }

  return sections;
}

function buildPermissions(automation: ProjectStateInput['automation']): ProjectStateSection | undefined {
  if (!automation) {
    return undefined;
  }
  const nodes: ProjectStateNode[] = [];

  nodes.push({
    id: 'permissions.level',
    label: automation.masterEnabled ? `Level: ${automation.effective}` : 'Workflow off',
    description: automation.masterEnabled && automation.limitedBy !== 'none'
      ? `limited by ${automation.limitedBy}`
      : undefined,
    tooltip: automation.detail,
    icon: automation.effective === 'off' || !automation.masterEnabled ? 'circle-slash'
      : automation.effective === 'auto' ? 'zap'
        : 'shield',
    // The four gates are plain settings with no panel UI, so this opens VS
    // Code's own settings filtered to them. It used to open the Settings panel,
    // which does not render them — the same wrong destination as the Workflow
    // page's button, fixed in v0.199.0.
    command: {
      command: 'workbench.action.openSettings',
      title: 'Open the workflow settings',
      args: ['atlasmind.workflow'],
    },
  });

  for (const capability of automation.capabilities) {
    nodes.push({
      id: `permissions.${capability.label}`,
      label: capability.label,
      description: capability.enabled ? 'allowed' : 'off',
      // Stated rather than implied: an "off" row is the normal, safe state and
      // should not read as a problem to fix.
      tooltip: capability.enabled
        ? `${capability.label} are permitted. Every write still asks for confirmation naming the repository and the exact action.`
        : `${capability.label} are off. AtlasMind can still explain and prepare, it just will not act.`,
      icon: capability.enabled ? 'unlock' : 'lock',
    });
  }

  return {
    id: 'permissions',
    label: 'What AtlasMind may do',
    tooltip: 'The effective automation level and which capabilities are permitted. Four independent gates decide this, and the most restrictive wins — so you can always be stricter than your project.',
    icon: 'shield',
    nodes,
    // Expanded when something is permitted, because that is the state worth
    // noticing. All-off is the safe default and does not need attention.
    expanded: automation.masterEnabled && automation.capabilities.some(capability => capability.enabled),
  };
}

function buildPosition(workflow: ProjectStateInput['workflow']): ProjectStateSection | undefined {
  if (!workflow) {
    return undefined;
  }
  const nodes: ProjectStateNode[] = [];

  if (workflow.total > 0) {
    const percent = Math.round((workflow.done / workflow.total) * 100);
    nodes.push({
      id: 'position.progress',
      label: `${workflow.done} of ${workflow.total} steps`,
      description: `${percent}%`,
      tooltip: 'Workflow setup steps completed. Optional steps are not counted — declining a choice is not an incomplete step.',
      icon: 'checklist',
      command: { command: 'atlasmind.openProjectDashboard', title: 'Open the Workflow page', args: ['workflow'] },
    });
  }

  if (workflow.nextStepTitle) {
    nodes.push({
      id: 'position.next',
      label: workflow.nextStepTitle,
      description: workflow.nextStageName,
      tooltip: workflow.nextIsBlocked
        ? 'The next step is blocked by an earlier one. Open the Workflow page to see what it is waiting on.'
        : 'The next step you can act on. Open the Workflow page for why it matters and how to do it.',
      icon: workflow.nextIsBlocked ? 'debug-pause' : 'arrow-right',
      command: { command: 'atlasmind.openProjectDashboard', title: 'Open the Workflow page', args: ['workflow'] },
    });
  } else if (workflow.total > 0) {
    nodes.push({
      id: 'position.complete',
      label: 'Every step done',
      tooltip: 'Nothing in the guided workflow is outstanding.',
      icon: 'pass',
      // Linked even though nothing is outstanding: somebody who reads "every
      // step done" and wants to check what that covered should be one click
      // from the list rather than hunting for it.
      command: { command: 'atlasmind.openProjectDashboard', title: 'Open the Workflow page', args: ['workflow'] },
    });
  }

  return {
    id: 'position',
    label: 'Where you are',
    tooltip: 'Your position in the guided GitHub workflow, and the next thing worth doing.',
    icon: 'compass',
    nodes,
    expanded: true,
  };
}

function buildAttention(attention: ProjectStateInput['attention']): ProjectStateSection | undefined {
  if (!attention) {
    return undefined;
  }
  const nodes: ProjectStateNode[] = [];

  const checkpoints = attention.awaitingCheckpoint ?? 0;
  if (checkpoints > 0) {
    nodes.push({
      id: 'attention.checkpoint',
      label: `${checkpoints} run${checkpoints === 1 ? '' : 's'} awaiting approval`,
      tooltip: 'A mission loop paused at a checkpoint. An unanswered checkpoint denies rather than proceeding, so nothing is happening until you answer.',
      icon: 'debug-pause',
      needsAttention: true,
      command: { command: 'atlasmind.openProjectRunCenter', title: 'Open Project Run Center' },
    });
  }

  const overdue = attention.overdueFollowUps ?? 0;
  if (overdue > 0) {
    nodes.push({
      id: 'attention.followups',
      label: `${overdue} overdue follow-up${overdue === 1 ? '' : 's'}`,
      tooltip: 'Commitments to people that have passed their date.',
      icon: 'bell-dot',
      needsAttention: true,
      command: { command: 'atlasmind.openProjectDirector', title: 'Open Project Director' },
    });
  }

  if (attention.unresolvedCiFailure) {
    const { jobName, classification } = attention.unresolvedCiFailure;
    nodes.push({
      id: 'attention.ci',
      label: `${jobName} failed`,
      description: classification,
      tooltip: classification === 'unknown'
        ? 'Nothing in the log matched a known pattern, so AtlasMind will not guess a cause. This one needs a person.'
        : `Classified as ${classification} from the log, by rule rather than by a model.`,
      icon: 'error',
      // Only `unknown` genuinely needs a person: a classified failure has an
      // owner and a suggested fix, so flagging it too would make the badge
      // permanently non-zero on any project with a red build.
      needsAttention: classification === 'unknown',
      // Pipeline, not Workflow. The classified failure and its evidence moved
      // there in v0.188.0 and this link did not follow — so the most actionable
      // row in the tree opened a page that no longer shows the failure.
      command: { command: 'atlasmind.openProjectDashboard', title: 'Open the Pipeline page', args: ['pipeline'] },
    });
  }

  for (const stage of attention.blockedStages ?? []) {
    nodes.push({
      id: `attention.blocked.${stage}`,
      label: `${stage} blocked`,
      tooltip: 'A gate is holding this stage. Open the Workflow page to see which one and why.',
      icon: 'circle-slash',
      needsAttention: true,
      command: { command: 'atlasmind.openProjectDashboard', title: 'Open the Workflow page', args: ['workflow'] },
    });
  }

  if (nodes.length === 0) {
    // Distinct from an absent section: this one *was* assessed and found
    // nothing, which is worth saying rather than leaving a reader to wonder.
    nodes.push({
      id: 'attention.clear',
      label: 'Nothing waiting on you',
      tooltip: 'No paused runs, overdue follow-ups, unresolved failures, or blocked stages.',
      icon: 'pass',
    });
  }

  return {
    id: 'attention',
    label: 'Waiting on you',
    tooltip: 'Decisions AtlasMind cannot make for you. Nothing here proceeds on its own.',
    icon: 'bell',
    nodes,
    expanded: nodes.some(node => node.needsAttention),
  };
}

/**
 * "Ready to ship?" — one row per promotion path.
 *
 * The action **opens the plan**; it never promotes. That is the whole safety
 * design of this section: promotion runs behind a plan, per-gate attestations
 * and a type-to-confirm on a protected target, and a one-click row in a tree
 * would route around all three. What belongs here is the *glance* — which paths
 * are set up and unblocked — with the decision left where the evidence is.
 *
 * Only a blocker counts as needing attention. A gated path is not a problem;
 * it is a path with gates, which is what a gate is for.
 */
function buildPromote(promote: ProjectStateInput['promote']): ProjectStateSection | undefined {
  if (!promote || promote.paths.length === 0) {
    return undefined;
  }
  const nodes: ProjectStateNode[] = promote.paths.map(path => ({
    id: `promote.${path.pathId}`,
    label: `${path.fromName} → ${path.toName}${path.isProtected ? ' 🔒' : ''}`,
    description: path.summary,
    tooltip: path.tooltip,
    icon: path.icon,
    needsAttention: path.needsAttention,
    // Opens the Delivery page, where the plan, the gates and the confirmation
    // live. Never a promotion command.
    command: { command: 'atlasmind.openProjectDashboard', title: 'Open the Delivery page', args: ['delivery'] },
  }));

  const blocked = promote.paths.filter(path => path.verdict === 'blocked').length;
  return {
    id: 'promote',
    label: 'Ready to ship?',
    tooltip: blocked > 0
      ? `${blocked} promotion path${blocked === 1 ? ' is' : 's are'} blocked by something you can fix. Opening a path shows the full plan.`
      : 'Promotion paths and whether anything declared is in their way. Opening one shows the plan, its gates and the confirmation.',
    icon: 'rocket',
    // Expanded when something is blocked, because that is the case worth
    // seeing without a click.
    expanded: blocked > 0,
    nodes,
  };
}

function buildDeferred(deferred: ProjectStateInput['deferred']): ProjectStateSection | undefined {
  if (!deferred) {
    return undefined;
  }
  const nodes: ProjectStateNode[] = [];

  // Omitted entirely when the register does not exist, rather than shown as
  // zero — AtlasMind has no tech-debt store yet, and a zero would claim one.
  if (typeof deferred.debtItems === 'number') {
    nodes.push({
      id: 'deferred.debt',
      label: `${deferred.debtItems} debt item${deferred.debtItems === 1 ? '' : 's'}`,
      tooltip: 'Work knowingly deferred, with the file and line recorded. Taking debt on is often right; forgetting it is the danger.',
      icon: 'history',
      command: { command: 'atlasmind.openProjectDashboard', title: 'Open the Tech Debt page', args: ['debt'] },
    });
  }

  const stale = deferred.staleDocuments ?? 0;
  if (stale > 0) {
    nodes.push({
      id: 'deferred.docs',
      label: `${stale} stale document${stale === 1 ? '' : 's'}`,
      tooltip: 'Their sources changed after the last review. Stale documentation is worse than none, because it is trusted.',
      icon: 'book',
      command: { command: 'atlasmind.openProjectDashboard', title: 'Open Documents', args: ['documents'] },
    });
  }

  const uncovered = deferred.uncoveredProtocols ?? [];
  if (uncovered.length > 0) {
    nodes.push({
      id: 'deferred.testing',
      label: `${uncovered.length} protocol${uncovered.length === 1 ? '' : 's'} with no evidence`,
      description: uncovered.slice(0, 3).join(', '),
      tooltip: `Enabled but nothing demonstrates them: ${uncovered.join(', ')}. Either add the evidence or stop declaring the protocol — a permanent gap teaches people to ignore gaps.`,
      icon: 'beaker',
      command: { command: 'atlasmind.openProjectDashboard', title: 'Open Testing', args: ['testing'] },
    });
  }

  for (const gate of deferred.gates ?? []) {
    if (gate.total > 0) {
      nodes.push({
        id: `deferred.gate.${gate.label}`,
        label: gate.label,
        description: `${gate.done}/${gate.total}`,
        tooltip: `${gate.done} of ${gate.total} items tagged for ${gate.label} are done.`,
        icon: 'milestone',
        command: { command: 'atlasmind.openProjectDashboard', title: 'Open Roadmap', args: ['roadmap'] },
      });
    }
  }

  if (nodes.length === 0) {
    return undefined;
  }

  return {
    id: 'deferred',
    label: 'Deferred and ageing',
    tooltip: 'Things that quietly get older and are invisible until they bite.',
    icon: 'archive',
    nodes,
    // Never expanded by default: this is context, not a call to action, and
    // opening it every session would train people to collapse the whole view.
    expanded: false,
  };
}

/**
 * How many things need a person.
 *
 * Only `needsAttention` rows count. A badge that counted everything would be
 * permanently non-zero and therefore ignored, which is worse than no badge.
 */
export function countAttentionItems(sections: readonly ProjectStateSection[]): number {
  return sections.reduce(
    (total, section) => total + section.nodes.filter(node => node.needsAttention).length,
    0,
  );
}

/**
 * Whether the view has anything worth a sidebar row.
 *
 * Drives the `when` clause. A tree with no sections at all means nothing could
 * be assessed — showing an empty view would be a row that never earns its place.
 */
export function hasProjectState(sections: readonly ProjectStateSection[]): boolean {
  return sections.length > 0;
}
