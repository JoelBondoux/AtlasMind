import type { RoadmapFocus, RoadmapGraphNode } from './roadmapGraph.js';

/**
 * The plan as a board: what is waiting, what is ready, what somebody has
 * actually started, and what is with a reviewer.
 *
 * The roadmap could say what an item *is* (the backlog), what it waits on (the
 * canvas) and how long it takes (the timeline). None of them could say **what
 * state it is in**, which is the question a stand-up asks — so the answer lived
 * in people's heads, or in a second tracker somebody kept by hand beside this
 * one.
 *
 * Five rules, and the first is the one the whole surface rests on.
 *
 * **A status is evidenced, never guessed.** Only a branch that exists or a pull
 * request that is open moves an item out of Ready. An item nobody has started
 * reads as Ready — the truthful answer — never as "in progress" because it is
 * important, or near the top, or assigned to somebody. A board that guesses is
 * a board that is quietly wrong at exactly the moment somebody relies on it.
 *
 * **Delivered comes from the roadmap, never from a merged pull request.**
 * Merging is not ticking a box: work merges without finishing the item, and an
 * item finishes with no pull request at all. Only the backlog line says an item
 * is done, which keeps one place to look and one place to argue with.
 *
 * **Blocked is a badge as well as a column.** An item can be started *and*
 * waiting on something, and hiding either half would be wrong: the column is
 * the most advanced state there is evidence for, and the waiting count travels
 * on the card whatever column it sits in.
 *
 * **How the evidence matched is carried, because the two are not equally
 * strong.** A branch an item *declares* matching a real branch is a fact. A
 * branch name AtlasMind *derived* from the item's text matching a real branch is
 * a convention holding — very likely the same work, and worth saying so rather
 * than presenting as identical.
 *
 * **Unassessed is not empty.** With no branch list and no pull-request list
 * gathered — no git read, no `gh` — the board says the evidence was not
 * gathered rather than reporting a whole project as not started. Silence earned
 * by not looking is the failure mode that would make this worse than nothing.
 *
 * Pure — no clock, no `fs`, no model. Evidence is passed in, because only the
 * caller knows what it managed to collect.
 */

export type RoadmapBoardColumnId = 'blocked' | 'ready' | 'in-progress' | 'in-review' | 'delivered';

export type RoadmapBoardRuleId =
  | 'evidenced-never-guessed'
  | 'delivered-comes-from-the-roadmap'
  | 'blocked-is-a-badge-too'
  | 'match-strength-is-carried'
  | 'unassessed-is-not-empty';

export interface RoadmapBoardRule {
  id: RoadmapBoardRuleId;
  description: string;
}

/** Published with every board, so a surface shows the rules that placed the cards. */
export const ROADMAP_BOARD_RULES: readonly RoadmapBoardRule[] = [
  {
    id: 'evidenced-never-guessed',
    description: 'Only a branch that exists or an open pull request moves an item out of Ready. An item nobody has started reads as Ready, never as in progress.',
  },
  {
    id: 'delivered-comes-from-the-roadmap',
    description: 'Delivered is the backlog line being ticked. A merged pull request does not tick it: work merges without finishing an item, and items finish with no pull request at all.',
  },
  {
    id: 'blocked-is-a-badge-too',
    description: 'The column is the most advanced state there is evidence for. An item can be started and still waiting, so the waiting count travels on the card wherever it sits.',
  },
  {
    id: 'match-strength-is-carried',
    description: 'A branch the item declares is a fact. A branch name derived from the item\'s text is a naming convention holding, which is worth saying rather than presenting as the same thing.',
  },
  {
    id: 'unassessed-is-not-empty',
    description: 'With no branches and no pull requests gathered, the board says so. Reporting every item as not started because nobody looked would be worse than showing nothing.',
  },
];

export interface RoadmapBoardPullRequest {
  number: number;
  headRefName: string;
  isDraft: boolean;
  url?: string;
}

/**
 * What the caller managed to collect.
 *
 * Both fields are optional and `undefined` means *not gathered* — distinct from
 * `[]`, which means looked and found none.
 */
export interface RoadmapBoardEvidence {
  branchNames?: readonly string[];
  openPullRequests?: readonly RoadmapBoardPullRequest[];
}

export interface RoadmapBoardCard {
  nodeId: string;
  itemId: string;
  text: string;
  focus: RoadmapFocus;
  gates: string[];
  assigneeId?: string;
  column: RoadmapBoardColumnId;
  /** Outstanding prerequisites. Carried in every column, not just Blocked. */
  waitingOnCount: number;
  /** The branch this item is worked on, when one is known. */
  branch?: string;
  /** How the branch evidence matched, when it did. Absent when nothing matched. */
  branchMatch?: 'declared' | 'derived';
  pullRequestNumber?: number;
  pullRequestUrl?: string;
  pullRequestIsDraft?: boolean;
  estimateDays: number;
  priorityScore: number;
}

export interface RoadmapBoardColumn {
  id: RoadmapBoardColumnId;
  label: string;
  /** What being in this column means — shown so nobody has to infer it. */
  description: string;
  cards: RoadmapBoardCard[];
}

export type RoadmapBoardEvidenceState = 'gathered' | 'not-assessed';

export interface RoadmapBoard {
  columns: RoadmapBoardColumn[];
  branchEvidence: RoadmapBoardEvidenceState;
  pullRequestEvidence: RoadmapBoardEvidenceState;
  /** Stated when either kind of evidence was not gathered. */
  note?: string;
  rules: readonly RoadmapBoardRule[];
}

const COLUMN_ORDER: ReadonlyArray<{ id: RoadmapBoardColumnId; label: string; description: string }> = [
  { id: 'blocked', label: 'Blocked', description: 'Waiting on work that has not landed. Nothing has been started here.' },
  { id: 'ready', label: 'Ready', description: 'Nothing is in the way and nobody has started. This is where work is picked up.' },
  { id: 'in-progress', label: 'In progress', description: 'A branch for this item exists, so somebody has started.' },
  { id: 'in-review', label: 'In review', description: 'An open pull request from this item\'s branch.' },
  { id: 'delivered', label: 'Delivered', description: 'The backlog line is ticked. A merged pull request alone does not put an item here.' },
];

/** Case-insensitive, because git is case-preserving and people are not. */
function normalizeBranch(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * The board.
 *
 * Takes the nodes rather than the graph: the edges say nothing about state, and
 * a caller that has already partitioned its nodes for a canvas should not have
 * to reassemble a graph to get a board.
 *
 * `evidence` is what the caller collected; absent fields mean it did not look,
 * which is reported rather than treated as an empty result.
 */
export function buildRoadmapBoard(
  nodes: readonly RoadmapGraphNode[],
  evidence: RoadmapBoardEvidence = {},
): RoadmapBoard {
  const branchEvidence: RoadmapBoardEvidenceState = evidence.branchNames === undefined ? 'not-assessed' : 'gathered';
  const pullRequestEvidence: RoadmapBoardEvidenceState = evidence.openPullRequests === undefined ? 'not-assessed' : 'gathered';

  const branches = new Set((evidence.branchNames ?? []).map(normalizeBranch));
  const pullRequestsByHead = new Map(
    (evidence.openPullRequests ?? []).map(pull => [normalizeBranch(pull.headRefName), pull]),
  );

  const cards = nodes.map(node => toCard(node, branches, pullRequestsByHead));

  const columns = COLUMN_ORDER.map(column => ({
    ...column,
    cards: cards
      .filter(card => card.column === column.id)
      // Backlog priority inside a column, then id, so a refresh cannot shuffle
      // two cards of equal weight past each other.
      .sort((left, right) => right.priorityScore - left.priorityScore || left.nodeId.localeCompare(right.nodeId)),
  }));

  return {
    columns,
    branchEvidence,
    pullRequestEvidence,
    ...(noteFor(branchEvidence, pullRequestEvidence) === undefined
      ? {}
      : { note: noteFor(branchEvidence, pullRequestEvidence) as string }),
    rules: ROADMAP_BOARD_RULES,
  };
}

function toCard(
  node: RoadmapGraphNode,
  branches: ReadonlySet<string>,
  pullRequestsByHead: ReadonlyMap<string, RoadmapBoardPullRequest>,
): RoadmapBoardCard {
  const branchKey = node.branch ? normalizeBranch(node.branch) : '';
  const branchExists = branchKey.length > 0 && branches.has(branchKey);
  const pull = branchKey.length > 0 ? pullRequestsByHead.get(branchKey) : undefined;
  const matchStrength = node.branchSource === 'declared' ? 'declared' : 'derived';

  const base = {
    nodeId: node.id,
    itemId: node.itemId,
    text: node.text,
    focus: node.focus,
    gates: node.gates,
    ...(node.assigneeId === undefined ? {} : { assigneeId: node.assigneeId }),
    // Carried in every column: an item can be started and still waiting, and
    // dropping either half would misreport one of them.
    waitingOnCount: node.blockedBy.length,
    ...(node.branch ? { branch: node.branch } : {}),
    ...(branchExists || pull ? { branchMatch: matchStrength as 'declared' | 'derived' } : {}),
    ...(pull === undefined ? {} : {
      pullRequestNumber: pull.number,
      pullRequestIsDraft: pull.isDraft,
      ...(pull.url === undefined ? {} : { pullRequestUrl: pull.url }),
    }),
    estimateDays: node.estimate.days,
    priorityScore: node.priorityScore,
  };

  return { ...base, column: columnFor(node, branchExists, pull !== undefined) };
}

/**
 * The most advanced state there is evidence for.
 *
 * Order matters and is the policy: a started item that is also waiting shows as
 * started, with the waiting count on the card. Hiding the work would be the
 * bigger lie of the two.
 */
function columnFor(node: RoadmapGraphNode, branchExists: boolean, hasOpenPull: boolean): RoadmapBoardColumnId {
  // Only the backlog line says an item is delivered. A merged pull request does
  // not, and never reaches this branch.
  if (node.completed) { return 'delivered'; }
  if (hasOpenPull) { return 'in-review'; }
  if (branchExists) { return 'in-progress'; }
  if (node.blockedBy.length > 0) { return 'blocked'; }
  return 'ready';
}

function noteFor(branch: RoadmapBoardEvidenceState, pull: RoadmapBoardEvidenceState): string | undefined {
  if (branch === 'gathered' && pull === 'gathered') { return undefined; }
  if (branch === 'not-assessed' && pull === 'not-assessed') {
    return 'No branches or pull requests were read, so nothing can be shown as started or in review. Every outstanding item is where the plan puts it, not where the work is.';
  }
  return branch === 'not-assessed'
    ? 'No branches were read, so an item somebody has started but not opened a pull request for still reads as Ready.'
    : 'No pull requests were read, so an item with a branch reads as in progress even if it is already with a reviewer.';
}

/** One sentence a surface can print above the board. */
export function describeRoadmapBoard(board: RoadmapBoard): string {
  const count = (id: RoadmapBoardColumnId) => board.columns.find(column => column.id === id)?.cards.length ?? 0;
  const outstanding = count('blocked') + count('ready') + count('in-progress') + count('in-review');
  if (outstanding === 0) {
    return count('delivered') > 0
      ? 'Everything on the roadmap is delivered.'
      : 'Nothing on the roadmap yet.';
  }
  return `${count('in-progress') + count('in-review')} of ${outstanding} outstanding items have work started`
    + `, ${count('blocked')} waiting on something else.`;
}
