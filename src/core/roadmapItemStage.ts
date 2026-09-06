/**
 * How far a roadmap item has actually got.
 *
 * The backlog is a checkbox: ticked or not. That is the right shape for the one
 * decision a person makes — "this is done" — and the wrong shape for everything
 * before it. An item with a filed plan, a branch, and merged work reads exactly
 * like an item nobody has touched, which is what makes a long-running piece of
 * work impossible to pick up across sessions: the thing you most need to know is
 * whether the code landed and nobody has checked it yet.
 *
 * Five rules.
 *
 * **Derived, never a hand-set flag.** Everywhere else in AtlasMind a status is
 * evidenced rather than asserted — `testingPolicyCoverage` reads what is on
 * disk, the debt register grades from a rule table. A "To Be Tested" checkbox
 * would be the one place a state is claimed rather than shown, and it would rot
 * exactly the way this project's own unowned gaps did: set once, true for a
 * week, misleading thereafter, with nothing able to tell the difference.
 *
 * **The tick stays a human act.** `complete` comes from the markdown checkbox
 * and nothing here writes it. `roadmapPlanning` says so in all three hand-off
 * prompts, and a derivation that could complete an item would quietly overrule
 * the one decision those prompts reserve for a person.
 *
 * **`awaiting-verification` is the state the Completion check was written for.**
 * That hand-off already exists, is deterministic, and asks exactly the right
 * question — it simply had nowhere to put its answer, because an item was either
 * ticked or untouched. This is the missing rung between them.
 *
 * **Unknown is never a claim.** Every git signal is optional. With no branch
 * inventory the git-dependent states are unreachable and the item falls back to
 * what the repository alone can prove; `assessed` says which happened, so a
 * surface can distinguish "not started" from "not looked at". Guessing
 * `in-progress` because a branch name was *declared* would report work nobody
 * began.
 *
 * **Nothing here blocks anything.** It is a reading, as `ideationReadiness` is.
 */

/** How far an item has got. Ordered from untouched to done. */
export type RoadmapItemStage =
  /** Nothing filed, no branch, not ticked. */
  | 'not-started'
  /** A plan is filed, or a branch is declared but does not exist yet. */
  | 'planned'
  /** The branch exists and has not merged. */
  | 'in-progress'
  /** The branch merged and nobody has ticked the item off. */
  | 'awaiting-verification'
  /** The checkbox is ticked. A human act, never derived. */
  | 'complete';

export type RoadmapItemStageRuleId =
  | 'checkbox-ticked'
  | 'branch-merged'
  | 'branch-exists'
  | 'plan-filed'
  | 'branch-declared'
  | 'nothing-recorded';

export interface RoadmapItemStageRule {
  id: RoadmapItemStageRuleId;
  stage: RoadmapItemStage;
  description: string;
}

/** The declared table, published with every reading. */
export const ROADMAP_ITEM_STAGE_RULES: readonly RoadmapItemStageRule[] = [
  {
    id: 'checkbox-ticked',
    stage: 'complete',
    description: 'The backlog line is ticked. Only a person does this.',
  },
  {
    id: 'branch-merged',
    stage: 'awaiting-verification',
    description: 'The item\'s branch has merged and the line is not ticked.',
  },
  {
    id: 'branch-exists',
    stage: 'in-progress',
    description: 'The item\'s branch exists and has not merged.',
  },
  {
    id: 'plan-filed',
    stage: 'planned',
    description: 'A plan is filed for the item.',
  },
  {
    id: 'branch-declared',
    stage: 'planned',
    description: 'A branch is named for the item but does not exist yet.',
  },
  {
    id: 'nothing-recorded',
    stage: 'not-started',
    description: 'Nothing has been filed, branched or ticked.',
  },
];

/** What one branch looks like to this question. A projection, not the inventory. */
export interface RoadmapBranchSignal {
  name: string;
  merged: boolean;
}

/** One item as this question needs it. */
export interface RoadmapItemStageInput {
  /** The backlog checkbox. The only input a person sets directly. */
  completed: boolean;
  /** Workspace-relative plan path, when one has been filed. */
  planPath?: string;
  /** The branch declared or derived for this item. */
  branch?: string;
  /**
   * Branches that exist, with their merge state.
   *
   * `undefined` means no inventory was gathered — not that no branches exist.
   * The git-dependent stages are then unreachable rather than assumed false.
   */
  branches?: readonly RoadmapBranchSignal[];
}

export interface RoadmapItemStageReading {
  stage: RoadmapItemStage;
  rule: RoadmapItemStageRuleId;
  /** False when no branch inventory was available to consult. */
  assessed: boolean;
}

/**
 * Match a declared branch against the inventory.
 *
 * Compared on the bare name, since the inventory carries short names while a
 * record may store either. Exact only: a prefix match would let
 * `feat/login` claim `feat/login-v2`, which is a different piece of work.
 */
function findBranch(
  branch: string | undefined,
  branches: readonly RoadmapBranchSignal[],
): RoadmapBranchSignal | undefined {
  if (branch === undefined) {
    return undefined;
  }
  const wanted = branch.trim();
  if (wanted.length === 0) {
    return undefined;
  }
  return branches.find(candidate => candidate.name === wanted);
}

/** How far one item has got. Root-cause first: the tick, then git, then the file. */
export function readRoadmapItemStage(input: RoadmapItemStageInput): RoadmapItemStageReading {
  const assessed = input.branches !== undefined;

  // The tick outranks everything, including a branch that never merged. An item
  // somebody marked done is done, whatever the repository looks like.
  if (input.completed) {
    return { stage: 'complete', rule: 'checkbox-ticked', assessed };
  }

  const match = findBranch(input.branch, input.branches ?? []);
  if (match !== undefined) {
    return match.merged
      ? { stage: 'awaiting-verification', rule: 'branch-merged', assessed }
      : { stage: 'in-progress', rule: 'branch-exists', assessed };
  }

  if ((input.planPath ?? '').trim().length > 0) {
    return { stage: 'planned', rule: 'plan-filed', assessed };
  }
  // A named branch that does not exist — or that could not be checked — is a
  // statement of intent, never of progress.
  if ((input.branch ?? '').trim().length > 0) {
    return { stage: 'planned', rule: 'branch-declared', assessed };
  }
  return { stage: 'not-started', rule: 'nothing-recorded', assessed };
}

/** Display order, least advanced first. Declaration order *is* the ranking. */
export const ROADMAP_ITEM_STAGE_ORDER: readonly RoadmapItemStage[] = [
  'not-started',
  'planned',
  'in-progress',
  'awaiting-verification',
  'complete',
];

/** Short label for a chip. */
export function describeRoadmapItemStage(stage: RoadmapItemStage): string {
  switch (stage) {
    case 'complete':
      return 'Done';
    case 'awaiting-verification':
      return 'To be verified';
    case 'in-progress':
      return 'In progress';
    case 'planned':
      return 'Planned';
    default:
      return 'Not started';
  }
}

export interface RoadmapStageTally {
  counts: Record<RoadmapItemStage, number>;
  /** Items whose work landed and which nobody has checked off. The actionable set. */
  awaitingVerification: number;
  /** False when no reading could consult git, so the tally understates progress. */
  assessed: boolean;
}

/**
 * Roll several readings into a tally.
 *
 * `assessed` is false when *any* reading lacked an inventory, because a mixed
 * tally cannot be presented as a complete picture — the same reason the
 * attention feed refuses to call a page clear on partial input.
 */
export function tallyRoadmapItemStages(
  readings: readonly RoadmapItemStageReading[],
): RoadmapStageTally {
  const counts: Record<RoadmapItemStage, number> = {
    'not-started': 0,
    planned: 0,
    'in-progress': 0,
    'awaiting-verification': 0,
    complete: 0,
  };
  for (const reading of readings) {
    counts[reading.stage] += 1;
  }
  return {
    counts,
    awaitingVerification: counts['awaiting-verification'],
    assessed: readings.every(reading => reading.assessed),
  };
}
