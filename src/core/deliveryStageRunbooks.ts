/**
 * One runbook per delivery stage, and what makes each one different from the
 * stage below it.
 *
 * The Delivery page explained how to ship this project very well, and it
 * explained it exactly once: `buildProjectDeliveryGuide` read the production
 * stage and produced a single column set. A project with Local, Staging and
 * Production therefore had one answer to "what do I run", and it was the
 * production answer — so the question a developer asks most often ("how do I
 * start the dev build?") was answered with a version bump, a changelog gate and
 * a marketplace publish, while the question that actually needs care ("what is
 * different about promoting to production?") was never asked at all.
 *
 * This module builds the set and derives the comparison. Five rules carry the
 * semantics:
 *
 * **A stage's requirements come from the pipeline, never from a model.** Every
 * entry names the declared rule that produced it, and the table travels in the
 * payload so a surface publishes the rules that actually graded the cards
 * rather than a copy that drifts. Two people reading the same `delivery.json`
 * must get the same comparison, in March and in July.
 *
 * **The interesting fact is the delta, not the list.** Production requires
 * approval, a version bump, a changelog, a backup and four green checks — but
 * so, in part, does Staging, and a reader comparing two twenty-row lists by eye
 * will not find the two rows that differ. `deltas` states what this stage asks
 * that the one below it does not, which is the sentence somebody actually needs
 * before promoting.
 *
 * **A requirement the stage below has and this one does not is reported too.**
 * It is the alarming direction and the one a "what's new here" list would hide:
 * a Staging stage that declares a rollback while Production does not is a real
 * finding, and dropping it because it does not fit the "more gates as you go
 * right" story would be the most expensive omission available here.
 *
 * **Unassessed is not clear.** A project with no configured pipeline gets one
 * unstaged runbook and `staged: false` — never three fabricated environments,
 * and never an empty comparison that reads as "these stages are identical".
 *
 * **Nothing here decides which stage you are on; it derives it and says so.**
 * The opening stage comes from the checked-out branch matching a stage's
 * declared `branchRef`, with the reason carried alongside, because a page that
 * silently opens on a different runbook than you expected is worse than one
 * that opens on the first and tells you why.
 *
 * Pure: no `vscode`, no filesystem, no clock.
 */

import { buildProjectDeliveryGuide, type ProjectDeliveryGuide, type ProjectDeliveryGuideInput } from './deliveryManager.js';
import type { DeploymentStage } from '../types.js';

/** What a requirement is about, used only for grouping on a surface. */
export type DeliveryStageRequirementKind = 'gate' | 'data' | 'reach' | 'recovery';

/**
 * The declared rules that decide what a stage requires. Published with every
 * comparison so a reader can check a row against the rule that produced it.
 */
export const DELIVERY_STAGE_REQUIREMENT_RULES: ReadonlyArray<{
  id: string;
  kind: DeliveryStageRequirementKind;
  describes: string;
}> = [
  { id: 'protected', kind: 'gate', describes: 'The stage is marked protected, so a promotion into it always confirms and never force-pushes.' },
  { id: 'approval', kind: 'gate', describes: 'The stage requires explicit human approval before a promotion runs.' },
  { id: 'distinct-approver', kind: 'gate', describes: 'The stage requires the person promoting to be someone other than the author of the change.' },
  { id: 'pull-request', kind: 'gate', describes: 'The stage is reached through a reviewed pull request rather than a direct push.' },
  { id: 'version-bump', kind: 'gate', describes: 'The stage requires a version newer than the one already there.' },
  { id: 'changelog', kind: 'gate', describes: 'The stage requires release notes for the version being shipped.' },
  { id: 'status-checks', kind: 'gate', describes: 'The stage declares named CI status checks that must be green.' },
  { id: 'human-checks', kind: 'gate', describes: 'The stage declares a human checklist that somebody must complete.' },
  { id: 'backup', kind: 'data', describes: 'The stage requires a data backup before anything is promoted into it.' },
  { id: 'migrations', kind: 'data', describes: 'The stage declares a database migration command that runs as part of a promotion.' },
  { id: 'live-data', kind: 'data', describes: 'The stage reads and writes a data store that is not disposable.' },
  { id: 'dispatch', kind: 'reach', describes: 'The stage delegates its deployment to a CI/CD workflow rather than this machine.' },
  { id: 'hosted-away', kind: 'reach', describes: 'The stage is hosted somewhere other than this machine, so what reaches it has left here.' },
  { id: 'rollback', kind: 'recovery', describes: 'The stage declares how to roll back — a command, or a written runbook.' },
];

const RULE_BY_ID = new Map(DELIVERY_STAGE_REQUIREMENT_RULES.map(rule => [rule.id, rule]));

/** One thing a stage asks of you, and the declared rule that says so. */
export interface DeliveryStageRequirement {
  ruleId: string;
  /** The declared rule text, carried so a surface never restates it from memory. */
  rule: string;
  kind: DeliveryStageRequirementKind;
  label: string;
  detail: string;
}

/**
 * How this stage's requirements differ from the stage below it.
 *
 * `changed` exists because comparing on rule id alone would report "both
 * require CI checks" as agreement when one requires `CI` and the other requires
 * `CI, e2e, security-scan` — the difference somebody is actually asking about.
 */
export interface DeliveryStageRequirementDelta {
  requirement: DeliveryStageRequirement;
  change: 'added' | 'changed' | 'dropped';
  /** The lower stage's wording, present only for `changed` and `dropped`. */
  previousDetail?: string;
}

export interface DeliveryStageRunbook {
  guide: ProjectDeliveryGuide;
  /** Everything this stage asks for, whether or not the stage below shares it. */
  requirements: DeliveryStageRequirement[];
  /** How that differs from the stage below. Empty is a real answer; absent means there is no stage below. */
  deltas: DeliveryStageRequirementDelta[];
  /** The stage the deltas are measured against, when there is one. */
  comparedToStageName?: string;
}

export interface DeliveryStageRunbookSet {
  runbooks: DeliveryStageRunbook[];
  /** False when no pipeline is configured, so the single runbook claims no stage. */
  staged: boolean;
  /** Which runbook a surface should open on, by stage id. Absent when unstaged. */
  selectedStageId?: string;
  /** Why that one — stated, because a page opening somewhere unexpected must say so. */
  selectionReason: string;
  /** Stages beyond the display cap, named as a count rather than dropped silently. */
  omittedStageCount: number;
  /** The declared rules, so a comparison can be checked against them on screen. */
  rules: ReadonlyArray<{ id: string; kind: DeliveryStageRequirementKind; describes: string }>;
}

export interface DeliveryStageRunbookInput extends Omit<ProjectDeliveryGuideInput, 'stageId'> {
  /** The checked-out branch, used only to choose which runbook opens first. */
  currentBranch?: string;
}

/**
 * More runbooks than this and the selector stops being a way to compare three
 * environments and becomes a second navigation system. The remainder is stated
 * rather than dropped.
 */
const MAX_RUNBOOKS = 8;

/** Stage config is workspace-authored: strip controls and clamp before display. */
function safe(value: unknown, max = 200): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max)
    : '';
}

function requirement(
  ruleId: string,
  label: string,
  detail: string,
): DeliveryStageRequirement | undefined {
  const rule = RULE_BY_ID.get(ruleId);
  if (!rule) {
    return undefined;
  }
  return { ruleId, rule: rule.describes, kind: rule.kind, label, detail };
}

/**
 * What one stage asks of you.
 *
 * Read entirely off the stage record, in the declared rule order, so the same
 * pipeline always produces the same list in the same sequence — the property
 * that makes two stages comparable at all.
 */
export function deliveryStageRequirements(stage: DeploymentStage): DeliveryStageRequirement[] {
  const out: DeliveryStageRequirement[] = [];
  const push = (ruleId: string, label: string, detail: string): void => {
    const entry = requirement(ruleId, label, detail);
    if (entry) { out.push(entry); }
  };
  const branch = safe(stage.branchRef, 120);
  const promotion = stage.promotionPolicy;

  if (stage.isProtected) {
    push('protected', 'Protected stage', 'A promotion into this stage always confirms first, and never force-pushes.');
  }
  if (promotion.requiresApproval) {
    push('approval', 'Human approval', 'Somebody has to approve the promotion before it runs.');
  }
  if (promotion.requireDistinctApprover) {
    push('distinct-approver', 'Separate approver', 'The person promoting must not be the author of the change being promoted.');
  }
  if (promotion.viaPullRequest) {
    push('pull-request', 'Reviewed pull request', `The change arrives${branch ? ` on ${branch}` : ''} through a pull request, not a direct push.`);
  }
  if (promotion.requireVersionBump) {
    push('version-bump', 'Version bump', 'The version must be newer than the one already at this stage.');
  }
  if (promotion.requireChangelog) {
    push('changelog', 'Release notes', 'The version being shipped must have a changelog entry.');
  }
  const statusChecks = (promotion.requiredStatusChecks ?? []).map(check => safe(check, 160)).filter(Boolean);
  if (statusChecks.length > 0) {
    push('status-checks', 'CI must be green', `${statusChecks.slice(0, 10).join(', ')}${statusChecks.length > 10 ? `, and ${statusChecks.length - 10} more` : ''}.`);
  }
  const humanChecks = (promotion.requiredChecks ?? []).map(check => safe(check, 120)).filter(Boolean);
  if (humanChecks.length > 0) {
    push('human-checks', 'Human checklist', `${humanChecks.slice(0, 10).join(', ')}${humanChecks.length > 10 ? `, and ${humanChecks.length - 10} more` : ''}.`);
  }
  if (stage.backupPolicy.required) {
    push(
      'backup',
      'Backup first',
      stage.backupPolicy.command
        ? 'A backup runs before the promotion, and must succeed.'
        : 'A backup is required and no command is configured, so promotion into this stage stays blocked.',
    );
  }
  if (safe(stage.data.migrateCommand, 400)) {
    push('migrations', 'Database migration', 'A migration command runs as a managed step during promotion, after the backup and before the deploy.');
  }
  const dataKind = safe(stage.data.kind, 60);
  if (stage.kind !== 'local' && dataKind && dataKind.toLowerCase() !== 'none') {
    push('live-data', 'Real data', safe(stage.data.label, 200) || `This stage reads and writes a ${dataKind} store that is not disposable.`);
  }
  const dispatch = safe(promotion.dispatchWorkflow, 200);
  if (dispatch) {
    push('dispatch', 'Deployed by CI', `Deployment is performed by ${dispatch}, with CI's identity and logs — not from this machine.`);
  }
  const provider = safe(stage.hosting.provider, 120);
  if (stage.kind !== 'local' && provider && !/^(?:localhost|tbd)$/i.test(provider)) {
    push('hosted-away', 'Hosted off this machine', `Hosted on ${provider}. Closing a terminal does not undo what reached it.`);
  }
  const rollbackCommand = safe(stage.rollbackPolicy.command, 400);
  const rollbackRunbook = safe(stage.rollbackPolicy.runbookRef, 300);
  if (rollbackCommand || rollbackRunbook) {
    push('rollback', 'Rollback declared', rollbackCommand ? `Recovery command: ${rollbackCommand}` : `Recovery runbook: ${rollbackRunbook}`);
  }
  return out;
}

/**
 * How `stage`'s requirements differ from `previous`'s.
 *
 * Ordered added → changed → dropped, and within each group by the declared rule
 * order, so the list cannot shuffle between two readings of the same pipeline.
 */
export function deliveryStageRequirementDeltas(
  requirements: readonly DeliveryStageRequirement[],
  previous: readonly DeliveryStageRequirement[],
): DeliveryStageRequirementDelta[] {
  const previousById = new Map(previous.map(entry => [entry.ruleId, entry]));
  const currentById = new Map(requirements.map(entry => [entry.ruleId, entry]));
  const added: DeliveryStageRequirementDelta[] = [];
  const changed: DeliveryStageRequirementDelta[] = [];
  const dropped: DeliveryStageRequirementDelta[] = [];

  for (const entry of requirements) {
    const before = previousById.get(entry.ruleId);
    if (!before) {
      added.push({ requirement: entry, change: 'added' });
    } else if (before.detail !== entry.detail) {
      changed.push({ requirement: entry, change: 'changed', previousDetail: before.detail });
    }
  }
  for (const entry of previous) {
    if (!currentById.has(entry.ruleId)) {
      dropped.push({ requirement: entry, change: 'dropped', previousDetail: entry.detail });
    }
  }
  return [...added, ...changed, ...dropped];
}

/**
 * Which runbook opens first, and why.
 *
 * The branch you have checked out is the best available evidence of which
 * environment you are thinking about, and it is a fact rather than a guess: a
 * stage declares its `branchRef` in the pipeline file. When nothing matches,
 * the lowest-ranked stage opens — the one where work starts — and the reason
 * says the match failed rather than implying a choice was made for you.
 */
function selectStage(
  stages: readonly DeploymentStage[],
  currentBranch: string | undefined,
): { stageId?: string; reason: string } {
  if (stages.length === 0) {
    return { reason: 'No delivery pipeline is configured, so this is a single runbook for the project as a whole.' };
  }
  const branch = safe(currentBranch, 200);
  const matched = branch ? stages.find(stage => safe(stage.branchRef, 200) === branch) : undefined;
  if (matched) {
    return {
      stageId: matched.id,
      reason: `You have ${branch} checked out, and the pipeline says that branch represents ${safe(matched.name, 120) || 'this stage'}.`,
    };
  }
  const first = stages[0]!;
  return {
    stageId: first.id,
    reason: branch
      ? `No stage claims ${branch}, so this opens on ${safe(first.name, 120) || 'the first stage'}. Switch runbook above.`
      : `Opening on ${safe(first.name, 120) || 'the first stage'}. Switch runbook above.`,
  };
}

/**
 * Build one runbook per configured delivery stage, lowest rank first, with each
 * stage's requirements and how they differ from the stage below it.
 *
 * With no pipeline configured this returns exactly one unstaged runbook — the
 * shape the page had before — rather than inventing a Local/Staging/Production
 * set the project never declared.
 */
export function buildDeliveryStageRunbooks(input: DeliveryStageRunbookInput): DeliveryStageRunbookSet {
  const { currentBranch, ...guideInput } = input;
  const rules = DELIVERY_STAGE_REQUIREMENT_RULES;
  const ordered = [...(guideInput.deliveryConfig?.stages ?? [])].sort((a, b) => a.rank - b.rank);

  if (ordered.length === 0) {
    return {
      runbooks: [{ guide: buildProjectDeliveryGuide(guideInput), requirements: [], deltas: [] }],
      staged: false,
      selectionReason: selectStage(ordered, currentBranch).reason,
      omittedStageCount: 0,
      rules,
    };
  }

  const shown = ordered.slice(0, MAX_RUNBOOKS);
  const runbooks: DeliveryStageRunbook[] = [];
  let previous: { name: string; requirements: DeliveryStageRequirement[] } | undefined;
  for (const stage of shown) {
    const requirements = deliveryStageRequirements(stage);
    runbooks.push({
      guide: buildProjectDeliveryGuide({ ...guideInput, stageId: stage.id }),
      requirements,
      deltas: previous ? deliveryStageRequirementDeltas(requirements, previous.requirements) : [],
      ...(previous ? { comparedToStageName: previous.name } : {}),
    });
    previous = { name: safe(stage.name, 120) || 'the previous stage', requirements };
  }

  const selection = selectStage(shown, currentBranch);
  return {
    runbooks,
    staged: true,
    ...(selection.stageId ? { selectedStageId: selection.stageId } : {}),
    selectionReason: selection.reason,
    omittedStageCount: ordered.length - shown.length,
    rules,
  };
}
